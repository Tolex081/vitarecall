import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore, createPostgresPoolOptions, postgresSql } from './postgres-store.js';
import { createTestPostgresPool } from './testing/postgres.js';

test('SQL bindings leave quoted strings, dollar quotes, identifiers and comments untouched', () => {
  const sql = `SELECT '?' AS "?", 'it''s ?' AS value, $$? FROM users$$, $tag$?$tag$, ?
    FROM users u /* outer ? /* nested ? */ end */ JOIN patients p ON p.user_id=u.id
    WHERE u.email=? -- ? FROM notes
    AND u.id=?`;
  const transformed = postgresSql(sql, 3);
  assert.match(transformed, /\$\$\? FROM users\$\$/);
  assert.match(transformed, /FROM vitarecall.users u/);
  assert.match(transformed, /JOIN vitarecall.patients p/);
  assert.match(transformed, /WHERE u.email=\$2/);
  assert.match(transformed, /AND u.id=\$3/);
  assert.match(transformed, /-- \? FROM notes/);
  assert.equal(postgresSql('UPDATE memories SET text=? WHERE id=?', 2), 'UPDATE vitarecall.memories SET text=$1 WHERE id=$2');
  assert.equal(postgresSql('SELECT * FROM vitarecall.users WHERE id=?', 1), 'SELECT * FROM vitarecall.users WHERE id=$1');
  assert.throws(() => postgresSql('SELECT ?', 0), /placeholder count/);
  assert.throws(() => postgresSql("SELECT 'unfinished"), /Unterminated/);
});

test('Postgres TLS settings cannot be disabled by connection-string parameters', () => {
  const options = createPostgresPoolOptions({ connectionString: 'postgres://user:secret@pool.example.com:6543/postgres?sslmode=disable&sslcert=bad', ca: 'line1\\nline2' });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, 'line1\nline2');
  assert.equal(new URL(options.connectionString).search, '');
  assert.equal(options.max, 1);
  for (const value of [undefined, 'https://user:secret@host/db', 'postgres://host/db']) {
    assert.throws(() => createPostgresPoolOptions({ connectionString: value }), { code: 'DATABASE_CONFIG' });
  }
});

test('runtime reports missing migration without creating schema or exposing credentials', async () => {
  const pool = await createTestPostgresPool({ migrate: false });
  try {
    await assert.rejects(createPostgresStore({ pool }), { code: 'DATABASE_MIGRATION_REQUIRED' });
    const result = await pool.query("SELECT count(*) AS count FROM pg_namespace WHERE nspname='vitarecall'");
    assert.equal(Number(result.rows[0].count), 0);
    await assert.rejects(createPostgresStore({ pool: { query: async () => { throw new Error('postgres://private:secret@host'); } } }), (error) => error.code === 'DATABASE_UNAVAILABLE' && !error.message.includes('secret'));
  } finally { await pool.end(); }
});

test('schema reruns safely and denies all browser API roles, with RLS enabled', async () => {
  const pool = await createTestPostgresPool();
  try {
    await pool.database.exec(pool.migration);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const result = await pool.query("SELECT has_schema_privilege($1,'vitarecall','USAGE') AS allowed", [role]);
      assert.equal(result.rows[0].allowed, false);
    }
    const result = await pool.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vitarecall' AND c.relkind='r' AND NOT c.relrowsecurity");
    assert.deepEqual(result.rows, []);
  } finally { await pool.end(); }
});

