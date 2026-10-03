import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { createTestStore } from './test-store.js';

const origin = 'http://localhost:5173';
async function harness(t) {
  const store = await createTestStore(':memory:');
  const calls = { chat: [], recall: [], submit: [] };
  const memory = {
    configured: true, accountId: `0x${'a'.repeat(64)}`,
    async recall(query, namespace) { calls.recall.push({ query, namespace }); return []; },
    async submit(text, namespace) { calls.submit.push({ text, namespace }); return { jobId: 'test-demo-job' }; },
    async receipt() { return { status: 'stored', blobId: 'test-demo-blob' }; },
    async verify() { return { connected: true, network: 'mainnet', accountId: this.accountId }; },
  };
  const chat = { configured: true, model: 'injected-test-model', async respond(input) { calls.chat.push(input); return 'Injected test response.'; } };
  const config = { production: false, secureCookies: false, appOrigin: origin, clinicianInviteCode: 'advanced-invite', telegramBotToken: 'telegram-login-test-token', telegramBotUsername: 'VitaRecallTestBot' };
  const app = createApp({ config, store, memory, chat });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const state = { cookie: '', csrf: '' };
    state.request = async (method, route, body) => {
      const response = await fetch(`${base}${route}`, {
        method, headers: { Cookie: state.cookie, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: origin, 'x-csrf-token': state.csrf }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const cookie = response.headers.get('set-cookie');
      if (cookie) state.cookie = cookie.split(';')[0];
      const json = await response.json();
      if (json.csrfToken) state.csrf = json.csrfToken;
      return { status: response.status, body: json, headers: response.headers };
    };
    state.create = async (username = 'synthetic_user', role = 'patient', options = {}) => {
      await state.request('GET', '/api/session');
      const created = await state.request('POST', '/api/auth/demo', { username, role, automaticMemory: false, ...options });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      return created;
    };
    state.patient = async () => (await state.request('GET', '/api/patients')).body.patients[0];
    return state;
  }
  return { store, calls, memory, chat, client, base };
}
const patientUrl = (patient, route) => `/api/patients/${patient.id}/${route}`;
const chatRequest = (message, extra = {}) => ({ message, requestId: randomUUID(), ...extra });
const telegramLogin = ({ id = 7001, authDate = Math.floor(Date.now() / 1000) } = {}) => {
  const payload = { id, first_name: 'Ada', last_name: 'Okafor', username: 'ada_example', auth_date: authDate };
  const dataCheck = Object.keys(payload).sort().map(key => `${key}=${payload[key]}`).join('\n');
  const secret = createHash('sha256').update('telegram-login-test-token').digest();
  return { ...payload, hash: createHmac('sha256', secret).update(dataCheck).digest('hex') };
};

test('new demo profiles default memory on, save the first exchange, and preserve a later opt-out across restore', async t => {
  const app = await harness(t), client = app.client();
  const created = await client.create('default_on_demo', 'patient', { automaticMemory: undefined });
  const patient = await client.patient(), route = suffix => patientUrl(patient, suffix);
  const initial = (await client.request('GET', route('workspace'))).body;
  assert.equal(initial.conversationMemory.enabled, true);
  assert.equal(patient.memoryConsent, false, 'Reviewed care-team notes remain a separate setting.');
  const reply = await client.request('POST', route('chat'), chatRequest('Fictional first exchange, automatically archived.'));
  assert.equal(reply.body.conversationMemory.counts.queued, 1);
  const saved = await client.request('POST', route('conversation-memory/sync'), {});
  assert.equal(saved.body.conversationMemory.counts.stored, 1);
  assert.equal(saved.body.conversationMemory.records[0].blobId, 'test-demo-blob');
  await client.request('PATCH', route('conversation-memory/consent'), { enabled: false });
  await client.request('POST', route('conversation/reset'), {});
  const other = app.client();
  await other.request('GET', '/api/session');
  assert.equal((await other.request('POST', '/api/auth/demo/restore', { username: 'default_on_demo', recoveryCode: created.body.recoveryCode, automaticMemory: true })).status, 200);
  const restored = (await other.request('GET', route('workspace'))).body;
  assert.equal(restored.conversationMemory.enabled, false, 'Restore must never re-enable an opted-out profile.');
  assert.equal(restored.conversationMemory.counts.stored, 1);
  assert.deepEqual(restored.messages, []);
  const after = await other.request('POST', route('chat'), chatRequest('No upload while paused.'));
  assert.equal(after.body.conversationMemory.records.length, 1);
  assert.equal(after.body.conversationMemory.counts.queued, 0);
});

test('sign-up opt-out and legacy profiles stay off, and non-boolean preferences are rejected', async t => {
  const app = await harness(t), client = app.client();
  const created = await client.create('opt_out_demo', 'patient', { automaticMemory: false });
  const patient = await client.patient(), route = suffix => patientUrl(patient, suffix);
  assert.equal((await client.request('GET', route('workspace'))).body.conversationMemory.enabled, false);
  // Simulate an account from before automatic settings existed.
  await app.store.run('DELETE FROM conversation_memory_settings WHERE patient_id=? AND user_id=?', patient.id, created.body.user.id);
  assert.equal((await client.request('GET', route('workspace'))).body.conversationMemory.enabled, false);
  await client.request('POST', route('chat'), chatRequest('Legacy profile must not be silently opted in.'));
  assert.equal((await client.request('GET', route('workspace'))).body.conversationMemory.records.length, 0);
  for (const automaticMemory of ['false', 1, null, {}]) {
    const response = await client.request('POST', '/api/auth/demo', { username: 'invalid_pref', automaticMemory });
    assert.equal(response.status, 400);
  }
});

test('a demo handle creates an isolated unverified workspace and a once-only hashed recovery credential', async t => {
  const app = await harness(t), first = app.client(), second = app.client();
  const created = await first.create('@Demo_User');
  const user = created.body.user;
  assert.equal(user.username, 'demo_user');
  assert.equal(user.name, '@demo_user');
  assert.equal(user.isDemo, true);
  assert.equal(user.email, null);
  assert.equal(user.avatarUrl, '/api/avatar/twitter/demo_user');
  assert.equal('password_hash' in user, false);
  assert.match(created.headers.get('set-cookie'), /HttpOnly/);
  assert.match(created.headers.get('set-cookie'), /SameSite=Strict/);
  assert.match(created.headers.get('set-cookie'), /Max-Age=604800/);
  assert.match(created.body.recoveryCode, /^[A-Za-z0-9_-]{43}$/);
  const stored = await app.store.get('SELECT * FROM demo_profiles WHERE user_id=?', user.id);
  assert.notEqual(stored.recovery_hash, created.body.recoveryCode);
  assert.equal('recoveryCode' in stored, false);
  const firstPatient = await first.patient();
  assert.equal(firstPatient.isDemo, true);
  assert.equal(firstPatient.memoryConsent, false);
  assert.equal(firstPatient.canManageConsent, true);
  await first.request('POST', patientUrl(firstPatient, 'notes'), { text: 'Synthetic note kept private.' });
  const other = await second.create('demo_user');
  assert.notEqual(other.body.user.id, user.id, 'Public usernames must never sign into an existing account.');
  assert.notEqual((await second.patient()).id, firstPatient.id);
  assert.equal((await second.request('GET', patientUrl(firstPatient, 'workspace'))).status, 404);
  const loaded = await first.request('GET', '/api/session');
  assert.equal(loaded.body.user.username, 'demo_user');
  assert.equal('recoveryCode' in loaded.body, false);
});

test('verified Telegram sign-in is unique across browsers and reopens a previously bot-linked workspace', async t => {
  const app = await harness(t), first = app.client(), second = app.client(), legacy = app.client();
  await first.request('GET', '/api/session');
  const created = await first.request('POST', '/api/auth/telegram', telegramLogin());
  assert.equal(created.status, 201);
  assert.equal(created.body.user.authProvider, 'telegram');
  assert.equal(created.body.user.email, null);
  assert.equal(created.body.user.isDemo, false);
  const patient = await first.patient();
  await first.request('POST', patientUrl(patient, 'chat'), chatRequest('A fictional chat that should remain in this workspace.'));
  await second.request('GET', '/api/session');
  const restored = await second.request('POST', '/api/auth/telegram', telegramLogin());
  assert.equal(restored.status, 200);
  assert.equal(restored.body.user.id, created.body.user.id);
  assert.equal((await second.patient()).id, patient.id);
  assert.equal((await second.request('GET', patientUrl(patient, 'workspace'))).body.messages.length, 2);
  const altered = telegramLogin({ id: 7002 });
  altered.first_name = 'Imposter';
  await legacy.request('GET', '/api/session');
  assert.equal((await legacy.request('POST', '/api/auth/telegram', altered)).status, 401, 'a payload modified after Telegram signs it is rejected');

  const demo = await legacy.create('linked_existing');
  const demoPatient = await legacy.patient();
  await app.store.run('INSERT INTO telegram_connections VALUES (?,?,?,?,?,?)', '8008', '8008', demoPatient.id, demo.body.user.id, '2026-10-04', '2026-10-04');
  const third = app.client();
  await third.request('GET', '/api/session');
  const claimed = await third.request('POST', '/api/auth/telegram', telegramLogin({ id: 8008 }));
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.user.id, demo.body.user.id);
  assert.equal((await third.patient()).id, demoPatient.id);
  assert.equal((await app.store.get("SELECT subject FROM external_identities WHERE provider='telegram' AND user_id=?", demo.body.user.id)).subject, '8008');
});

