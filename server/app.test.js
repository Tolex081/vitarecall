import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createTestStore } from './test-store.js';
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

function fakeTelegram() {
  const sent = [];
  return {
    configured: true, username: 'VitaRecallTestBot', sent,
    verifyWebhook: value => value === 'telegram-test-secret',
    async sendText(chatId, text) { sent.push({ chatId, text }); },
    async setWebhook() { return true; },
    linkUrl: token => `https://t.me/VitaRecallTestBot?start=${token}`,
  };
}

async function harness(t, { filename = ':memory:', services = fakeServices(), telegram, runInBackground } = {}) {
  const state = { store: null, server: null, base: null, telegram, ...services };
  async function start() {
    state.store = await createTestStore(filename);
    const app = createApp({ config: testConfig, store: state.store, memory: services.memory, chat: services.chat, telegram, runInBackground });
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
    if (state.store) { await state.store.close(); state.store = null; }
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
      name, email: `${name.toLowerCase()}@example.test`, password: PASSWORD, role, automaticMemory: false,
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

test('server starts automatic storage without a browser sync request, including after chat is cleared', async t => {
  const scheduled = [];
  const app = await harness(t, { runInBackground: (task, deadline) => { assert.ok(deadline > Date.now()); scheduled.push(task); } });
  const { client, patient } = await patientSetup(app);
  const route = suffix => patientPath(patient, suffix);
  await client.request('POST', route('chat'), chatRequest('Before consent: do not upload.'));
  assert.equal(scheduled.length, 0);
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: true });
  const request = chatRequest('Fictional full exchange automatically saved.');
  const reply = await client.request('POST', route('chat'), request);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.conversationMemory.counts.queued, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(app.calls.submit.length, 0, 'chat response does not wait for Walrus');
  assert.equal((await client.request('POST', route('conversation/reset'), {})).status, 200);
  app.memory.receipt = async () => ({ status: 'stored', blobId: 'server-background-fixture-blob' });
  await scheduled.shift()();
  const workspace = await client.request('GET', workspacePath(patient));
  assert.equal(workspace.body.messages.length, 0);
  assert.equal(workspace.body.conversationMemory.counts.stored, 1);
  assert.equal(workspace.body.conversationMemory.records[0].blobId, 'server-background-fixture-blob');
  assert.equal(app.calls.submit.length, 1);
  assert.match(app.calls.submit[0].text, /Fictional full exchange automatically saved/);
  assert.match(app.calls.submit[0].text, /Vita AI-generated/);
  await client.request('POST', route('chat'), request);
  assert.equal(app.calls.submit.length, 1, 'retrying a completed chat cannot duplicate its archive');
});

test('background work rechecks consent, and explicit earlier-chat archiving also starts automatically', async t => {
  const scheduled = [];
  const app = await harness(t, { runInBackground: task => scheduled.push(task) });
  const { client, patient } = await patientSetup(app);
  const route = suffix => patientPath(patient, suffix);
  await client.request('POST', route('chat'), chatRequest('Fictional earlier exchange.'));
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: true });
  assert.equal((await client.request('POST', route('conversation-memory/backfill'), {})).status, 200);
  assert.equal(scheduled.length, 1);
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: false });
  await scheduled.shift()();
  assert.equal(app.calls.submit.length, 0);
  const state = (await client.request('GET', workspacePath(patient))).body.conversationMemory;
  assert.equal(state.counts.cancelled, 1);
});

