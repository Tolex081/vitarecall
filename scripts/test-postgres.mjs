import { spawn } from "node:child_process";

// Exercise actual local PostgreSQL semantics without Supabase credentials.
const child = spawn(process.execPath, ["--test", "server/app.test.js", "server/demo-auth.test.js", "server/coordination.test.js"], {
  stdio: "inherit", env: { ...process.env, STORE_TEST_ENGINE: "pglite" },
});
child.on("error", () => { console.error("Could not start the local PostgreSQL tests."); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