test('Telegram signed redirect creates a session without requiring an unsafe browser callback', async t => {
  const app = await harness(t);
  const payload = telegramLogin({ id: 9009 });
  const redirect = await fetch(`${app.base}/api/auth/telegram/callback?${new URLSearchParams(payload)}`, { redirect: 'manual' });
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), origin);
  const cookie = redirect.headers.get('set-cookie').split(';')[0];
  const session = await fetch(`${app.base}/api/session`, { headers: { Cookie: cookie } }).then(response => response.json());
  assert.equal(session.user.authProvider, 'telegram');
  assert.equal(session.user.name, 'Ada Okafor');
});

test('only the matching private recovery code restores the same demo namespace on another device', async t => {
  const app = await harness(t), first = app.client(), second = app.client();
  const created = await first.create('returning_demo');
  const patient = await first.patient();
  await first.request('PATCH', patientUrl(patient, 'consent'), { enabled: true });
  await first.request('POST', patientUrl(patient, 'memories'), { text: 'Fictional appointment preference.', requestId: randomUUID() });
  await second.request('GET', '/api/session');
  const guestCookie = second.cookie;
  assert.equal((await second.request('POST', '/api/auth/demo/restore', { username: 'returning_demo', recoveryCode: 'wrong-code' })).status, 401);
  assert.equal((await second.request('POST', '/api/auth/demo/restore', { username: 'someone_else', recoveryCode: created.body.recoveryCode })).status, 401);
  const restored = await second.request('POST', '/api/auth/demo/restore', { username: '@RETURNING_DEMO', recoveryCode: created.body.recoveryCode });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.user.id, created.body.user.id);
  assert.notEqual(second.cookie, guestCookie);
  assert.equal('recoveryCode' in restored.body, false);
  assert.equal((await second.patient()).id, patient.id);
  const workspace = (await second.request('GET', patientUrl(patient, 'workspace'))).body;
  assert.equal(workspace.memories[0].text, 'Fictional appointment preference.');
  assert.equal(workspace.memories[0].provenance, 'demo-patient-reported');
});

