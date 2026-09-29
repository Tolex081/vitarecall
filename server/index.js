import path from "node:path";
import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { createApp } from "./app.js";
import { createMemoryService } from "./memory.js";
import { createChatService } from "./llm.js";

const config = loadConfig();
const store = createStore(path.join(config.dataDir, "vitarecall.sqlite"));
const app = createApp({ config, store, memory: createMemoryService(config), chat: createChatService(config) });
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`VitaRecall API listening on port ${config.port}.`);
  console.log(`Gemini: ${config.geminiApiKey ? "configured" : "needs GEMINI_API_KEY"}. Walrus: ${config.memwalKey && config.memwalAccountId ? "configured (mainnet)" : "needs MEMWAL_KEY and MEMWAL_ACCOUNT_ID"}.`);
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
