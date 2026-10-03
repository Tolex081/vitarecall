import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_LOGIN_AGE_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const fields = new Set(["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"]);

function invalid() {
  throw Object.assign(new Error("Telegram sign-in could not be verified. Please try again."), { status: 401, code: "TELEGRAM_LOGIN_INVALID" });
}

function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max) invalid();
  const output = value.trim();
  if (required && !output) invalid();
  return output;
}

function numericString(value) {
  const output = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^[1-9]\d{0,15}$/.test(output)) invalid();
  return output;
}

export function verifyTelegramLogin(payload, botToken, currentTime = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof botToken !== "string" || !botToken.trim()) invalid();
  const keys = Object.keys(payload);
  if (keys.some(key => !fields.has(key))) invalid();
  const telegramId = numericString(payload.id);
  const authDate = numericString(payload.auth_date);
  const firstName = text(payload.first_name, 80, true);
  const lastName = payload.last_name === undefined ? "" : text(payload.last_name, 80);
  const username = payload.username === undefined ? null : text(payload.username, 32).toLowerCase();
  if (username !== null && username && !/^[a-z0-9_]{1,32}$/.test(username)) invalid();
  if (payload.photo_url !== undefined && typeof payload.photo_url !== "string") invalid();
  if (typeof payload.photo_url === "string" && payload.photo_url.length > 2000) invalid();
  if (typeof payload.hash !== "string" || !/^[a-f0-9]{64}$/i.test(payload.hash)) invalid();
  const authenticatedAt = Number(authDate) * 1000;
  if (!Number.isSafeInteger(authenticatedAt) || authenticatedAt > currentTime + MAX_FUTURE_SKEW_MS || currentTime - authenticatedAt > MAX_LOGIN_AGE_MS) invalid();
  const dataCheck = keys.filter(key => key !== "hash").sort().map(key => `${key}=${payload[key]}`).join("\n");
  const secret = createHash("sha256").update(botToken, "utf8").digest();
  const expected = createHmac("sha256", secret).update(dataCheck, "utf8").digest();
  const received = Buffer.from(payload.hash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) invalid();
  return { telegramId, name: [firstName, lastName].filter(Boolean).join(" ").slice(0, 161), username: username || null };
}