test('an opted-out profile requires enabling automatic memory, saves full exchanges once, and recalls after clear', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const route = suffix => patientPath(patient, suffix);
  await client.request('PATCH', route('consent'), { enabled: true });
  const old = await client.request('POST', route('chat'), { message: 'Before automatic consent.', requestId: randomUUID() });
  assert.equal(old.body.conversationMemory.enabled, false);
  assert.equal(old.body.conversationMemory.records.length, 0, 'Manual save consent must not authorize full transcripts.');
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: true });
  const payload = { message: 'My fictional name is Mira. I prefer examples with beans.', requestId: randomUUID() };
  const reply = await client.request('POST', route('chat'), payload);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.conversationMemory.counts.queued, 1);
  assert.equal(reply.body.conversationMemory.counts.stored, 0);
  assert.match(reply.body.conversationMemory.records[0].text, /User-reported.*\nMy fictional/s);
  assert.match(reply.body.conversationMemory.records[0].text, /Vita AI-generated \(not a clinical record\)/);
  await client.request('POST', route('chat'), payload);
  await client.request('POST', route('conversation/reset'), {});
  assert.deepEqual((await client.request('GET', workspacePath(patient))).body.messages, []);
  const sibling = sameSession(await siblingInstance(t, app), client);
  await Promise.all([client.request('POST', route('conversation-memory/sync'), {}), sibling.request('POST', route('conversation-memory/sync'), {})]);
  assert.equal(app.calls.submit.length, 1);
  const submission = app.calls.submit[0];
  assert.equal(submission.namespace, `vitarecall:chat:${patient.id}:${client.user.id}`);
  assert.ok(submission.text.length <= 8000);
  app.receipts.set('test-job-1', { status: 'stored', blobId: 'test-auto-blob' });
  const synced = await client.request('POST', route('conversation-memory/sync'), {});
  assert.equal(synced.body.conversationMemory.counts.stored, 1);
  assert.equal(synced.body.conversationMemory.records[0].blobId, 'test-auto-blob');
  app.memory.recall = async (_query, namespace) => namespace === submission.namespace ? [{ text: submission.text, blobId: 'test-auto-blob' }] : [];
  const recall = await client.request('POST', route('chat'), { message: 'What is my name and food preference?', requestId: randomUUID() });
  assert.equal(recall.status, 200);
  assert.deepEqual(recall.body.assistantMessage.memoryTrace, { status: 'recalled', sourceCount: 1, historyUsed: false });
  assert.deepEqual(app.calls.chat.at(-1).history, []);
  assert.match(app.calls.chat.at(-1).memories[0].text, /Mira/);
  assert.equal(app.calls.chat.at(-1).automaticMemoryEnabled, true);
});

test('earlier hidden chats need explicit backfill, which is idempotent; pausing cancels queued work', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const route = suffix => patientPath(patient, suffix);
  await client.request('POST', route('chat'), { message: 'Old fictional exchange.', requestId: randomUUID() });
  await client.request('POST', route('conversation/reset'), {});
  assert.equal((await client.request('POST', route('conversation-memory/backfill'), {})).status, 403);
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: true });
  assert.equal((await client.request('GET', workspacePath(patient))).body.conversationMemory.records.length, 0);
  const backfill = await client.request('POST', route('conversation-memory/backfill'), {});
  assert.equal(backfill.status, 200);
  assert.equal(backfill.body.remaining, false);
  assert.equal(backfill.body.conversationMemory.counts.queued, 1);
  assert.match(backfill.body.conversationMemory.records[0].text, /Old fictional exchange/);
  assert.equal((await client.request('POST', route('conversation-memory/backfill'), {})).body.conversationMemory.records.length, 1);
  const paused = await client.request('PATCH', route('conversation-memory/consent'), { enabled: false });
  assert.equal(paused.body.conversationMemory.counts.cancelled, 1);
  await client.request('POST', route('conversation-memory/sync'), {});
  assert.equal(app.calls.submit.length, 0);
  const next = await client.request('POST', route('chat'), { message: 'Not archived after pause.', requestId: randomUUID() });
  assert.equal(next.body.conversationMemory.records.length, 1);
});

test('automatic memory cannot leak to other patients or linked clinicians', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const route = suffix => patientPath(patient, suffix);
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: true });
  await client.request('POST', route('chat'), { message: 'Private fictional conversation.', requestId: randomUUID() });
  await client.request('POST', route('conversation-memory/sync'), {});
  const outsider = (await patientSetup(app, 'Bob')).client;
  for (const suffix of ['conversation-memory/sync', 'conversation-memory/backfill']) assert.equal((await outsider.request('POST', route(suffix), {})).status, 404);
  const clinician = browser(app);
  await clinician.register('Doctor', 'clinician');
  await clinician.request('POST', '/api/patients/link', { code: patient.careCode });
  const workspace = await clinician.request('GET', workspacePath(patient));
  assert.deepEqual(workspace.body.conversationMemory.records, []);
  assert.equal((await clinician.request('PATCH', route('conversation-memory/consent'), { enabled: true })).status, 403);
  assert.equal((await clinician.request('POST', route('conversation-memory/sync'), {})).status, 403);
  // Even a misrouted provider result must match both patient and private author.
  app.memory.recall = async () => [{ blobId: 'misrouted-private', text: app.calls.submit[0].text }];
  const result = await clinician.request('POST', route('chat'), { message: 'What was said?', requestId: randomUUID() });
  assert.equal(result.body.assistantMessage.sources.length, 0);
});

