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
  assert.equal(config.databaseUrl, "");
  assert.equal(config.vercel, false);
});

test("Vercel requires a durable database and production security even without NODE_ENV", () => {
  assert.throws(() => loadConfig({ VERCEL: "1", APP_ORIGIN: "https://vita.example" }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ VERCEL: "1", APP_ORIGIN: "http://localhost:5173" }), /HTTPS/);
  const config = loadConfig({ VERCEL: "1", APP_ORIGIN: "https://vita.example", DATABASE_URL: "postgresql://postgres.project:private@db.example:6543/postgres" });
  assert.equal(config.production, true);
  assert.equal(config.vercel, true);
  assert.equal(config.secureCookies, true);
});

test("invalid origins and database URLs never echo supplied credentials", () => {
  for (const value of ["not an origin", "ftp://example.com", "https://user:private-secret@example.com", "https://example.com/path", "https://example.com?token=private-secret"]) {
    assert.throws(() => loadConfig({ APP_ORIGIN: value }), error => error.message.includes("APP_ORIGIN") && !error.message.includes("private-secret"));
  }
  for (const value of ["private-secret", "https://user:private-secret@example.com", "postgres://db.example/postgres"]) {
    assert.throws(() => loadConfig({ DATABASE_URL: value }), error => error.message.includes("DATABASE_URL") && !error.message.includes("private-secret"));
  }
});

test("optional database CA supports escaped newlines without changing local storage defaults", () => {
  const config = loadConfig({ DATABASE_CA_CERT: "line-one\\nline-two" });
  assert.equal(config.databaseCaCert, "line-one\nline-two");
  assert.equal(config.databaseUrl, "");
});
