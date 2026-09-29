import "dotenv/config";
import path from "node:path";

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid port number.");
  const production = env.NODE_ENV === "production";
  const appOrigin = env.APP_ORIGIN || (production ? "" : "http://localhost:5173");
  if (!appOrigin) throw new Error("Set APP_ORIGIN to the public HTTPS origin before starting production.");
  const url = new URL(appOrigin);
  if (production && url.protocol !== "https:") throw new Error("Production APP_ORIGIN must use HTTPS.");
  if (production && env.COOKIE_SECURE === "false") throw new Error("Production cookies must be secure.");
  return {
    port, production, appOrigin: url.origin,
    secureCookies: production || env.COOKIE_SECURE === "true",
    dataDir: path.resolve(env.DATA_DIR || "data"),
    clinicianInviteCode: env.CLINICIAN_INVITE_CODE || "",
    memwalKey: env.MEMWAL_KEY || "",
    memwalAccountId: env.MEMWAL_ACCOUNT_ID || "",
    memwalUrl: env.MEMWAL_URL || "https://relayer.memory.walrus.xyz",
    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.GEMINI_MODEL || "gemini-3.1-flash-lite",
  };
}
