import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function createStore(filename) {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('patient','clinician')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS demo_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id), username TEXT NOT NULL,
      recovery_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
      care_code TEXT UNIQUE NOT NULL, memory_consent INTEGER NOT NULL DEFAULT 0,
      consent_updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS care_team (
      patient_id TEXT NOT NULL REFERENCES patients(id), clinician_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, PRIMARY KEY(patient_id, clinician_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL, text TEXT NOT NULL, sources_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_scope ON messages(patient_id, user_id, created_at);
    CREATE TABLE IF NOT EXISTS chat_conversations (
      patient_id TEXT NOT NULL REFERENCES patients(id), user_id TEXT NOT NULL REFERENCES users(id),
      cutoff_sequence INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY(patient_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS message_memory_traces (
      message_id TEXT PRIMARY KEY REFERENCES messages(id), trace_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_requests (
      patient_id TEXT NOT NULL, user_id TEXT NOT NULL, request_id TEXT NOT NULL,
      state TEXT NOT NULL, response_json TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(patient_id,user_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), user_id TEXT NOT NULL REFERENCES users(id),
      request_id TEXT NOT NULL, text TEXT NOT NULL, provenance TEXT NOT NULL,
      status TEXT NOT NULL, job_id TEXT, blob_id TEXT, owner TEXT, namespace TEXT NOT NULL,
      error TEXT, created_at TEXT NOT NULL,
      UNIQUE(patient_id,user_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), user_id TEXT NOT NULL REFERENCES users(id),
      text TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, patient_id TEXT,
      action TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operation_locks (
      key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
  // Queue the entire async transaction, not only individual statements.
  // Concurrent requests must never accidentally join another request's transaction.
  let tail = Promise.resolve();
  let closed = false;
  const enqueue = (fn) => {
    const result = tail.then(() => {
      if (closed) throw new Error("The database is closed.");
      return fn();
    });
    tail = result.catch(() => {});
    return result;
  };
  function methods(dispatch) {
    const api = {
      get: (sql, ...args) => dispatch(() => db.prepare(sql).get(...args)),
      all: (sql, ...args) => dispatch(() => db.prepare(sql).all(...args)),
      run: (sql, ...args) => dispatch(() => ({ changes: Number(db.prepare(sql).run(...args).changes) })),
      audit: (userId, patientId, action) => api.run(
        "INSERT INTO audit_events (user_id,patient_id,action,created_at) VALUES (?,?,?,?)",
        userId || null, patientId || null, action, new Date().toISOString(),
      ),
    };
    return api;
  }
  return {
    dialect: "sqlite",
    ...methods(enqueue),
    transaction: (fn) => enqueue(async () => {
      db.exec("BEGIN IMMEDIATE");
      let active = true;
      const tx = methods(async (operation) => {
        if (!active) throw new Error("The transaction has finished.");
        return operation();
      });
      try {
        const result = await fn(tx);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        active = false;
      }
    }),
    close: () => enqueue(() => { closed = true; db.close(); }),
  };
}
