import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { createMemoryService } from './memory.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct horse sample battery';
const INVITE = 'integration-test-clinic-invite';
const testConfig = { production: false, secureCookies: false, appOrigin: ORIGIN, clinicianInviteCode: INVITE };

function fakeServices() {
  const calls = { submit: [], receipt: [], recall: [], chat: [] };
  const receipts = new Map();
  const memory = {
    configured: true, network: 'mainnet', accountId: `0x${'b'.repeat(64)}`,
    async submit(text, namespace) {
      calls.submit.push({ text, namespace });
      const jobId = `test-job-${calls.submit.length}`;
      receipts.set(jobId, { status: 'processing' });
      return { jobId, status: 'processing' };
    },
    async receipt(jobId) {
      calls.receipt.push(jobId);
      const value = receipts.get(jobId);
      if (value instanceof Error) throw value;
      return value || { status: 'failed', error: 'Test job was not found.' };
    },
    async recall(query, namespace) { calls.recall.push({ query, namespace }); return []; },
    async verify() { return { connected: true, network: 'mainnet', accountId: this.accountId }; },
  };
  const chat = {
    configured: true, model: 'injected-test-model',
    async respond(input) { calls.chat.push(input); return `Test assistant response to: ${input.message}`; },
  };
  return { memory, chat, calls, receipts };
}

async function harness(t, { filename = ':memory:', services = fakeServices() } = {}) {
  const state = { store: null, server: null, base: null, ...services };
  async function start() {
    state.store = createStore(filename);
    const app = createApp({ config: testConfig, store: state.store, memory: services.memory, chat: services.chat });
    state.server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    state.base = `http://127.0.0.1:${state.server.address().port}`;
  }
  async function stop() {
    if (state.server) {
      state.server.closeAllConnections();
      await new Promise((resolve, reject) => state.server.close((error) => error ? reject(error) : resolve()));
      state.server = null;
    }
    if (state.store) { state.store.close(); state.store = null; }
  }
  state.restart = async () => { await stop(); await start(); };
  state.stop = stop;
  t.after(stop);
  await start();
  return state;
}

