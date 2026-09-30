import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "./store.js";
import { createPostgresStore } from "./postgres-store.js";
import { importSqlite } from "./sqlite-import.js";
import { createTestPostgresPool } from "./testing/postgres.js";

test("explicit import preserves identities and memory mappings, refuses overwrites, and never copies sessions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vitarecall-import-"));
  const filename = path.join(dir, "fixture.sqlite");
  const source = createStore(filename);
  let destination;
  try {
    await source.transaction(async tx => {
      await tx.run("INSERT INTO users VALUES (?,?,?,?,?,?)", "user-fixture", "Fictional Ada", "fixture@example.invalid", "fixture-password-hash", "patient", "2026-09-30");
      await tx.run("INSERT INTO demo_profiles VALUES (?,?,?,?)", "user-fixture", "fictional_ada", "fixture-recovery-hash", "2026-09-30");
      await tx.run("INSERT INTO patients (id,user_id,care_code,memory_consent) VALUES (?,?,?,?)", "patient-fixture", "user-fixture", "fixture-care-code", 1);
      await tx.run("INSERT INTO sessions VALUES (?,?,?,?)", "fixture-session-hash", "user-fixture", "fixture-csrf", 9000000000000);
      await tx.run("INSERT INTO messages (rowid,id,patient_id,user_id,role,text,sources_json,created_at) VALUES (?,?,?,?,?,?,?,?)", 17, "message-fixture", "patient-fixture", "user-fixture", "user", "Fictional preference.", "[]", "2026-09-30");
      await tx.run("INSERT INTO chat_conversations VALUES (?,?,?,?)", "patient-fixture", "user-fixture", 17, "2026-09-30");
      await tx.run("INSERT INTO memories (id,patient_id,user_id,request_id,text,provenance,status,blob_id,namespace,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", "memory-fixture", "patient-fixture", "user-fixture", "request-fixture", "Fictional preference", "demo-patient-reported", "stored", "test-only-not-a-mainnet-blob", "vitarecall:patient:patient-fixture", "2026-09-30");
      await tx.audit("user-fixture", "patient-fixture", "fixture.created");
    });
    // Source remains open in WAL mode: importer must read a consistent snapshot.
    destination = await createPostgresStore({ pool: await createTestPostgresPool() });
    await assert.rejects(importSqlite({ filename, destination }), /confirmation/);
    assert.equal(Number((await destination.get("SELECT COUNT(*) AS count FROM users")).count), 0);
    const counts = await importSqlite({ filename, destination, confirmEmptyDestination: true });
    assert.equal(counts.users, 1);
    assert.equal((await destination.get("SELECT recovery_hash FROM demo_profiles")).recovery_hash, "fixture-recovery-hash");
    assert.equal((await destination.get("SELECT id FROM patients")).id, "patient-fixture");
    assert.equal((await destination.get("SELECT namespace FROM memories")).namespace, "vitarecall:patient:patient-fixture");
    assert.equal((await destination.get("SELECT blob_id FROM memories")).blob_id, "test-only-not-a-mainnet-blob");
    assert.equal(Number((await destination.get("SELECT cutoff_sequence FROM chat_conversations")).cutoff_sequence), 17);
    assert.equal(Number((await destination.get("SELECT COUNT(*) AS count FROM sessions")).count), 0);
    await destination.run("INSERT INTO messages (id,patient_id,user_id,role,text,sources_json,created_at) VALUES (?,?,?,?,?,?,?)", "next-message", "patient-fixture", "user-fixture", "assistant", "fixture", "[]", "2026-09-30");
    assert.equal(Number((await destination.get("SELECT rowid FROM messages WHERE id=?", "next-message")).rowid), 18);
    await destination.audit("user-fixture", "patient-fixture", "fixture.after_import");
    assert.equal(Number((await destination.get("SELECT COUNT(*) AS count FROM audit_events")).count), 2);
    await assert.rejects(importSqlite({ filename, destination, confirmEmptyDestination: true }), /contains app data/);
    assert.equal(Number((await destination.get("SELECT COUNT(*) AS count FROM users")).count), 1);
    assert.equal(Number((await source.get("SELECT COUNT(*) AS count FROM sessions")).count), 1);
  } finally {
    await destination?.close();
    await source.close();
    const target = path.resolve(dir);
    assert.ok(target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(target).startsWith("vitarecall-import-"));
    await rm(target, { recursive: true, force: true });
  }
});