test('invalid demo handles and roles are rejected without creating an account', async t => {
  const app = await harness(t), client = app.client();
  await client.request('GET', '/api/session');
  for (const username of ['', '@', 'two words', '../anything', 'a'.repeat(16), 'name?query=1', '@@double', null]) {
    const result = await client.request('POST', '/api/auth/demo', { username, role: 'patient' });
    assert.equal(result.status, 400, String(username));
  }
  assert.equal((await client.request('POST', '/api/auth/demo', { username: 'demo', role: 'admin' })).status, 400);
  assert.equal(Number((await app.store.get('SELECT COUNT(*) AS count FROM users')).count), 0);
});

test('demo clinicians need no invite but cannot assert verified provenance or enter non-demo workspaces', async t => {
  const app = await harness(t), clinician = app.client(), patientClient = app.client(), advanced = app.client();
  await clinician.create('demo_clinician', 'clinician');
  const own = await clinician.patient();
  assert.equal(own.canManageConsent, true);
  assert.equal((await clinician.request('PATCH', patientUrl(own, 'consent'), { enabled: true })).status, 200);
  const saved = await clinician.request('POST', patientUrl(own, 'memories'), { text: 'Fictional clinician-role note.', requestId: randomUUID(), provenance: 'clinician-confirmed' });
  assert.equal(saved.status, 202);
  assert.equal(saved.body.memory.provenance, 'demo-clinician-reported');
  assert.equal(JSON.parse(app.calls.submit[0].text).provenance, 'demo-clinician-reported');
  await advanced.request('GET', '/api/session');
  const registered = await advanced.request('POST', '/api/auth/register', { name: 'Advanced Patient', email: 'advanced@example.test', password: 'a long test password', role: 'patient' });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.isDemo, false);
  const protectedPatient = await advanced.patient();
  assert.equal((await clinician.request('POST', '/api/patients/link', { code: protectedPatient.careCode })).status, 403);
  assert.equal((await clinician.request('GET', patientUrl(protectedPatient, 'workspace'))).status, 404);
  await patientClient.create('demo_patient');
  const shared = await patientClient.patient();
  const linked = await clinician.request('POST', '/api/patients/link', { code: shared.careCode });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.patient.canManageConsent, false);
  assert.equal((await clinician.request('PATCH', patientUrl(shared, 'consent'), { enabled: true })).status, 403);
  assert.equal((await clinician.request('GET', '/api/patients')).body.patients.length, 2);
  assert.equal((await patientClient.request('GET', patientUrl(shared, 'workspace'))).body.careTeam[0].isDemo, true);
});

