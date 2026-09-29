import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarHandler } from './avatars.js';

function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, end() { return this; }, set(headers) { this.headers = headers; }, send(bytes) { this.bytes = bytes; return this; } };
}
const request = (username = 'vita_demo') => ({ params: { username }, user: { username: 'vita_demo' } });

test('avatar proxy only accepts the signed-in profile handle', async () => {
  const handler = createAvatarHandler(() => { throw new Error('Should not fetch'); });
  for (const username of ['someone_else', '../private', 'bad<script>', '']) {
    const res = response();
    await handler(request(username), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.bytes, undefined);
  }
});

test('Unavatar lookup uses a fixed URL, rejects redirects, and caches image responses', async () => {
  let calls = 0;
  const handler = createAvatarHandler(async (url, options) => {
    calls++;
    assert.equal(url, 'https://unavatar.io/x/vita_demo?fallback=false');
    assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.headers['X-Avatar-Source'], 'unavatar');
  assert.deepEqual([...res.bytes], [1, 2, 3]);
  await handler(request(), response());
  assert.equal(calls, 1);
});

test('failed, non-image, and oversized responses return a local generated avatar', async () => {
  const variants = [
    async () => { throw new Error('Network failure'); },
    async () => new Response('<script>unsafe()</script>', { headers: { 'content-type': 'text/html' } }),
    async () => new Response(new Uint8Array(512 * 1024 + 1), { headers: { 'content-type': 'image/png' } }),
  ];
  for (const fetchImage of variants) {
    const res = response();
    await createAvatarHandler(fetchImage)(request(), res);
    assert.equal(res.headers['X-Avatar-Source'], 'generated-fallback');
    assert.equal(res.headers['Content-Type'], 'image/svg+xml');
    assert.match(res.bytes.toString(), /<svg/);
    assert.doesNotMatch(res.bytes.toString(), /script|Network failure/);
  }
});
