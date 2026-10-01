import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundRunner } from './background.js';

test('background runner registers a promise without blocking the chat response', async () => {
  let registered, finish, ran = false;
  const runner = createBackgroundRunner({ waitUntil: promise => { registered = promise; } });
  const pending = runner(() => new Promise(resolve => { ran = true; finish = resolve; }));
  assert.equal(registered, pending);
  assert.equal(ran, false, 'work starts asynchronously');
  await Promise.resolve();
  assert.equal(ran, true);
  finish();
  await pending;
});

test('background writes are deferred when either the platform or fallback deadline is too close', () => {
  const clock = () => 1000;
  const fail = () => assert.fail('must leave work safely queued');
  const runner = createBackgroundRunner({ clock, waitUntil: fail, getDeadline: () => new Date(74000) });
  assert.equal(runner(fail, 121000), undefined);
  assert.equal(createBackgroundRunner({ clock, waitUntil: fail })(fail, 74000), undefined);
});

test('background runner executes on a persistent local server without Vercel hooks', async () => {
  let calls = 0;
  await createBackgroundRunner()(() => { calls++; });
  assert.equal(calls, 1);
});

test('background failures do not reject the task or expose private provider errors', async t => {
  const messages = [];
  t.mock.method(console, 'error', message => messages.push(message));
  await createBackgroundRunner()(() => { throw new Error('private fictional conversation and credential'); });
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0], /private fictional|credential/);
});