test('Postgres store preserves namespaces, rowid ordering, bound values and transaction rollback', async () => {
  const pool = await createTestPostgresPool();
  const store = await createPostgresStore({ pool });
  try {
    await pool.query('CREATE TABLE public.users (id TEXT)');
    const unusualName = "Ada'); DELETE FROM users; -- ?";
    await store.transaction(async (tx) => {
      assert.deepEqual(await tx.run('INSERT INTO users VALUES (?,?,?,?,?,?)', 'u1', unusualName, 'fixture@example.invalid', 'hash', 'patient', '2026-09-30'), { changes: 1 });
      await tx.run('INSERT INTO patients (id,user_id,care_code) VALUES (?,?,?)', 'p1', 'u1', 'code');
      await tx.audit('u1', 'p1', 'fixture.created');
    });
    assert.equal((await store.get('SELECT name FROM users WHERE id=?', 'u1')).name, unusualName);
    assert.equal(await store.get('SELECT name FROM users WHERE id=?', 'missing'), undefined);
    let expiredTransaction;
    await assert.rejects(store.transaction(async (tx) => {
      expiredTransaction = tx;
      await tx.run('INSERT INTO notes VALUES (?,?,?,?,?)', 'n1', 'p1', 'u1', 'must roll back', 'today');
      throw new Error('rollback fixture');
    }), /rollback fixture/);
    assert.equal(await store.get('SELECT id FROM notes WHERE id=?', 'n1'), undefined);
    await assert.rejects(expiredTransaction.get('SELECT id FROM users'), /finished/);
    await store.run('INSERT INTO messages (id,patient_id,user_id,role,text,sources_json,created_at) VALUES (?,?,?,?,?,?,?)', 'm1', 'p1', 'u1', 'user', 'first', '[]', 'today');
    const sequence = (await store.get('SELECT COALESCE(MAX(rowid),0) AS sequence FROM messages WHERE patient_id=? AND user_id=?', 'p1', 'u1')).sequence;
    await store.run('INSERT INTO chat_conversations VALUES (?,?,?,?) ON CONFLICT(patient_id,user_id) DO UPDATE SET cutoff_sequence=excluded.cutoff_sequence', 'p1', 'u1', sequence, 'today');
    await store.run('INSERT INTO messages (id,patient_id,user_id,role,text,sources_json,created_at) VALUES (?,?,?,?,?,?,?)', 'm2', 'p1', 'u1', 'assistant', 'second', '[]', 'today');
    await store.run('INSERT INTO message_memory_traces VALUES (?,?)', 'm2', '{"historyUsed":false}');
    const messages = await store.all('SELECT m.*,t.trace_json FROM (SELECT rowid AS sequence,* FROM messages WHERE patient_id=? AND user_id=? AND rowid>? ORDER BY rowid DESC LIMIT 200) m LEFT JOIN message_memory_traces t ON t.message_id=m.id ORDER BY m.sequence ASC', 'p1', 'u1', sequence);
    assert.deepEqual(messages.map((message) => message.id), ['m2']);
    assert.equal(JSON.parse(messages[0].trace_json).historyUsed, false);
    await store.run('INSERT INTO memories (id,patient_id,user_id,request_id,text,provenance,status,blob_id,namespace,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', 'memory', 'p1', 'u1', 'request', 'fictional memory', 'demo-patient-reported', 'stored', 'fixture-not-a-real-blob', 'vitarecall:patient:p1', 'today');
    assert.equal((await store.get('SELECT namespace FROM memories')).namespace, 'vitarecall:patient:p1');
    assert.equal(Number((await store.get("SELECT COUNT(DISTINCT blob_id) AS count FROM memories WHERE patient_id=? AND status='stored'", 'p1')).count), 1);
  } finally { await store.close(); }
});

test('atomic rate-limit and lease UPSERT syntax works with private Postgres tables', async () => {
  const pool = await createTestPostgresPool();
  const store = await createPostgresStore({ pool });
  try {
    const rate = 'INSERT INTO rate_limits (key,count,until) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.until<=? THEN 1 ELSE rate_limits.count+1 END,until=CASE WHEN rate_limits.until<=? THEN excluded.until ELSE rate_limits.until END RETURNING count,until';
    assert.equal(Number((await store.get(rate, 'login', 1, 100, 0, 0)).count), 1);
    assert.equal(Number((await store.get(rate, 'login', 1, 150, 50, 50)).count), 2);
    const reset = await store.get(rate, 'login', 1, 250, 150, 150);
    assert.equal(Number(reset.count), 1);
    assert.equal(Number(reset.until), 250);
    const lock = 'INSERT INTO operation_locks (key,token,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE operation_locks.expires_at<=? RETURNING token';
    assert.equal((await store.get(lock, 'chat', 'first', 100, 0)).token, 'first');
    assert.equal(await store.get(lock, 'chat', 'second', 150, 50), undefined);
    assert.equal((await store.get(lock, 'chat', 'second', 250, 150)).token, 'second');
    assert.deepEqual(await store.run('DELETE FROM operation_locks WHERE key=? AND token=?', 'chat', 'first'), { changes: 0 });
    assert.equal((await store.get('SELECT token FROM operation_locks WHERE key=?', 'chat')).token, 'second');
  } finally { await store.close(); }
});
