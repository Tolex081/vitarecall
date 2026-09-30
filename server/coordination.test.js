import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './test-store.js';
import { createCoordination } from './coordination.js';

async function fixture(t) {
  const store = await createTestStore(':memory:');
  t.after(() => store.close());
  let time = 1_800_000_000_000;
  const options = { clock: () => time };
  return { store, first: createCoordination(store, options), second: createCoordination(store, options), advance: ms => { time += ms; } };
}

test('rate-limit counters are atomic and shared across coordinator instances', async t => {
  const { store, first, second, advance } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).consume('same-user:chat', 6, 60_000)));
  assert.equal(results.filter(result => result.allowed).length, 6);
  assert.ok(results.every(result => result.retryAfter === 60));
  assert.equal(Number((await store.get('SELECT count FROM rate_limits WHERE key=?', 'same-user:chat')).count), 20);
  assert.equal((await first.consume('different-user:chat', 6, 60_000)).allowed, true);
  advance(59_001);
  assert.deepEqual(await second.consume('same-user:chat', 6, 60_000), { allowed: false, retryAfter: 1 });
  advance(999);
  assert.deepEqual(await first.consume('same-user:chat', 6, 60_000), { allowed: true, retryAfter: 60 });
});

test('only one coordinator can acquire a shared operation lease', async t => {
  const { first, second } = await fixture(t);
  const leases = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).acquire('patient:conversation', 1000)));
  const winners = leases.filter(Boolean);
  assert.equal(winners.length, 1);
  await second.assert(winners[0]);
  assert.ok(await first.acquire('another-patient:conversation', 1000));
  await second.release(winners[0]);
  const next = await first.acquire('patient:conversation', 1000);
  assert.ok(next);
  assert.notEqual(next.token, winners[0].token);
});

test('an expired lease cannot release or commit over its replacement', async t => {
  const { store, first, second, advance } = await fixture(t);
  const stale = await first.acquire('patient:conversation', 1000);
  advance(1000);
  await assert.rejects(first.assert(stale), error => error.status === 409 && error.code === 'OPERATION_EXPIRED');
  const replacement = await second.acquire('patient:conversation', 1000);
  assert.ok(replacement);
  assert.notEqual(stale.token, replacement.token);
  await first.release(stale);
  assert.equal((await store.get('SELECT token FROM operation_locks WHERE key=?', stale.key)).token, replacement.token);
  await assert.rejects(store.transaction(async tx => {
    await tx.run('INSERT INTO rate_limits (key,count,until) VALUES (?,?,?)', 'uncommitted-result', 1, 0);
    await first.assert(stale, tx);
  }), error => error.code === 'OPERATION_EXPIRED');
  assert.equal(await store.get('SELECT count FROM rate_limits WHERE key=?', 'uncommitted-result'), undefined);
  await store.transaction(async tx => {
    await second.assert(replacement, tx);
    await tx.run('INSERT INTO rate_limits (key,count,until) VALUES (?,?,?)', 'committed-result', 1, 0);
  });
  assert.equal(Number((await store.get('SELECT count FROM rate_limits WHERE key=?', 'committed-result')).count), 1);
  await second.release(replacement);
  assert.equal(await store.get('SELECT token FROM operation_locks WHERE key=?', stale.key), undefined);
});

test('coordination cleanup retains live state and the expiry grace window', async t => {
  const { store, first, advance } = await fixture(t);
  await first.consume('old-limit', 2, 1000);
  await first.acquire('old-lock', 1000);
  advance(3_601_001);
  await first.consume('live-limit', 2, 60_000);
  await first.acquire('live-lock', 60_000);
  await first.consume('grace-limit', 2, 1);
  await first.acquire('grace-lock', 1);
  advance(2);
  await first.cleanup();
  assert.deepEqual((await store.all('SELECT key FROM rate_limits ORDER BY key')).map(row => row.key), ['grace-limit', 'live-limit']);
  assert.deepEqual((await store.all('SELECT key FROM operation_locks ORDER BY key')).map(row => row.key), ['grace-lock', 'live-lock']);
});