function browser(app) {
  const state = { cookie: '', csrf: '', user: null };
  state.request = async (method, endpoint, data, options = {}) => {
    const headers = { ...(state.cookie ? { Cookie: state.cookie } : {}) };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers.Origin = options.origin ?? ORIGIN;
      if (options.csrf !== false) headers['x-csrf-token'] = state.csrf;
    }
    Object.assign(headers, options.headers);
    const response = await fetch(`${app.base}${endpoint}`, {
      method, headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) state.cookie = setCookie.split(';')[0];
    const body = await response.json();
    if (body.csrfToken) state.csrf = body.csrfToken;
    if ('user' in body) state.user = body.user;
    return { status: response.status, body, headers: response.headers };
  };
  state.register = async (name, role = 'patient', extras = {}) => {
    assert.equal((await state.request('GET', '/api/session')).status, 200);
    const result = await state.request('POST', '/api/auth/register', {
      name, email: `${name.toLowerCase()}@example.test`, password: PASSWORD, role,
      ...(role === 'clinician' ? { inviteCode: INVITE } : {}), ...extras,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result;
  };
  state.patient = async () => {
    const result = await state.request('GET', '/api/patients');
    assert.equal(result.status, 200);
    return result.body.patients[0];
  };
  return state;
}

async function patientSetup(app, name = 'Alice') {
  const client = browser(app);
  await client.register(name);
  return { client, patient: await client.patient() };
}

const memoryRequest = (text = 'Patient prefers an afternoon appointment.') => ({ text, requestId: randomUUID() });
const chatRequest = (message = 'Help prepare questions for my visit.') => ({ message, requestId: randomUUID() });
const workspacePath = (p) => `/api/patients/${p.id}/workspace`;
const patientPath = (p, suffix) => `/api/patients/${p.id}/${suffix}`;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('sessions enforce HttpOnly cookies, CSRF, origin checks, rotation and logout', async (t) => {
  const app = await harness(t);
  const client = browser(app);
  const initial = await client.request('GET', '/api/session');
  assert.equal(initial.body.user, null);
  assert.match(initial.headers.get('set-cookie'), /HttpOnly/);
  assert.match(initial.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  const guestCookie = client.cookie;
  const guestCsrf = client.csrf;
  assert.equal((await client.request('GET', '/api/patients')).status, 401);
  const registration = { name: 'Alice', email: 'alice@example.test', password: PASSWORD, role: 'patient' };
  const missingCsrf = await client.request('POST', '/api/auth/register', registration, { csrf: false });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.body.code, 'CSRF_INVALID');
  assert.equal((await client.request('POST', '/api/auth/register', registration, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await client.request('POST', '/api/auth/register', registration, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const signedIn = await client.request('POST', '/api/auth/register', registration);
  assert.equal(signedIn.status, 201);
  assert.notEqual(client.cookie, guestCookie);
  assert.notEqual(client.csrf, guestCsrf);
  assert.equal('password_hash' in signedIn.body.user, false);
  assert.equal((await client.request('POST', '/api/auth/logout', {}, { headers: { 'x-csrf-token': guestCsrf } })).status, 403);
  const loginCookie = client.cookie;
  const rawToken = loginCookie.split('=')[1];
  assert.equal(app.store.get('SELECT token_hash FROM sessions WHERE token_hash=?', rawToken), undefined);
  assert.equal((await client.request('POST', '/api/auth/logout', {})).status, 200);
  assert.equal(client.user, null);
  assert.equal((await client.request('GET', '/api/patients', undefined, { headers: { Cookie: loginCookie } })).status, 401);
  assert.equal((await client.request('POST', '/api/auth/login', { email: 'alice@example.test', password: 'a wrong password' })).status, 401);
  assert.equal((await client.request('POST', '/api/auth/login', { email: 'alice@example.test', password: PASSWORD })).status, 200);
  assert.equal(client.user.role, 'patient');
});

test('password authentication preserves leading and trailing whitespace exactly', async (t) => {
  const app = await harness(t);
  const client = browser(app);
  const password = `  ${PASSWORD}  `;
  await client.register('Alice', 'patient', { password });
  await client.request('POST', '/api/auth/logout', {});
  const trimmed = await client.request('POST', '/api/auth/login', { email: 'alice@example.test', password: password.trim() });
  assert.equal(trimmed.status, 401);
  const exact = await client.request('POST', '/api/auth/login', { email: 'alice@example.test', password });
  assert.equal(exact.status, 200);
  assert.equal(exact.body.user.name, 'Alice');
});

test('patient isolation covers workspaces, messages, notes, tasks, recall and blob receipts', async (t) => {
  const app = await harness(t);
  const { client: alice, patient: a } = await patientSetup(app, 'Alice');
  const { client: bob, patient: b } = await patientSetup(app, 'Bob');
  await alice.request('PATCH', patientPath(a, 'consent'), { enabled: true });
  const note = await alice.request('POST', patientPath(a, 'notes'), { text: 'Alice private note.' });
  const task = await alice.request('POST', patientPath(a, 'tasks'), { title: 'Alice visit preparation' });
  const saved = await alice.request('POST', patientPath(a, 'memories'), memoryRequest());
  const answered = await alice.request('POST', patientPath(a, 'chat'), chatRequest());
  assert.equal(note.status, 201);
  assert.equal(task.status, 201);
  assert.equal(saved.status, 202);
  assert.equal(answered.status, 200);
  const callsBefore = { submit: app.calls.submit.length, recall: app.calls.recall.length, chat: app.calls.chat.length };
  const blocked = [
    ['GET', workspacePath(a)],
    ['GET', patientPath(a, `memories/${saved.body.memory.id}/status`)],
    ['POST', patientPath(a, 'notes'), { text: 'Unauthorized note' }],
    ['POST', patientPath(a, 'tasks'), { title: 'Unauthorized task' }],
    ['PATCH', patientPath(a, `tasks/${task.body.task.id}`), { completed: true }],
    ['POST', patientPath(a, 'memories'), memoryRequest()],
    ['POST', patientPath(a, 'recall'), { query: 'Alice private note' }],
    ['POST', patientPath(a, 'chat'), chatRequest()],
    ['PATCH', patientPath(a, 'consent'), { enabled: true }],
  ];
  for (const args of blocked) assert.equal((await bob.request(...args)).status, 404, args[1]);
  assert.equal((await bob.request('PATCH', patientPath(b, `tasks/${task.body.task.id}`), { completed: true })).status, 404);
  assert.equal((await bob.request('GET', patientPath(b, `memories/${saved.body.memory.id}/status`))).status, 404);
  assert.deepEqual({ submit: app.calls.submit.length, recall: app.calls.recall.length, chat: app.calls.chat.length }, callsBefore);
  const own = await bob.request('GET', workspacePath(b));
  assert.deepEqual(own.body.messages, []);
  assert.deepEqual(own.body.notes, []);
  assert.deepEqual(own.body.tasks, []);
  assert.deepEqual(own.body.memories, []);
  assert.equal((await bob.request('GET', '/api/patients')).body.patients.length, 1);
  const visible = (await alice.request('GET', workspacePath(a))).body;
  assert.equal(visible.messages.length, 2);
  assert.equal(visible.notes[0].text, 'Alice private note.');
  assert.equal(visible.tasks[0].completed, false);
});

test('clinician invitation and patient care code govern access; conversations remain per user', async (t) => {
  const app = await harness(t);
  const { client: alice, patient } = await patientSetup(app);
  await alice.request('POST', patientPath(patient, 'chat'), chatRequest('Patient-only conversation.'));
  const clinician = browser(app);
  await clinician.request('GET', '/api/session');
  const invalid = await clinician.request('POST', '/api/auth/register', { name: 'Doctor', email: 'doctor@example.test', password: PASSWORD, role: 'clinician', inviteCode: 'wrong' });
  assert.equal(invalid.status, 403);
  await clinician.register('Doctor', 'clinician');
  assert.equal((await clinician.request('GET', workspacePath(patient))).status, 404);
  assert.equal((await alice.request('POST', '/api/patients/link', { code: patient.careCode })).status, 403);
  const linked = await clinician.request('POST', '/api/patients/link', { code: patient.careCode });
  assert.equal(linked.status, 200);
  assert.equal('careCode' in linked.body.patient, false);
  assert.equal((await clinician.request('GET', '/api/patients')).body.patients[0].id, patient.id);
  assert.equal((await clinician.request('PATCH', patientPath(patient, 'consent'), { enabled: true })).status, 403);
  const doctorWorkspace = await clinician.request('GET', workspacePath(patient));
  assert.deepEqual(doctorWorkspace.body.messages, []);
  await clinician.request('POST', patientPath(patient, 'chat'), chatRequest('Clinician-only conversation.'));
  const patientWorkspace = await alice.request('GET', workspacePath(patient));
  assert.equal(patientWorkspace.body.messages.length, 2);
  assert.match(patientWorkspace.body.messages[0].text, /Patient-only/);
  assert.equal((await clinician.request('POST', patientPath(patient, 'notes'), { text: 'Care-team note.' })).status, 201);
  assert.equal((await alice.request('GET', workspacePath(patient))).body.notes[0].text, 'Care-team note.');
});

test('memory requires consent, enforces provenance, deduplicates saves and confirms genuine receipts', async (t) => {
  const app = await harness(t);
  const { client: alice, patient } = await patientSetup(app);
  const payload = { ...memoryRequest(), provenance: 'clinician-confirmed', role: 'clinician' };
  const denied = await alice.request('POST', patientPath(patient, 'memories'), payload);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'CONSENT_REQUIRED');
  assert.equal(app.calls.submit.length, 0);
  await alice.request('PATCH', patientPath(patient, 'consent'), { enabled: true });
  const saved = await alice.request('POST', patientPath(patient, 'memories'), payload);
  assert.equal(saved.status, 202);
  assert.equal(saved.body.memory.provenance, 'patient-reported');
  assert.equal(saved.body.memory.status, 'processing');
  assert.equal(saved.body.memory.blobId, null);
  const envelope = JSON.parse(app.calls.submit[0].text);
  assert.equal(envelope.patientId, patient.id);
  assert.equal(envelope.authorRole, 'patient');
  assert.equal(envelope.provenance, 'patient-reported');
  const repeated = await alice.request('POST', patientPath(patient, 'memories'), payload);
  assert.equal(repeated.body.memory.id, saved.body.memory.id);
  assert.equal(app.calls.submit.length, 1);
  const statusUrl = patientPath(patient, `memories/${saved.body.memory.id}/status`);
  const pending = await alice.request('GET', statusUrl);
  assert.equal(pending.body.memory.status, 'processing');
  assert.equal(pending.body.memory.blobId, null);
  app.receipts.set(saved.body.memory.jobId, Object.assign(new Error('Temporary relayer failure.'), { status: 502 }));
  assert.equal((await alice.request('GET', statusUrl)).status, 502);
  assert.equal(app.store.get('SELECT status FROM memories WHERE id=?', saved.body.memory.id).status, 'processing');
  app.receipts.set(saved.body.memory.jobId, { status: 'stored', blobId: 'confirmed-test-blob', owner: 'test-owner' });
  const completed = await alice.request('GET', statusUrl);
  assert.equal(completed.body.memory.status, 'stored');
  assert.equal(completed.body.memory.blobId, 'confirmed-test-blob');
  assert.equal((await alice.request('GET', workspacePath(patient))).body.stats.storedBlobs, 1);
  const clinician = browser(app);
  await clinician.register('Doctor', 'clinician');
  await clinician.request('POST', '/api/patients/link', { code: patient.careCode });
  const confirmed = await clinician.request('POST', patientPath(patient, 'memories'), { ...memoryRequest('Reviewed sample preference.'), provenance: 'patient-reported' });
  assert.equal(confirmed.body.memory.provenance, 'clinician-confirmed');
  assert.equal(JSON.parse(app.calls.submit[1].text).authorRole, 'clinician');
  await alice.request('PATCH', patientPath(patient, 'consent'), { enabled: false });
  assert.equal((await clinician.request('POST', patientPath(patient, 'memories'), memoryRequest())).status, 403);
  assert.equal(app.calls.submit.length, 2);
});

test('chat idempotency preserves one exchange and retrieval uses only the authorized patient namespace', async (t) => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const request = chatRequest();
  const first = await client.request('POST', patientPath(patient, 'chat'), request);
  const repeated = await client.request('POST', patientPath(patient, 'chat'), request);
  assert.equal(first.status, 200);
  assert.deepEqual(repeated.body, first.body);
  assert.equal(app.calls.chat.length, 1);
  assert.equal(app.calls.recall.length, 1);
  assert.equal(app.calls.recall[0].namespace, `vitarecall:patient:${patient.id}`);
  assert.equal(app.calls.chat[0].role, 'patient');
  assert.equal(app.calls.submit.length, 0, 'Chat must never save memory automatically.');
  assert.equal((await client.request('GET', workspacePath(patient))).body.messages.length, 2);
});

test('retrieval filters mismatched or malformed patient envelopes from responses and model context', async (t) => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const envelope = { schema: 'vitarecall.memory.v1', patientId: patient.id, provenance: 'patient-reported', recordedAt: '2026-09-29T10:00:00Z', text: 'Authorized sample preference.' };
  app.memory.recall = async () => [
    { blobId: 'valid-source', text: JSON.stringify(envelope), distance: 0.1 },
    { blobId: 'other-patient-source', text: JSON.stringify({ ...envelope, patientId: randomUUID(), text: 'Another patient private data.' }), distance: 0.1 },
    { blobId: 'malformed-source', text: JSON.stringify({ ...envelope, text: { secret: 'Invalid text value.' } }), distance: 0.1 },
  ];
  const recalled = await client.request('POST', patientPath(patient, 'recall'), { query: 'Preferences?' });
  assert.equal(recalled.status, 200);
  assert.deepEqual(recalled.body.memories.map((item) => item.blobId), ['valid-source']);
  assert.match(recalled.body.memories[0].text, /patient-reported/);
  const reply = await client.request('POST', patientPath(patient, 'chat'), chatRequest());
  assert.equal(reply.status, 200);
  assert.deepEqual(app.calls.chat[0].memories.map((item) => item.blobId), ['valid-source']);
  assert.deepEqual(reply.body.assistantMessage.sources.map((item) => item.blobId), ['valid-source']);
  assert.doesNotMatch(JSON.stringify(reply.body), /Another patient private data|Invalid text value/);
});

test('uncertain memory submissions retain an honest status and cannot be replayed into duplicate writes', async (t) => {
  const services = fakeServices();
  let attempts = 0;
  services.memory.submit = async () => {
    attempts++;
    throw Object.assign(new Error('Relayer response timed out after possible acceptance.'), { status: 504, code: 'MEMORY_TIMEOUT' });
  };
  const app = await harness(t, { services });
  const { client, patient } = await patientSetup(app);
  await client.request('PATCH', patientPath(patient, 'consent'), { enabled: true });
  const request = memoryRequest();
  const first = await client.request('POST', patientPath(patient, 'memories'), request);
  assert.equal(first.status, 202);
  assert.equal(first.body.memory.status, 'unknown');
  assert.equal(first.body.memory.blobId, null);
  assert.equal(first.body.memory.jobId, null);
  assert.match(first.body.memory.error, /could not be confirmed/);
  const repeated = await client.request('POST', patientPath(patient, 'memories'), request);
  assert.equal(repeated.body.memory.id, first.body.memory.id);
  assert.equal(attempts, 1);
  assert.equal((await client.request('GET', workspacePath(patient))).body.stats.storedBlobs, 0);
});

test('real memory adapter accepts app namespaces and requires provider job and blob receipts', async (t) => {
  const services = fakeServices();
  let accepted = { job_id: 'sdk-test-job', status: 'running' };
  let receipt = { status: 'done' };
  let submission;
  services.memory = createMemoryService({ memwalKey: 'a'.repeat(64), memwalAccountId: `0x${'b'.repeat(64)}` }, {
    createClient: () => ({
      async remember(text, namespace) { submission = { text, namespace }; return accepted; },
      async getRememberStatus() { return receipt; },
    }),
  });
  const app = await harness(t, { services });
  const { client, patient } = await patientSetup(app);
  await client.request('PATCH', patientPath(patient, 'consent'), { enabled: true });
  const saved = await client.request('POST', patientPath(patient, 'memories'), memoryRequest());
  assert.equal(saved.status, 202);
  assert.equal(saved.body.memory.status, 'processing');
  assert.equal(saved.body.memory.jobId, 'sdk-test-job');
  assert.equal(submission.namespace, `vitarecall:patient:${patient.id}`);
  const statusUrl = patientPath(patient, `memories/${saved.body.memory.id}/status`);
  assert.equal((await client.request('GET', statusUrl)).status, 502, 'done without a blob ID must not become stored');
  assert.equal(app.store.get('SELECT status FROM memories WHERE id=?', saved.body.memory.id).status, 'processing');
  receipt = { status: 'done', blob_id: 'confirmed-sdk-blob', owner: 'sdk-owner' };
  assert.equal((await client.request('GET', statusUrl)).body.memory.blobId, 'confirmed-sdk-blob');
  accepted = { status: 'running' };
  const unconfirmed = await client.request('POST', patientPath(patient, 'memories'), memoryRequest('No job ID was returned.'));
  assert.equal(unconfirmed.body.memory.status, 'unknown');
  assert.equal(unconfirmed.body.memory.jobId, null);
  assert.equal(unconfirmed.body.memory.blobId, null);
});

test('concurrent chat requests do not create duplicated or interleaved exchanges', async (t) => {
  const services = fakeServices();
  const entered = deferred();
  const released = deferred();
  let modelCalls = 0;
  services.chat.respond = async () => { modelCalls++; entered.resolve(); return released.promise; };
  const app = await harness(t, { services });
  const { client, patient } = await patientSetup(app);
  const request = chatRequest();
  const first = client.request('POST', patientPath(patient, 'chat'), request);
  await entered.promise;
  assert.equal((await client.request('POST', patientPath(patient, 'chat'), request)).status, 409);
  assert.equal((await client.request('POST', patientPath(patient, 'chat'), chatRequest('An overlapping request.'))).status, 409);
  released.resolve('An explicitly injected test response.');
  assert.equal((await first).status, 200);
  assert.equal(modelCalls, 1);
  assert.equal((await client.request('GET', workspacePath(patient))).body.messages.length, 2);
});

test('revoking a clinician rotates the care code and blocks access and relinking', async (t) => {
  const app = await harness(t);
  const { client: alice, patient } = await patientSetup(app);
  const clinician = browser(app);
  await clinician.register('Doctor', 'clinician');
  await clinician.request('POST', '/api/patients/link', { code: patient.careCode });
  const removed = await alice.request('DELETE', patientPath(patient, `care-team/${clinician.user.id}`), {});
  assert.equal(removed.status, 200);
  assert.notEqual(removed.body.patient.careCode, patient.careCode);
  assert.equal((await clinician.request('GET', workspacePath(patient))).status, 404);
  assert.equal((await clinician.request('POST', '/api/patients/link', { code: patient.careCode })).status, 404);
  assert.equal((await clinician.request('POST', patientPath(patient, 'notes'), { text: 'No access.' })).status, 404);
  const rotated = await alice.request('POST', patientPath(patient, 'care-code'), {});
  assert.notEqual(rotated.body.patient.careCode, removed.body.patient.careCode);
  assert.equal((await clinician.request('POST', '/api/patients/link', { code: removed.body.patient.careCode })).status, 404);
});

test('revocation while recall is pending prevents returned context from reaching chat or the revoked clinician', async (t) => {
  const services = fakeServices();
  const entered = deferred();
  const released = deferred();
  services.memory.recall = async () => { entered.resolve(); return released.promise; };
  const app = await harness(t, { services });
  const { client: alice, patient } = await patientSetup(app);
  const clinician = browser(app);
  await clinician.register('Doctor', 'clinician');
  await clinician.request('POST', '/api/patients/link', { code: patient.careCode });
  const inFlight = clinician.request('POST', patientPath(patient, 'chat'), chatRequest());
  await entered.promise;
  await alice.request('DELETE', patientPath(patient, `care-team/${clinician.user.id}`), {});
  released.resolve([{ blobId: 'private-blob', text: 'Private recalled patient data.', distance: 0.1 }]);
  const result = await inFlight;
  assert.equal(result.status, 404);
  assert.equal(services.calls.chat.length, 0, 'A revoked clinician must not trigger sending recalled data to the model.');
  assert.doesNotMatch(JSON.stringify(result.body), /Private recalled/);
  assert.equal(app.store.get('SELECT COUNT(*) AS count FROM messages').count, 0);
});

test('accounts, notes, tasks, chat exchanges and confirmed blob receipts survive a database reopen', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vitarecall-integration-'));
  const app = await harness(t, { filename: path.join(directory, 'test.sqlite') });
  // Only remove this test's uniquely allocated temporary directory, after closing SQLite.
  t.after(async () => {
    await app.stop();
    const target = path.resolve(directory);
    assert.ok(target.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    assert.ok(path.basename(target).startsWith('vitarecall-integration-'));
    rmSync(target, { recursive: true, force: true });
  });
  const { client: alice, patient } = await patientSetup(app);
  await alice.request('PATCH', patientPath(patient, 'consent'), { enabled: true });
  await alice.request('POST', patientPath(patient, 'notes'), { text: 'A persistent private note.' });
  const task = await alice.request('POST', patientPath(patient, 'tasks'), { title: 'Bring visit questions' });
  await alice.request('PATCH', patientPath(patient, `tasks/${task.body.task.id}`), { completed: true });
  const chatBody = chatRequest('Remember this conversation across server restarts.');
  const reply = await alice.request('POST', patientPath(patient, 'chat'), chatBody);
  const saved = await alice.request('POST', patientPath(patient, 'memories'), memoryRequest());
  app.receipts.set(saved.body.memory.jobId, { status: 'stored', blobId: 'persistent-test-blob', owner: 'owner' });
  await alice.request('GET', patientPath(patient, `memories/${saved.body.memory.id}/status`));
  const accountId = alice.user.id;
  await app.restart();
  const restored = await alice.request('GET', workspacePath(patient));
  assert.equal(restored.status, 200, 'The persisted session should also survive a restart.');
  assert.equal(restored.body.patient.memoryConsent, true);
  assert.equal(restored.body.notes[0].text, 'A persistent private note.');
  assert.equal(restored.body.tasks[0].completed, true);
  assert.equal(restored.body.messages.length, 2);
  assert.deepEqual(restored.body.messages.map(message => message.role), ['user', 'assistant'], 'Same-millisecond messages must retain their insertion order after reload.');
  assert.equal(restored.body.memories[0].blobId, 'persistent-test-blob');
  assert.equal(restored.body.stats.storedBlobs, 1);
  const repeated = await alice.request('POST', patientPath(patient, 'chat'), chatBody);
  assert.deepEqual(repeated.body, reply.body);
  assert.equal(app.calls.chat.length, 1);
  const secondDevice = browser(app);
  await secondDevice.request('GET', '/api/session');
  const login = await secondDevice.request('POST', '/api/auth/login', { email: 'alice@example.test', password: PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(secondDevice.user.id, accountId);
  assert.equal((await secondDevice.request('GET', workspacePath(patient))).body.memories[0].blobId, 'persistent-test-blob');
});
