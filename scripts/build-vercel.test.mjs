import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateApiOrigin, createDeploymentConfig, buildVercel } from "./build-vercel.mjs";

test("backend requires a public HTTPS origin and does not expose rejected values", () => {
  const rejected = [undefined, "", "http://api.vitarecall.app", "https://localhost", "https://127.0.0.1", "https://10.0.0.1",
    "https://[::1]", "https://api.internal", "https://api.example.com", "https://api.example", "https://api.vitarecall.app/api",
    "https://user:private-secret@api.vitarecall.app", "https://api.vitarecall.app?token=private-secret", "https://api.vitarecall.app#section"];
  for (const value of rejected) {
    assert.throws(() => validateApiOrigin(value), error => error.message.includes("VITA_API_ORIGIN") && !error.message.includes("private-secret"));
  }
  assert.equal(validateApiOrigin(" https://API.vitarecall.app/ "), "https://api.vitarecall.app");
});

test("API routing preserves its prefix and precedes static files and SPA fallback", () => {
  const config = createDeploymentConfig("https://api.vitarecall.app");
  assert.equal(config.version, 3);
  const proxy = config.routes[1];
  assert.equal("/api/chat".replace(new RegExp(proxy.src), proxy.dest), "https://api.vitarecall.app/api/chat");
  assert.equal("/api".replace(new RegExp(proxy.src), proxy.dest), "https://api.vitarecall.app/api");
  assert.equal(new RegExp(proxy.src).test("/api-not-a-route"), false);
  assert.equal(proxy.headers["Cache-Control"], "no-store");
  assert.equal(proxy.status, undefined, "API routing is a rewrite, not a redirect");
  assert.deepEqual(config.routes[2], { handle: "filesystem" });
  assert.equal(config.routes[3].dest, "/index.html");
  assert.match(config.routes[0].headers["Content-Security-Policy"], /connect-src 'self'/);
});

test("Vercel build fails before output when origin is missing or browser secrets are configured", async () => {
  await assert.rejects(buildVercel({}), /VITA_API_ORIGIN/);
  await assert.rejects(buildVercel({ VITA_API_ORIGIN: "https://api.vitarecall.app", VITE_GEMINI_API_KEY: "not-a-key" }), /Remove VITE_GEMINI_API_KEY/);
});

test("Vercel uses dedicated build without changing local build or backend start", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, "npm run build:vercel");
  assert.equal(pkg.scripts.build, "vite build");
  assert.equal(pkg.scripts.start, "node server/index.js");
});
