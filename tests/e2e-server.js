// An isolated real HTTP/SQLite app, deliberately WITHOUT live external credentials.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { createTestStore } from "../server/test-store.js";
import { createMemoryService } from "../server/memory.js";
import { createChatService } from "../server/llm.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "vitarecall-e2e-"));
const store = await createTestStore(path.join(dir, "test.sqlite"));
const config = { production: false, secureCookies: false, appOrigin: "http://127.0.0.1:3187", clinicianInviteCode: "e2e-clinic-invite-only" };
const server = createApp({ config, store, memory: createMemoryService({}), chat: createChatService({}) }).listen(3187, "127.0.0.1");

// Separate test-only provider fixture: exercises the full browser save/recall flow
// without submitting medical text or creating any real blockchain transactions.
const fixtureStore = await createTestStore(path.join(dir, "provider-fixture.sqlite"));
const records = new Map();
const fixtureMemory = {
  configured: true, accountId: `0x${"a".repeat(64)}`, network: "mainnet",
  async submit(text, namespace) {
    const jobId = `fixture-job-${records.size + 1}`;
    records.set(jobId, { text, namespace, blobId: `fixture-blob-${records.size + 1}`, polls: 0 });
    return { jobId, status: "processing" };
  },
  async receipt(jobId) {
    const record = records.get(jobId);
    if (!record) return { status: "failed", error: "Missing test fixture." };
    return ++record.polls < 2 ? { status: "processing" } : { status: "stored", blobId: record.blobId, owner: "fixture-owner" };
  },
  async recall(_query, namespace) { return [...records.values()].filter(record => record.namespace === namespace).map(record => ({ blobId: record.blobId, text: record.text, createdAt: new Date().toISOString(), distance: 0.1 })); },
  async verify() { return { connected: true, network: "mainnet", accountId: this.accountId }; },
};
const fixtureChat = { configured: true, model: "test-only-provider-fixture", async respond({ memories }) { return memories.length ? `Test-provider reply using stored context: ${memories[0].text} [1]` : "Test-provider reply: no remembered context yet."; } };
const fixtureServer = createApp({ config: { ...config, appOrigin: "http://127.0.0.1:3188" }, store: fixtureStore, memory: fixtureMemory, chat: fixtureChat }).listen(3188, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  server.closeAllConnections(); fixtureServer.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => fixtureServer.close(resolve))]);
  await Promise.all([store.close(), fixtureStore.close()]);
  process.exit(0);
});
