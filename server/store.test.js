import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';

test('SQLite serializes entire async transactions and leaves unrelated operations outside rollback', async () => {
  const store = createStore(':memory:');
  try {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    let txReference;
    const transaction = store.transaction(async (tx) => {
      txReference = tx;
      await tx.run('INSERT INTO rate_limits VALUES (?,?,?)', 'rollback', 1, 100);
      started();
      await gate;
      throw new Error('intentional rollback');
    });
    const rejection = assert.rejects(transaction, /intentional rollback/);
    await ready;
    let outsideFinished = false;
    const outside = store.run('INSERT INTO rate_limits VALUES (?,?,?)', 'outside', 1, 100).then(() => { outsideFinished = true; });
    await Promise.resolve();
    assert.equal(outsideFinished, false);
    release();
    await rejection;
    await outside;
    assert.equal(await store.get('SELECT key FROM rate_limits WHERE key=?', 'rollback'), undefined);
    assert.equal((await store.get('SELECT key FROM rate_limits WHERE key=?', 'outside')).key, 'outside');
    await assert.rejects(txReference.get('SELECT key FROM rate_limits'), /finished/);
    await store.transaction(async (tx) => {
      await tx.run('INSERT INTO operation_locks VALUES (?,?,?)', 'chat', 'token', 123);
      await tx.audit(null, null, 'fixture.complete');
    });
    assert.equal((await store.get('SELECT action FROM audit_events')).action, 'fixture.complete');
  } finally { await store.close(); }
});