test('automatic storage uncertainty never triggers duplicate uploads or fake confirmation', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const route = suffix => patientPath(patient, suffix);
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: true });
  await client.request('POST', route('chat'), { message: 'Fictional uncertain save.', requestId: randomUUID() });
  let submits = 0;
  app.memory.submit = async () => { submits++; throw new Error('private upstream details'); };
  for (let i = 0; i < 2; i++) {
    const response = await client.request('POST', route('conversation-memory/sync'), {});
    assert.equal(response.body.conversationMemory.counts.unknown, 1);
    assert.equal(response.body.conversationMemory.counts.stored, 0);
    assert.doesNotMatch(JSON.stringify(response.body), /private upstream details/);
  }
  assert.equal(submits, 1);
  app.memory.submit = async () => ({ jobId: 'incomplete-receipt' });
  app.memory.receipt = async () => ({ status: 'stored' });
  await client.request('POST', route('chat'), { message: 'Fictional second exchange.', requestId: randomUUID() });
  const result = await client.request('POST', route('conversation-memory/sync'), {});
  assert.equal(result.body.conversationMemory.counts.stored, 0);
  assert.equal(result.body.conversationMemory.counts.processing, 1);
});

test('withdrawing automatic consent during a model reply prevents archiving the exchange', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const route = suffix => patientPath(patient, suffix);
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: true });
  app.chat.respond = async () => {
    assert.equal((await client.request('PATCH', route('conversation-memory/consent'), { enabled: false })).status, 200);
    return 'Fictional reply after consent was withdrawn.';
  };
  const result = await client.request('POST', route('chat'), { message: 'Please explain.', requestId: randomUUID() });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.conversationMemory.records, []);
});

// Separate Express instances deliberately share only durable database state.
// This simulates requests reaching different serverless function instances.
async function siblingInstance(t, app) {
  const sibling = createApp({ config: testConfig, store: app.store, memory: app.memory, chat: app.chat });
  const server = await new Promise(resolve => {
    const listener = sibling.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

function sameSession(app, client) {
  const other = browser(app);
  other.cookie = client.cookie;
  other.csrf = client.csrf;
  other.user = client.user;
  return other;
}

const memoryRequest = (text = 'Patient prefers an afternoon appointment.') => ({ text, requestId: randomUUID() });
const chatRequest = (message = 'Help prepare questions for my visit.') => ({ message, requestId: randomUUID() });

test('new email patient accounts default automatic memory on and retain opt-out after signing in', async t => {
  const app = await harness(t), client = browser(app);
  await client.register('Defaultpatient', 'patient', { automaticMemory: undefined });
  const patient = await client.patient();
  assert.equal((await client.request('GET', workspacePath(patient))).body.conversationMemory.enabled, true);
  const reply = await client.request('POST', patientPath(patient, 'chat'), chatRequest('Fictional first email-profile chat.'));
  assert.equal(reply.body.conversationMemory.counts.queued, 1);
  await client.request('PATCH', patientPath(patient, 'conversation-memory/consent'), { enabled: false });
  await client.request('POST', '/api/auth/logout', {});
  await client.request('POST', '/api/auth/login', { email: 'defaultpatient@example.test', password: PASSWORD, automaticMemory: true });
  const state = (await client.request('GET', workspacePath(patient))).body.conversationMemory;
  assert.equal(state.enabled, false);
  assert.equal(state.counts.cancelled, 1);
});
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
  assert.equal(await app.store.get('SELECT token_hash FROM sessions WHERE token_hash=?', rawToken), undefined);
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
  assert.equal((await app.store.get('SELECT status FROM memories WHERE id=?', saved.body.memory.id)).status, 'processing');
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
  assert.equal(app.calls.submit.length, 0, 'Chat must not save automatically without automatic-memory consent.');
  assert.equal((await client.request('GET', workspacePath(patient))).body.messages.length, 2);
});

test('retrying a confirmed chat failure uses the same request ID and commits one exchange and archive', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  await client.request('PATCH', patientPath(patient, 'conversation-memory/consent'), { enabled: true });
  const request = chatRequest('Fictional retry example.');
  let attempts = 0;
  app.chat.respond = async () => {
    if (++attempts === 1) throw Object.assign(new Error('Temporary provider outage.'), { status: 503, code: 'LLM_UNAVAILABLE' });
    return 'Test reply after explicit retry.';
  };
  assert.equal((await client.request('POST', patientPath(patient, 'chat'), request)).status, 503);
  const failed = (await client.request('GET', workspacePath(patient))).body;
  assert.equal(failed.messages.length, 0);
  assert.equal(failed.conversationMemory.records.length, 0);
  const retried = await client.request('POST', patientPath(patient, 'chat'), request);
  assert.equal(retried.status, 200);
  const repeated = await client.request('POST', patientPath(patient, 'chat'), request);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.assistantMessage.id, retried.body.assistantMessage.id);
  assert.equal(attempts, 2);
  const workspace = (await client.request('GET', workspacePath(patient))).body;
  assert.equal(workspace.messages.length, 2);
  assert.equal(workspace.conversationMemory.records.length, 1);
});

