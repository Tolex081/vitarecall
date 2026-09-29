// Explicit, resumable live verification. Only `write` submits a memory; all
// subsequent phases reuse its receipt. Credentials are never printed.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../server/config.js";
import { createMemoryService } from "../server/memory.js";
import { createChatService } from "../server/llm.js";
import { createStore } from "../server/store.js";
import { createApp } from "../server/app.js";

const phase = process.argv[2] || "check";
const config = loadConfig();
const memory = createMemoryService(config);
const evidenceFile = path.join(config.dataDir, "mainnet-proof.json");
const loginFile = path.join(config.dataDir, "mainnet-demo-login.json");
const allowed = ["check", "write", "status", "recall", "download"];
if (!allowed.includes(phase)) throw new Error(`Use one of: ${allowed.join(", ")}`);
let state = existsSync(evidenceFile) ? JSON.parse(readFileSync(evidenceFile, "utf8")) : null;
let server, store;
const save = () => writeFileSync(evidenceFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
const output = (data) => console.log(JSON.stringify(data, null, 2));
const requireReceipt = () => {
  if (!state?.blobId || state.accountId !== memory.accountId) throw new Error("No confirmed receipt for this account. Complete write and status first.");
};

async function appSession() {
  store = createStore(path.join(config.dataDir, "vitarecall.sqlite"));
  const app = createApp({ config, store, memory, chat: createChatService(config) });
  server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie, csrfToken;
  async function request(route, method = "GET", body) {
    const response = await fetch(`${origin}/api${route}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken, Origin: config.appOrigin } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(90000),
    });
    const setCookie = response.headers.getSetCookie()[0];
    if (setCookie) cookie = setCookie.split(";")[0];
    const data = await response.json();
    if (data.csrfToken) csrfToken = data.csrfToken;
    if (!response.ok) throw Object.assign(new Error(data.error || "App request failed."), { status: response.status, code: data.code });
    return data;
  }
  await request("/session");
  let login;
  if (existsSync(loginFile)) login = JSON.parse(readFileSync(loginFile, "utf8"));
  else {
    login = { name: "Walrus Mainnet Demo", email: `walrus-demo-${randomBytes(5).toString("hex")}@vitarecall.example`, password: randomBytes(30).toString("base64url"), role: "patient", note: "Fictional verification patient only. Do not publish this login file." };
    writeFileSync(loginFile, JSON.stringify(login, null, 2) + "\n", { mode: 0o600 });
  }
  if (store.get("SELECT id FROM users WHERE email=?", login.email)) await request("/auth/login", "POST", { email: login.email, password: login.password });
  else await request("/auth/register", "POST", { name: login.name, email: login.email, password: login.password, role: login.role });
  const { patients } = await request("/patients");
  const patient = patients[0];
  if (!patient) throw new Error("Verification patient workspace is missing.");
  if (state.patientId && state.patientId !== patient.id) throw new Error("Verification patient does not match the stored evidence. No write attempted.");
  state.patientId = patient.id;
  state.namespace = `vitarecall:patient:${patient.id}`;
  save();
  return { request, patient };
}

try {
  if (phase === "check") output(await memory.verify());
  else if (phase === "write") {
    await memory.verify();
    mkdirSync(config.dataDir, { recursive: true });
    if (state && state.accountId !== memory.accountId) throw new Error("An earlier proof belongs to a different account. No new write attempted.");
    if (!state) {
      const marker = `vitarecall-mainnet-${randomUUID()}`;
      state = {
        schema: "vitarecall.mainnet-proof.v1", network: "mainnet", relayer: "https://relayer.memory.walrus.xyz", accountId: memory.accountId,
        startedAt: new Date().toISOString(), requestId: randomUUID(), marker,
        text: `FICTIONAL DEMO ONLY. A synthetic patient prefers short, plain-language appointment summaries. This is VitaRecall's Walrus Memory mainnet integration check, not a real medical record. Verification marker: ${marker}.`,
        status: "not_submitted", sdkVersion: "0.1.8",
      };
      save();
    }
    const { request, patient } = await appSession();
    if (!patient.memoryConsent) await request(`/patients/${patient.id}/consent`, "PATCH", { enabled: true });
    // The persisted requestId makes rerunning this command return the same local
    // submission, including an uncertain submission, instead of writing again.
    const result = await request(`/patients/${patient.id}/memories`, "POST", { text: state.text, requestId: state.requestId });
    state = { ...state, memoryId: result.memory.id, jobId: result.memory.jobId, blobId: result.memory.blobId, status: result.memory.status, error: result.memory.error };
    save();
    output({ phase, status: state.status, accountId: state.accountId, jobId: state.jobId, blobId: state.blobId, patientId: state.patientId, evidenceFile, loginFile });
    if (state.status === "unknown" || state.status === "failed") process.exitCode = 1;
  } else if (phase === "status") {
    if (!state?.memoryId || state.accountId !== memory.accountId) throw new Error("No submitted app memory exists for this account.");
    const { request, patient } = await appSession();
    const result = await request(`/patients/${patient.id}/memories/${state.memoryId}/status`);
    state = { ...state, jobId: result.memory.jobId, blobId: result.memory.blobId, status: result.memory.status, error: result.memory.error, receiptCheckedAt: new Date().toISOString() };
    if (state.status === "stored") state.confirmedAt ??= state.receiptCheckedAt;
    save();
    output({ phase, status: state.status, jobId: state.jobId, blobId: state.blobId, error: state.error, evidenceFile });
    if (state.status === "failed" || state.status === "unknown") process.exitCode = 1;
  } else if (phase === "recall") {
    requireReceipt();
    // This phase runs in a NEW Node process/client, without prior chat messages.
    const recalled = await memory.recall(`Which appointment summary preference was saved for verification marker ${state.marker}?`, state.namespace);
    const match = recalled.find(record => {
      if (record.blobId !== state.blobId) return false;
      try { const value = JSON.parse(record.text); return value.patientId === state.patientId && value.text === state.text; }
      catch { return false; }
    });
    state.recall = { checkedAt: new Date().toISOString(), freshProcess: true, matchedBlobId: Boolean(match), matchedExactText: Boolean(match), returnedMatches: recalled.length };
    save();
    output({ phase, blobId: state.blobId, ...state.recall, evidenceFile });
    if (!match) process.exitCode = 1;
  } else if (phase === "download") {
    requireReceipt();
    const url = `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${encodeURIComponent(state.blobId)}?strict_consistency_check=true`;
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Mainnet aggregator returned HTTP ${response.status}. No new write attempted.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("Mainnet aggregator returned empty content.");
    state.publicRead = { url, checkedAt: new Date().toISOString(), httpStatus: response.status, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: response.headers.get("content-type") };
    save();
    output({ phase, blobId: state.blobId, ...state.publicRead, evidenceFile });
  }
} catch (error) {
  // App and memory adapter messages are sanitized. Never log raw fetch causes,
  // request headers, configuration objects, or SDK authentication structures.
  output({ phase, success: false, code: error.code || "VERIFICATION_FAILED", error: error.code?.startsWith("MEMORY_") || !error.cause ? error.message : "Network request failed. No credentials were printed." });
  process.exitCode = 1;
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  store?.close();
}
