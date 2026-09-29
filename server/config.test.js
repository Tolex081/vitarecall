import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("production requires an explicit HTTPS origin and secure cookies", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /APP_ORIGIN/);
  assert.throws(() => loadConfig({ NODE_ENV: "production", APP_ORIGIN: "http://example.com" }), /HTTPS/);
  assert.throws(() => loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://example.com", COOKIE_SECURE: "false" }), /secure/);
  const config = loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://example.com" });
  assert.equal(config.secureCookies, true);
  assert.equal(config.appOrigin, "https://example.com");
});

test("local configuration uses mainnet without inventing credentials", () => {
  const config = loadConfig({});
  assert.equal(config.memwalUrl, "https://relayer.memory.walrus.xyz");
  assert.equal(config.memwalKey, "");
  assert.equal(config.memwalAccountId, "");
  assert.equal(config.geminiApiKey, "");
  assert.equal(config.clinicianInviteCode, "");
  assert.equal(config.secureCookies, false);
});