test('a pending chat with an uncertain outcome is never reopened by retry', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const request = chatRequest('Unknown prior outcome.');
  await app.store.run('INSERT INTO chat_requests VALUES (?,?,?,?,?,?)', patient.id, client.user.id, request.requestId, 'pending', null, new Date().toISOString());
  assert.equal((await client.request('POST', patientPath(patient, 'chat'), request)).status, 409);
  assert.equal(app.calls.chat.length, 0);
  assert.equal((await client.request('GET', workspacePath(patient))).body.messages.length, 0);
});

test('concurrent retries of one confirmed failure acquire only one chat lease', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  const request = chatRequest('Fictional simultaneous retry example.');
  await app.store.run('INSERT INTO chat_requests VALUES (?,?,?,?,?,?)', patient.id, client.user.id, request.requestId, 'failed', null, new Date().toISOString());
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  t.after(() => release());
  let calls = 0;
  app.chat.respond = async () => { calls++; started(); await gate; return 'One retry result.'; };
  const first = client.request('POST', patientPath(patient, 'chat'), request);
  await entered;
  const second = await client.request('POST', patientPath(patient, 'chat'), request);
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(calls, 1);
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
  assert.equal((await app.store.get('SELECT status FROM memories WHERE id=?', saved.body.memory.id)).status, 'processing');
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

test('a chat lease prevents overlapping chats and conversation resets across app instances', { timeout: 15_000 }, async t => {
  const services = fakeServices(), entered = deferred(), released = deferred();
  let modelCalls = 0;
  services.chat.respond = async () => { modelCalls++; entered.resolve(); return released.promise; };
  const app = await harness(t, { services });
  const { client, patient } = await patientSetup(app);
  const other = sameSession(await siblingInstance(t, app), client);
  const firstPayload = chatRequest('This response is still being generated.');
  const pending = client.request('POST', patientPath(patient, 'chat'), firstPayload);
  try {
    await entered.promise;
    assert.equal((await other.request('POST', patientPath(patient, 'chat'), firstPayload)).status, 409);
    assert.equal((await other.request('POST', patientPath(patient, 'chat'), chatRequest('Do not interleave.'))).status, 409);
    assert.equal((await other.request('POST', patientPath(patient, 'conversation/reset'), {})).status, 409);
  } finally { released.resolve('An injected cross-instance test response.'); }
  const completed = await pending;
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(modelCalls, 1);
  assert.equal((await other.request('GET', workspacePath(patient))).body.messages.length, 2);
  assert.deepEqual((await other.request('POST', patientPath(patient, 'chat'), firstPayload)).body, completed.body);
  assert.equal((await other.request('POST', patientPath(patient, 'conversation/reset'), {})).status, 200);
  assert.deepEqual((await client.request('GET', workspacePath(patient))).body.messages, []);
});

test('simultaneous identical memory saves on different instances submit to the provider only once', { timeout: 15_000 }, async t => {
  const services = fakeServices(), entered = deferred(), released = deferred();
  let submissions = 0;
  services.memory.submit = async () => { submissions++; entered.resolve(); await released.promise; return { jobId: 'single-cross-instance-job' }; };
  const app = await harness(t, { services });
  const { client, patient } = await patientSetup(app);
  await client.request('PATCH', patientPath(patient, 'consent'), { enabled: true });
  const other = sameSession(await siblingInstance(t, app), client);
  const payload = memoryRequest('Fictional preference: short appointment summaries.');
  const requests = [client, other].map(actor => actor.request('POST', patientPath(patient, 'memories'), payload));
  try {
    await entered.promise;
    const duplicate = await Promise.race(requests);
    assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
    assert.equal(submissions, 1);
    assert.equal(duplicate.body.memory.status, 'unknown', 'An in-flight write must never be advertised as stored.');
    assert.equal(duplicate.body.memory.blobId, null);
  } finally { released.resolve(); }
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 202]);
  assert.equal(results[0].body.memory.id, results[1].body.memory.id);
  assert.equal(submissions, 1);
  const workspace = await other.request('GET', workspacePath(patient));
  assert.equal(workspace.body.memories.length, 1);
  assert.equal(workspace.body.memories[0].jobId, 'single-cross-instance-job');
  assert.equal(workspace.body.stats.storedBlobs, 0);
});

