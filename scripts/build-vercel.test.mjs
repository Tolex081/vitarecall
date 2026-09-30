import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertNoClientSecrets } from "./build-vercel.mjs";

const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("Vercel routes all API paths to one Node function before filesystem and SPA fallback", () => {
  const route = config.routes[1];
  for (const path of ["/api", "/api/health", "/api/patients/patient-id/memories/memory-id"]) {
    assert.equal(new RegExp(route.src).test(path), true);
  }
  for (const path of ["/api-not-a-route", "/assets/app.js", "/patients"]) assert.equal(new RegExp(route.src).test(path), false);
  assert.equal(route.dest, "/api/index.js");
  assert.equal(route.status, undefined);
  assert.equal(route.headers["Cache-Control"], "no-store");
  assert.deepEqual(config.routes[2], { handle: "filesystem" });
  assert.deepEqual(config.routes[3], { src: "/(.*)", dest: "/index.html", methods: ["GET", "HEAD"] });
});

test("Vercel builds static assets and an API function without a separate backend origin", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(config.framework, "vite");
  assert.equal(config.outputDirectory, "dist");
  assert.equal(config.buildCommand, "npm run build:vercel");
  assert.equal(pkg.scripts.build, "vite build");
  assert.equal(pkg.scripts.start, "node server/index.js");
  assert.equal(config.functions["api/index.js"].maxDuration, 120);
  assert.equal(config.env.NODEJS_HELPERS, "0", "Express must own JSON parsing and its body-size limit");
  const entry = await readFile(new URL("../api/index.js", import.meta.url), "utf8");
  assert.match(entry, /createFunctionHandler/);
  assert.doesNotMatch(entry, /\.listen\(/);
  const build = await readFile(new URL("./build-vercel.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(build, /VITA_API_ORIGIN|createRuntime\(|db:migrate/);
});

test("provider and database secrets cannot be exposed through Vite prefixes", () => {
  assert.doesNotThrow(() => assertNoClientSecrets({ DATABASE_URL: "private", GEMINI_API_KEY: "private", MEMWAL_KEY: "private" }));
  for (const name of ["DATABASE_URL", "DATABASE_CA_CERT", "GEMINI_API_KEY", "MEMWAL_KEY", "CLINICIAN_INVITE_CODE", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) {
    assert.throws(() => assertNoClientSecrets({ [`VITE_${name}`]: "private-secret-value" }), error => error.message.includes(`VITE_${name}`) && !error.message.includes("private-secret-value"));
  }
});

test("deployment headers and function exclusions protect private data", () => {
  const headers = config.routes[0].headers;
  assert.match(headers["Content-Security-Policy"], /connect-src 'self'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  const excluded = config.functions["api/index.js"].excludeFiles;
  assert.match(excluded, /data\/\*\*/);
  assert.match(excluded, /\.env/);
});
