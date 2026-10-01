// Explicit live demonstration: five model calls and two useful fictional archive
// writes across separate invocations. Never use real patient data in this script.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const phase = process.argv[2];
const allowed = ['before', 'save', 'after', 'correct', 'updated'];
if (!allowed.includes(phase)) throw new Error('Choose: before, save, after, correct, updated. Read docs/submission/DEMO.md first.');
const origin = process.env.DEMO_ORIGIN || 'https://vitarecall.vercel.app';
if (!/^https:\/\//.test(origin) && !/^http:\/\/localhost(?::\d+)?$/.test(origin)) throw new Error('Use HTTPS or localhost.');
const privateFile = 'data/submission-demo-private.json';
const evidenceFile = 'docs/submission/evidence.json';
const assetDir = 'docs/submission/assets';
mkdirSync('data', { recursive: true });
mkdirSync(assetDir, { recursive: true });
let login = existsSync(privateFile) ? JSON.parse(readFileSync(privateFile, 'utf8')) : null;
let proof = existsSync(evidenceFile) ? JSON.parse(readFileSync(evidenceFile, 'utf8')) : null;
if (login && login.origin !== origin) throw new Error('Origin differs from the existing private demo.');
if (!login && phase !== 'before') throw new Error('Run before first.');
if (!login && proof) throw new Error('Public evidence already exists but its private profile is missing. Do not overwrite it.');
let cookie = '', csrf = '', base;
async function api(method, route, body) {
  const response = await fetch(origin + '/api' + route, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(115000),
  });
  const next = response.headers.get('set-cookie');
  if (next) cookie = next.split(';')[0];
  const result = await response.json();
  if (result.csrfToken) csrf = result.csrfToken;
  if (!response.ok) throw Object.assign(new Error('Demo request did not complete. Inspect the workspace before retrying; no raw upstream error is logged.'), { status: response.status, code: result.code });
  return result;
}
const persist = () => writeFileSync(evidenceFile, JSON.stringify(proof, null, 2) + '\n');
const question = 'Please help me prepare for an appointment using my saved preferences. What should I bring, and how should you format the answer? If you have no saved preferences, say so instead of guessing.';
const prompts = {
  before: question,
  save: 'Fictional demonstration only, not medical care. Call me Mira. My appointment-preparation preference is exactly three short numbered items. The final item should remind me to bring my written questions. Please acknowledge these preferences briefly.',
  after: question,
  correct: 'Fictional demonstration only. I am correcting my earlier appointment-preparation preferences. Please replace the three-item numbered format with one short unnumbered paragraph. The last reminder should now be to arrange transport, not to bring written questions. My name is still Mira. Please acknowledge this update briefly.',
  updated: question,
};

async function capture() {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1.5 });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Restore demo', exact: true }).click();
    await page.getByLabel('X / Twitter username', { exact: true }).fill(login.username);
    await page.getByLabel('Private recovery code', { exact: true }).fill(login.recoveryCode);
    await page.getByRole('button', { name: 'Restore my workspace', exact: true }).click();
    await page.getByLabel('Message Vita', { exact: true }).waitFor();
    if (await page.getByRole('region', { name: 'Save your recovery code' }).count()) throw new Error('Do not capture a recovery code.');
    const answer = page.locator('.chat-message.assistant').last();
    await answer.waitFor();
    if (!(await answer.innerText()).includes(proof.stages[phase].response.slice(0, 25).replaceAll('**', ''))) {
      // Markdown may split text nodes; require the saved trace as a second check.
      if (!(await answer.locator('.memory-trace').innerText()).includes('No previous chat history sent')) throw new Error('Screenshot does not match the intended fresh-chat step.');
    }
    // Reading-view layout only: remove the chat's scroll clipping for a complete
    // evidence capture. Never change response text, traces, receipts or status.
    const readingStyle = await page.addStyleTag({ content: '.conversation { height:auto !important; max-height:none !important; overflow:visible !important; }' });
    await answer.screenshot({ path: `${assetDir}/${phase}-answer.png` });
    await readingStyle.evaluate(element => element.remove());
    if (['save', 'correct'].includes(phase)) {
      await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: 'Patient memory', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Automatic conversation memory', exact: true });
      await panel.locator('.conversation-receipts > summary').click();
      await panel.screenshot({ path: `${assetDir}/${phase}-receipts.png` });
    }
    if (phase === 'after' || phase === 'updated') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${assetDir}/${phase}-mobile.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    proof.stages[phase].screenshot = `assets/${phase}-answer.png`;
    proof.stages[phase].screenshotNote = 'Live app response, captured with chat scroll area expanded for reading; text and status unchanged. Mobile captures use the unmodified viewport.';
    persist();
  } finally { await browser.close(); }
}

