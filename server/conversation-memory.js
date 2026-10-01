import { randomUUID } from 'node:crypto';

export const conversationNamespace = (patientId, userId) => `vitarecall:chat:${patientId}:${userId}`;
const stamp = () => new Date().toISOString();
const uncertain = 'Submission is unconfirmed. It will not be automatically repeated because Walrus may already have accepted it. Ask the app operator to reconcile this job.';

// Preserve the complete exchange, not an LLM summary. Bound the encoded envelope,
// including escapes, without splitting Unicode code points or dropping characters.
export function conversationChunks({ patientId, userId, requestId, messages }) {
  const fullText = messages.map(m => `${m.role === 'user' ? 'User-reported' : 'Vita AI-generated (not a clinical record)'} [${m.createdAt}]:\n${m.text}`).join('\n\n');
  const characters = Array.from(fullText), chunks = [];
  let offset = 0;
  while (offset < characters.length) {
    let size = Math.min(5000, characters.length - offset);
    const envelope = text => ({ schema: 'vitarecall.conversation.v1', patientId, userId, requestId, part: chunks.length + 1, text, recordedAt: messages[0].createdAt });
    while (JSON.stringify(envelope(characters.slice(offset, offset + size).join(''))).length > 7800) size = Math.floor(size / 2);
    chunks.push(envelope(characters.slice(offset, offset + size).join('')));
    offset += size;
  }
  return chunks.map(chunk => ({ ...chunk, parts: chunks.length }));
}

export function createConversationMemory({ store, memory }) {
  async function initialize(db, patientId, userId, value) {
    // Called only in the NEW profile transaction. Never apply a new default
    // during login, restore, workspace reads, or deployment of existing users.
    await db.run('INSERT INTO conversation_memory_settings (patient_id,user_id,enabled,updated_at) VALUES (?,?,?,?)', patientId, userId, Number(value), stamp());
    await db.audit(userId, patientId, value ? 'conversation_memory.signup_enabled' : 'conversation_memory.signup_opted_out');
  }
  const enabled = async (patientId, userId, db = store) => Boolean((await db.get('SELECT enabled FROM conversation_memory_settings WHERE patient_id=? AND user_id=?', patientId, userId))?.enabled);
  async function state(patientId, userId) {
    const rows = await store.all('SELECT * FROM conversation_memories WHERE patient_id=? AND user_id=? ORDER BY created_at DESC,part ASC LIMIT 200', patientId, userId);
    const totals = await store.all('SELECT status,COUNT(*) AS count FROM conversation_memories WHERE patient_id=? AND user_id=? GROUP BY status', patientId, userId);
    const counts = { queued: 0, processing: 0, stored: 0, unknown: 0, failed: 0, cancelled: 0 };
    for (const row of totals) counts[row.status] = Number(row.count);
    return { enabled: await enabled(patientId, userId), counts, records: rows.map(row => ({ id: row.id, text: JSON.parse(row.payload).text, part: row.part, parts: JSON.parse(row.payload).parts, status: row.status, jobId: row.job_id, blobId: row.blob_id, error: row.error, createdAt: row.created_at })) };
  }
  async function setEnabled(patientId, userId, value) {
    await store.transaction(async tx => {
      await tx.run('INSERT INTO conversation_memory_settings (patient_id,user_id,enabled,updated_at) VALUES (?,?,?,?) ON CONFLICT(patient_id,user_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at', patientId, userId, Number(value), stamp());
      if (!value) await tx.run("UPDATE conversation_memories SET status='cancelled',error=? WHERE patient_id=? AND user_id=? AND status='queued'", 'Cancelled before submission because automatic memory was turned off.', patientId, userId);
      await tx.audit(userId, patientId, value ? 'conversation_memory.enabled' : 'conversation_memory.disabled');
    });
  }
  async function queue(db, input) {
    if (!Number((await db.run('UPDATE conversation_memory_settings SET enabled=enabled WHERE patient_id=? AND user_id=? AND enabled=1', input.patientId, input.userId)).changes)) return;
    for (const chunk of conversationChunks(input)) {
      await db.run("INSERT INTO conversation_memories (id,patient_id,user_id,request_id,part,payload,status,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(patient_id,user_id,request_id,part) DO NOTHING", randomUUID(), input.patientId, input.userId, input.requestId, chunk.part, JSON.stringify(chunk), 'queued', chunk.recordedAt);
    }
  }
  async function sync(patientId, userId) {
    if (!memory.configured) return state(patientId, userId);
    // Separate bounded requests keep model latency independent of storage latency.
    // Durable queued work resumes on the next visit; ambiguous submissions are NEVER
    // retried automatically. The relayer has no application idempotency key.
    const queued = await store.all("SELECT * FROM conversation_memories WHERE patient_id=? AND user_id=? AND status='queued' ORDER BY created_at,part LIMIT 2", patientId, userId);
    await Promise.all(queued.map(async row => {
      const claimed = await store.transaction(async tx => {
        // Lock the setting against simultaneous withdrawal of consent on Postgres.
        const setting = await tx.run('UPDATE conversation_memory_settings SET enabled=enabled WHERE patient_id=? AND user_id=? AND enabled=1', patientId, userId);
        if (!Number(setting.changes)) return false;
        return Number((await tx.run("UPDATE conversation_memories SET status='unknown',error=? WHERE id=? AND status='queued'", uncertain, row.id)).changes) > 0;
      });
      if (!claimed) return;
      try {
        const result = await memory.submit(row.payload, conversationNamespace(patientId, userId));
        if (!result.jobId) return;
        await store.run("UPDATE conversation_memories SET status='processing',job_id=?,error=NULL WHERE id=? AND status='unknown'", result.jobId, row.id);
      } catch { /* An accepted write may have lost its response. Keep it unconfirmed. */ }
    }));
    const pending = await store.all("SELECT * FROM conversation_memories WHERE patient_id=? AND user_id=? AND status='processing' ORDER BY created_at,part LIMIT 8", patientId, userId);
    await Promise.all(pending.map(async row => {
      try {
        const receipt = await memory.receipt(row.job_id);
        if (receipt.status === 'stored' && receipt.blobId) await store.run("UPDATE conversation_memories SET status='stored',blob_id=?,error=NULL WHERE id=? AND status='processing'", receipt.blobId, row.id);
        else if (receipt.status === 'failed') await store.run("UPDATE conversation_memories SET status='failed',error=? WHERE id=? AND status='processing'", 'Walrus could not store this part. This is not a confirmed memory.', row.id);
      } catch { /* A transient receipt error does not invent success or failure. */ }
    }));
    return state(patientId, userId);
  }
  return { initialize, enabled, state, setEnabled, queue, sync };
}
