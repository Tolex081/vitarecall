import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const serverSecrets = ["DATABASE_URL", "DATABASE_CA_CERT", "GEMINI_API_KEY", "MEMWAL_KEY", "CLINICIAN_INVITE_CODE", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"];

export function assertNoClientSecrets(env) {
  for (const name of serverSecrets) {
    if (env[`VITE_${name}`]) throw new Error(`Remove VITE_${name}. Credentials belong only in server environment variables, never browser-exposed VITE_ variables.`);
  }
}

export async function buildVercel(env = process.env) {
  const { build, loadEnv } = await import("vite");
  // Include .env.production/.env.local in the check, not just shell variables.
  assertNoClientSecrets({ ...loadEnv("production", projectRoot, ""), ...env });
  // Vercel compiles api/index.js as a Node function. Only frontend assets belong
  // in dist; no manual Build Output API bundle and no external backend proxy.
  await build({ root: projectRoot, build: { outDir: "dist", emptyOutDir: true } });
  console.log("Vercel frontend built. The /api function uses server-side DATABASE_URL; run database migrations separately before serving traffic.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildVercel().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