try {
  await api('GET', '/session');
  if (!login) {
    const username = 'vita_' + randomBytes(4).toString('hex');
    const created = await api('POST', '/auth/demo', { username, role: 'patient', automaticMemory: false });
    login = { origin, username, recoveryCode: created.recoveryCode, runId: randomBytes(12).toString('hex') };
    writeFileSync(privateFile, JSON.stringify(login, null, 2) + '\n', { mode: 0o600 });
    proof = {
      schema: 'vitarecall.submission-demo.v1', origin, startedAt: new Date().toISOString(),
      appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      model: 'gemini-3.1-flash-lite', network: 'mainnet',
      design: 'One operator-controlled fictional profile; same-day ablation; separate authenticated clients; identical neutral prompt before/after; old chat history excluded. Not a volunteer study or clinical validation.',
      limitations: ['Two preference-bearing exchanges archived; read-back answers deliberately not archived to limit self-reinforcement.', 'Semantic retrieval and model wording are nondeterministic.', 'A source receipt is not proof of exhaustive recall or permanent availability.'],
      stages: {},
    };
    persist();
  } else await api('POST', '/auth/demo/restore', { username: login.username, recoveryCode: login.recoveryCode });
  base = '/patients/' + (await api('GET', '/patients')).patients[0].id;
  const index = allowed.indexOf(phase);
  if (index > 0 && !proof.stages[allowed[index - 1]]?.completedAt) throw new Error('Complete the previous stage first.');
  if (proof.stages[phase]?.completedAt) {
    console.log(JSON.stringify({ phase, reusedCompletedStage: true, note: 'No model call or new write. Screenshot can be regenerated only while this stage is the visible conversation.' }));
    if (!proof.stages[phase].screenshot && !proof.stages[allowed[index + 1]]) await capture();
  } else {
    const write = phase === 'save' || phase === 'correct';
    await api('PATCH', base + '/conversation-memory/consent', { enabled: write });
    const reply = await api('POST', base + '/chat', { message: prompts[phase], requestId: `submission-${login.runId}-${phase}`, freshConversation: true });
    const message = reply.assistantMessage;
    proof.stages[phase] = {
      capturedAt: new Date().toISOString(), prompt: prompts[phase], response: message.text,
      memoryTrace: message.memoryTrace,
      sourceBlobIds: message.sources.map(source => source.blobId),
      automaticSavingDuringExchange: write,
    };
    persist();
    if (message.memoryTrace.historyUsed !== false) throw new Error('Previous history was used: this is not a clean demonstration.');
    if (write) {
      let records = [];
      for (let attempt = 0; attempt < 18; attempt++) {
        const state = (await api('POST', base + '/conversation-memory/sync', {})).conversationMemory;
        records = state.records.filter(record => record.text.includes(prompts[phase]));
        if (records.some(record => ['unknown', 'failed'].includes(record.status))) throw new Error('A submission is uncertain or failed; reconcile the existing job, do not duplicate it.');
        if (records.length && records.every(record => record.status === 'stored' && record.blobId)) break;
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
      if (!records.length || records.some(record => record.status !== 'stored')) throw new Error('Storage still pending. Resume this stage later using the same request ID.');
      proof.stages[phase].receipts = [];
      for (const { blobId, jobId } of records) {
        const url = 'https://aggregator.walrus-mainnet.walrus.space/v1/blobs/' + encodeURIComponent(blobId) + '?strict_consistency_check=true';
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('Encrypted blob download is not yet available.');
        const bytes = Buffer.from(await response.arrayBuffer());
        proof.stages[phase].receipts.push({ status: 'stored', blobId, jobId, walrusScanUrl: 'https://walruscan.com/mainnet/blob/' + encodeURIComponent(blobId), aggregatorStatus: response.status, encryptedBytes: bytes.length, encryptedSha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
    await api('PATCH', base + '/conversation-memory/consent', { enabled: false });
    proof.stages[phase].completedAt = new Date().toISOString();
    persist();
    console.log(JSON.stringify({ phase, historyUsed: message.memoryTrace.historyUsed, sources: message.sources.length, storedBlobs: proof.stages[phase].receipts?.length || 0, evidenceFile }));
    await capture();
  }
} catch (error) {
  console.error(JSON.stringify({ phase, failed: true, name: error.name, code: error.code || 'DEMO_INCOMPLETE', status: error.status || null, message: error.message.startsWith('Demo request') ? error.message : 'Stage incomplete. Inspect local evidence and the fictional workspace. No raw provider response logged.' }));
  process.exitCode = 1;
} finally {
  if (base) await api('PATCH', base + '/conversation-memory/consent', { enabled: false }).catch(() => {});
  if (csrf && cookie) await api('POST', '/auth/logout', {}).catch(() => {});
}
