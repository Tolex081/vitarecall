// Live Gemini + existing Walrus recall through the app API. No new blob writes.
// Uses the private synthetic-profile login locally; never prints credentials.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config.js';

const config = loadConfig();
if (!config.geminiApiKey.trim()) {
  console.error('GEMINI_API_KEY is empty. Add your Google AI Studio key to .env, restart the API, and rerun this check.');
  process.exit(1);
}
let cookie = '', csrf = '';
async function request(method, endpoint, body) {
  const response = await fetch(`${config.appOrigin}/api${endpoint}`, {
    method, signal: AbortSignal.timeout(90000),
    headers: { Cookie: cookie, ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: config.appOrigin, 'X-CSRF-Token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const result = await response.json();
  if (result.csrfToken) csrf = result.csrfToken;
  if (!response.ok) throw Object.assign(new Error('App verification failed'), { safeCode: result.code || `HTTP_${response.status}` });
  return result;
}
try {
  const login = JSON.parse(readFileSync(path.join(config.dataDir, 'mainnet-demo-login.json'), 'utf8'));
  const proof = JSON.parse(readFileSync(path.join(config.dataDir, 'mainnet-proof.json'), 'utf8'));
  if (!proof.blobId || proof.status !== 'stored') throw new Error('Existing proof required');
  await request('GET', '/session');
  const session = await request('POST', '/auth/login', { email: login.email, password: login.password });
  if (!session.services.chatConfigured) throw Object.assign(new Error('Restart API'), { safeCode: 'RESTART_API_TO_LOAD_GEMINI_KEY' });
  const { patients } = await request('GET', '/patients');
  const patient = patients.find(item => item.id === proof.patientId);
  if (!patient) throw new Error('Existing demo workspace missing');
  const result = await request('POST', `/patients/${patient.id}/chat`, {
    message: 'This is a fictional demo. What appointment-summary style do I prefer? Use my saved Walrus memory if available.',
    freshConversation: true, requestId: randomUUID(),
  });
  if (!result.assistantMessage.sources?.some(source => source.blobId === proof.blobId)) throw Object.assign(new Error('Missing existing source'), { safeCode: 'EXISTING_WALRUS_SOURCE_NOT_RECALLED' });
  if (result.assistantMessage.memoryTrace?.historyUsed !== false) throw new Error('Fresh-conversation check failed');
  const evidence = { verifiedAt: new Date().toISOString(), model: session.services.model, blobId: proof.blobId, memoryTrace: result.assistantMessage.memoryTrace, reply: result.assistantMessage.text, newBlobsWritten: 0 };
  writeFileSync(path.join(config.dataDir, 'chat-proof.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(JSON.stringify({ verified: false, code: /^[A-Z0-9_]+$/.test(error.safeCode || '') ? error.safeCode : 'VERIFICATION_INCOMPLETE', message: 'No credentials were printed and no new Walrus blob was submitted.' }));
  process.exitCode = 1;
} finally {
  if (cookie && csrf) await request('POST', '/auth/logout', {}).catch(() => {});
}