test('memory submission limits are shared across instances and survive app recreation', async t => {
  const app = await harness(t);
  const { client, patient } = await patientSetup(app);
  await client.request('PATCH', patientPath(patient, 'consent'), { enabled: true });
  const other = sameSession(await siblingInstance(t, app), client);
  for (let index = 0; index < 6; index++) {
    const result = await (index % 2 ? other : client).request('POST', patientPath(patient, 'memories'), memoryRequest(`Fictional preference ${index}.`));
    assert.equal(result.status, 202, JSON.stringify(result.body));
  }
  const blocked = await other.request('POST', patientPath(patient, 'memories'), memoryRequest());
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  const recreated = sameSession(await siblingInstance(t, app), client);
  assert.equal((await recreated.request('POST', patientPath(patient, 'memories'), memoryRequest())).status, 429);
  assert.equal(app.calls.submit.length, 6);
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
  assert.equal(Number((await app.store.get('SELECT COUNT(*) AS count FROM messages')).count), 0);
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

test('a patient links Telegram once, then Telegram uses the same private chat history without accepting unsigned updates', async t => {
  const telegram = fakeTelegram();
  const app = await harness(t, { telegram });
  const { client, patient } = await patientSetup(app);
  const link = await client.request('POST', patientPath(patient, 'telegram/link'), {});
  assert.equal(link.status, 200);
  assert.match(link.body.startUrl, /^https:\/\/t\.me\/VitaRecallTestBot\?start=/);
  const token = new URL(link.body.startUrl).searchParams.get('start');
  const webhook = async (update, secret = 'telegram-test-secret') => fetch(`${app.base}/api/telegram/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) }, body: JSON.stringify(update),
  });
  assert.equal((await webhook({ update_id: 1, message: { chat: { id: 7001, type: 'private' }, from: { id: 7001 }, text: `/start ${token}` } }, 'wrong')).status, 401);
  assert.equal((await webhook({ update_id: 1, message: { chat: { id: 7001, type: 'private' }, from: { id: 7001 }, text: `/start ${token}` } })).status, 200);
  assert.match(telegram.sent.at(-1).text, /connected to your Vita workspace/);
  assert.equal((await webhook({ update_id: 2, message: { chat: { id: 7001, type: 'private' }, from: { id: 7001 }, text: 'Fictional question from Telegram.' } })).status, 200);
  assert.equal(app.calls.chat.length, 1);
  assert.equal(telegram.sent.at(-1).text, 'Test assistant response to: Fictional question from Telegram.');
  assert.equal((await client.request('GET', workspacePath(patient))).body.messages.length, 2, 'website and Telegram share one patient conversation');
  await webhook({ update_id: 2, message: { chat: { id: 7001, type: 'private' }, from: { id: 7001 }, text: 'Fictional question from Telegram.' } });
  assert.equal(app.calls.chat.length, 1, 'a retried Telegram update cannot create a second reply');
});
