import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationChunks } from './conversation-memory.js';

test('complete long exchanges survive chunking, including Unicode, quotes and control characters', () => {
  const messages = [
    { role: 'user', text: 'Fictional '.repeat(500) + '\u{1f9a3}', createdAt: '2026-10-01' },
    { role: 'assistant', text: ('\u0001"\\\n\u{1f9a3}').repeat(2200), createdAt: '2026-10-01' },
  ];
  const chunks = conversationChunks({ patientId: 'p'.repeat(36), userId: 'u'.repeat(36), requestId: 'r'.repeat(80), messages });
  assert.ok(chunks.length > 2);
  chunks.forEach((chunk, index) => {
    assert.ok(JSON.stringify(chunk).length <= 8000);
    assert.equal(chunk.part, index + 1);
    assert.equal(chunk.parts, chunks.length);
    assert.equal(chunk.schema, 'vitarecall.conversation.v1');
    assert.equal(chunk.text.isWellFormed(), true);
  });
  assert.equal(chunks.map(c => c.text).join(''), `User-reported [2026-10-01]:\n${messages[0].text}\n\nVita AI-generated (not a clinical record) [2026-10-01]:\n${messages[1].text}`);
});
