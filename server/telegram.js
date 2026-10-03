import { equal } from "./auth.js";

const API_ROOT = "https://api.telegram.org";
const MAX_MESSAGE = 4000;

function clean(value) { return typeof value === "string" ? value.trim() : ""; }

function chunks(text) {
  const value = String(text || "").trim() || "I’m sorry — I could not prepare a response just now. Please try again in a moment.";
  const output = [];
  for (let start = 0; start < value.length; start += MAX_MESSAGE) output.push(value.slice(start, start + MAX_MESSAGE));
  return output;
}

export function createTelegramService(config, fetchImpl = fetch) {
  const token = clean(config.telegramBotToken);
  const username = clean(config.telegramBotUsername).replace(/^@/, "");
  const webhookSecret = clean(config.telegramWebhookSecret);
  const configured = Boolean(token && username && webhookSecret);
  const call = async (method, payload) => {
    if (!configured) throw Object.assign(new Error("Telegram is not configured."), { code: "TELEGRAM_NOT_CONFIGURED" });
    let response;
    try {
      response = await fetchImpl(`${API_ROOT}/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw Object.assign(new Error("Telegram could not be reached."), { code: "TELEGRAM_UNAVAILABLE" });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw Object.assign(new Error("Telegram did not accept the request."), { code: "TELEGRAM_REJECTED" });
    return data.result;
  };
  return {
    configured, username: username || null,
    linkUrl: (linkToken) => configured ? `https://t.me/${username}?start=${encodeURIComponent(linkToken)}` : null,
    verifyWebhook: (provided) => configured && equal(typeof provided === "string" ? provided : "", webhookSecret),
    async sendText(chatId, text, { replyMarkup } = {}) {
      for (const part of chunks(text)) {
        const payload = { chat_id: String(chatId), text: part };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await call("sendMessage", payload);
      }
    },
    async answerCallbackQuery(callbackQueryId, text) {
      const payload = { callback_query_id: String(callbackQueryId) };
      const message = clean(text);
      if (message) payload.text = message.slice(0, 200);
      return call("answerCallbackQuery", payload);
    },
    async setWebhook(appOrigin) {
      const url = new URL("/api/telegram/webhook", appOrigin).toString();
      return call("setWebhook", { url, secret_token: webhookSecret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
    },
  };
}
