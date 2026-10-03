import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramService } from "./telegram.js";

const config = { telegramBotToken: "123456:abcdefghijklmnopqrstuvwxyz_ABCDE", telegramBotUsername: "VitaRecallDemoBot", telegramWebhookSecret: "test-secret-123" };

test("Telegram service keeps secrets server-side, verifies webhook headers, and configures an HTTPS webhook", async () => {
  const calls = [];
  const service = createTelegramService(config, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), { headers: { "Content-Type": "application/json" } });
  });
  assert.equal(service.configured, true);
  assert.equal(service.username, "VitaRecallDemoBot");
  assert.equal(service.linkUrl("safe_token"), "https://t.me/VitaRecallDemoBot?start=safe_token");
  assert.equal(service.verifyWebhook("test-secret-123"), true);
  assert.equal(service.verifyWebhook("wrong"), false);
  await service.setWebhook("https://vitarecall.example");
  assert.equal(calls[0].url.includes(config.telegramBotToken), true, "token is used only for the server API request");
  assert.deepEqual(calls[0].body, { url: "https://vitarecall.example/api/telegram/webhook", secret_token: config.telegramWebhookSecret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
});

test("Telegram service splits long model answers without adding a parse mode", async () => {
  const bodies = [];
  const service = createTelegramService(config, async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ ok: true, result: true }), { headers: { "Content-Type": "application/json" } });
  });
  await service.sendText("42", "x".repeat(8001));
  assert.equal(bodies.length, 3);
  assert.deepEqual(bodies.map(body => body.text.length), [4000, 4000, 1]);
  assert.equal("parse_mode" in bodies[0], false);
});

test("Telegram service can display an inline menu and acknowledge a button click", async () => {
  const bodies = [];
  const service = createTelegramService(config, async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ ok: true, result: true }), { headers: { "Content-Type": "application/json" } });
  });
  const replyMarkup = { inline_keyboard: [[{ text: "Ask Vita", callback_data: "vita:ask" }]] };
  await service.sendText("42", "Choose an option.", { replyMarkup });
  await service.answerCallbackQuery("callback-42", "Ready for your question.");
  assert.deepEqual(bodies[0].reply_markup, replyMarkup);
  assert.deepEqual(bodies[1], { callback_query_id: "callback-42", text: "Ready for your question." });
});

test("Telegram remains unavailable until all server-only settings exist", () => {
  const service = createTelegramService({ telegramBotToken: "token", telegramBotUsername: "OnlyName" });
  assert.equal(service.configured, false);
  assert.equal(service.linkUrl("token"), null);
  assert.equal(service.verifyWebhook("anything"), false);
});
