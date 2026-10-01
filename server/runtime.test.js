import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRuntime, createRuntimeLoader, createFunctionHandler } from "./runtime.js";

function dependencies(store) {
  return { createApp: ({ store: actual }) => { assert.equal(actual, store); return () => {}; }, createMemoryService: () => ({}), createChatService: () => ({}) };
}

test("PostgreSQL runtime reuses the actual pool and never initializes SQLite", async () => {
  const store = { pool: {}, close: async () => {} };
  let attached = 0;
  const work = [];
  let background;
  const runtime = await createRuntime({ vercel: true, databaseUrl: "private-connection", databaseCaCert: "certificate" }, {
    ...dependencies(store),
    createPostgresStore: async options => { assert.deepEqual(options, { connectionString: "private-connection", ca: "certificate" }); return store; },
    createStore: () => assert.fail("SQLite must not initialize on Vercel"),
    attachDatabasePool: pool => { assert.equal(pool, store.pool); attached++; },
    createApp: ({ runInBackground }) => { background = runInBackground; return () => {}; },
    waitUntil: promise => work.push(promise),
    getDeadline: () => new Date(Date.now() + 120000),
  });
  assert.equal(runtime.store, store);
  assert.equal(attached, 1);
  let ran = false;
  background(() => { ran = true; });
  assert.equal(work.length, 1);
  await work[0];
  assert.equal(ran, true);
});

test("local runtime retains SQLite while Vercel refuses an absent DATABASE_URL", async () => {
  const store = { close: async () => {} };
  let selected;
  await createRuntime({ vercel: false, databaseUrl: "", dataDir: "local-data" }, { ...dependencies(store), createStore: file => { selected = file; return store; } });
  assert.match(selected, /local-data[\\/]vitarecall\.sqlite$/);
  await assert.rejects(createRuntime({ vercel: true, databaseUrl: "" }, { createStore: () => assert.fail("must refuse before opening SQLite") }), /DATABASE_URL/);
});

test("runtime initialization shares concurrent work and can retry a failed initialization", async () => {
  let calls = 0;
  const result = {};
  const load = createRuntimeLoader(async () => { calls++; if (calls === 1) throw new Error("unavailable"); return result; });
  const first = load();
  assert.equal(load(), first);
  await assert.rejects(first, /unavailable/);
  const values = await Promise.all([load(), load()]);
  assert.deepEqual(values, [result, result]);
  assert.equal(calls, 2);
});

test("runtime closes a pool if app initialization fails", async () => {
  let closed = false;
  const store = { close: async () => { closed = true; } };
  await assert.rejects(createRuntime({ databaseUrl: "private" }, {
    ...dependencies(store), createPostgresStore: async () => store, createApp: () => { throw new Error("app failed"); },
  }), /app failed/);
  assert.equal(closed, true);
});

test("function preserves original API URL and waits for the Express response", async () => {
  const response = new EventEmitter();
  const request = { url: "/api/patients/example?view=memory" };
  let completed = false;
  const handler = createFunctionHandler(async () => ({ app(req, res) {
    assert.equal(req.url, "/api/patients/example?view=memory");
    setImmediate(() => { completed = true; res.emit("finish"); });
  } }));
  await handler(request, response);
  assert.equal(completed, true);
  assert.equal(response.listenerCount("close"), 0);
});

test("function initialization failures return no-store sanitized JSON", async t => {
  const logged = [];
  t.mock.method(console, "error", message => logged.push(message));
  const headers = {};
  let body;
  const response = { setHeader: (name, value) => { headers[name] = value; }, end: value => { body = value; } };
  await createFunctionHandler(async () => { throw new Error("postgres://user:private-secret@database/private"); })({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(body).code, "SERVICE_UNAVAILABLE");
  assert.doesNotMatch(body + logged.join(""), /private-secret|postgres:\/\//);
});
