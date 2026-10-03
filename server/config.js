import "dotenv/config";
import path from "node:path";

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid port number.");
  const vercel = env.VERCEL === "1";
  const production = env.NODE_ENV === "production" || vercel;
  const appOrigin = env.APP_ORIGIN || (production ? "" : "http://localhost:5173");
  if (!appOrigin) throw new Error("Set APP_ORIGIN to the public HTTPS origin before starting production.");
  let url;
  try { url = new URL(appOrigin); } catch { throw new Error("APP_ORIGIN must be a valid HTTP or HTTPS origin."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_ORIGIN must be an HTTP or HTTPS origin with no path, credentials, query, or fragment.");
  }
  if (production && url.protocol !== "https:") throw new Error("Production APP_ORIGIN must use HTTPS.");
  if (production && env.COOKIE_SECURE === "false") throw new Error("Production cookies must be secure.");
  const databaseUrl = (env.DATABASE_URL || "").trim();
  if (vercel && !databaseUrl) throw new Error("Set DATABASE_URL to the Supabase transaction pooler connection string. SQLite cannot run durably on Vercel.");
  if (databaseUrl) {
    let database;
    try { database = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL connection string."); }
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname || !database.username || !database.password || database.hash) {
      throw new Error("DATABASE_URL must be a PostgreSQL connection string with a database username and password.");
    }
  }
  return {
    port, production, vercel, appOrigin: url.origin,
    databaseUrl,
    databaseCaCert: (env.DATABASE_CA_CERT || "").replace(/\\n/g, "\n"),
    secureCookies: production || env.COOKIE_SECURE === "true",
    dataDir: path.resolve(env.DATA_DIR || "data"),
    clinicianInviteCode: env.CLINICIAN_INVITE_CODE || "",
    memwalKey: env.MEMWAL_KEY || "",
    memwalAccountId: env.MEMWAL_ACCOUNT_ID || "",
    memwalUrl: env.MEMWAL_URL || "https://relayer.memory.walrus.xyz",
    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.GEMINI_MODEL || "gemini-3.1-flash-lite",
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || "",
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME || "",
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET || "",
  };
}
