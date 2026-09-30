import { createRuntime } from "./runtime.js";

let runtime;
try {
  runtime = await createRuntime();
} catch {
  console.error("VitaRecall could not start. Check server environment settings, database availability, and whether npm run db:migrate has completed for PostgreSQL.");
  process.exit(1);
}
const { config, store, app } = runtime;
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`VitaRecall API listening on port ${config.port}.`);
  console.log(`Gemini: ${config.geminiApiKey ? "configured" : "needs GEMINI_API_KEY"}. Walrus: ${config.memwalKey && config.memwalAccountId ? "configured (mainnet)" : "needs MEMWAL_KEY and MEMWAL_ACCOUNT_ID"}.`);
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(async () => { await store.close(); process.exit(0); }));