test('fresh conversations persist a transcript boundary while recalling actual provider sources every turn', async t => {
  const app = await harness(t), client = app.client();
  await client.create('memory_demo');
  const patient = await client.patient();
  app.memory.recall = async (query, namespace) => {
    app.calls.recall.push({ query, namespace });
    return [{ blobId: 'injected-provider-blob', text: 'Fictional saved preference.', distance: 0.1 }];
  };
  const first = await client.request('POST', patientUrl(patient, 'chat'), chatRequest('An old conversation.'));
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.assistantMessage.memoryTrace, { status: 'recalled', sourceCount: 1, historyUsed: false });
  await client.request('POST', patientUrl(patient, 'chat'), chatRequest('Continue old conversation.'));
  assert.equal(app.calls.chat[1].history.length, 2);
  const fresh = await client.request('POST', patientUrl(patient, 'chat'), chatRequest('What do you remember?', { freshConversation: true }));
  assert.equal(fresh.status, 200);
  assert.deepEqual(app.calls.chat[2].history, []);
  assert.equal(app.calls.chat[2].memories[0].blobId, 'injected-provider-blob');
  assert.equal(app.calls.chat[2].memoryStatus, 'recalled');
  assert.deepEqual(app.calls.chat[2].profile, { name: '@memory_demo', username: 'memory_demo', isDemo: true });
  await client.request('POST', patientUrl(patient, 'chat'), chatRequest('Continue new conversation.'));
  assert.equal(app.calls.chat[3].history.length, 2);
  assert.equal(app.calls.chat[3].history[0].text, 'What do you remember?');
  const workspace = (await client.request('GET', patientUrl(patient, 'workspace'))).body;
  assert.equal(workspace.messages.length, 4);
  assert.equal(workspace.messages[3].memoryTrace.historyUsed, true);
  assert.equal(Number((await app.store.get('SELECT COUNT(*) AS count FROM messages')).count), 8, 'Fresh conversations do not erase stored transcripts.');
  assert.equal(app.calls.recall.length, 4);
  assert.ok(app.calls.recall.every(call => call.namespace === `vitarecall:patient:${patient.id}`));
  assert.equal(app.calls.submit.length, 0, 'Chat must not save automatically without automatic-memory consent.');
  const reset = await client.request('POST', patientUrl(patient, 'conversation/reset'), {});
  assert.equal(reset.status, 200);
  assert.deepEqual((await client.request('GET', patientUrl(patient, 'workspace'))).body.messages, []);
  await client.request('POST', patientUrl(patient, 'chat'), chatRequest('After explicit reset.'));
  assert.deepEqual(app.calls.chat[4].history, []);
});

test('memory outages are transparent but do not block model replies; empty and unconfigured states stay distinct', async t => {
  const app = await harness(t), client = app.client();
  await client.create('outage_demo');
  const patient = await client.patient();
  app.memory.recall = async () => { throw new Error('Upstream private detail must not be shown.'); };
  const unavailable = await client.request('POST', patientUrl(patient, 'chat'), chatRequest('Can you help prepare for a visit?'));
  assert.equal(unavailable.status, 200);
  assert.deepEqual(unavailable.body.assistantMessage.memoryTrace, { status: 'unavailable', sourceCount: 0, historyUsed: false });
  assert.equal(app.calls.chat[0].memoryStatus, 'unavailable');
  assert.deepEqual(app.calls.chat[0].memories, []);
  assert.doesNotMatch(JSON.stringify(unavailable.body), /Upstream private/);
  app.memory.recall = async () => [];
  const empty = await client.request('POST', patientUrl(patient, 'chat'), chatRequest('Nothing saved yet.'));
  assert.equal(empty.body.assistantMessage.memoryTrace.status, 'empty');
  app.memory.configured = false;
  const unconfigured = await client.request('POST', patientUrl(patient, 'chat'), chatRequest('General support.'));
  assert.equal(unconfigured.body.assistantMessage.memoryTrace.status, 'not-configured');
  assert.equal(app.calls.chat.length, 3);
  assert.equal((await client.request('POST', patientUrl(patient, 'chat'), chatRequest('Invalid reset.', { freshConversation: 'true' }))).status, 400);
});
