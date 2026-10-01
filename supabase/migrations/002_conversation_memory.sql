-- Additive, server-only; existing manual-save consent is deliberately unchanged.
BEGIN;
SELECT pg_advisory_xact_lock(1987346112);
CREATE TABLE IF NOT EXISTS vitarecall.conversation_memory_settings (
  patient_id TEXT NOT NULL REFERENCES vitarecall.patients(id),
  user_id TEXT NOT NULL REFERENCES vitarecall.users(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)), updated_at TEXT NOT NULL,
  PRIMARY KEY (patient_id,user_id)
);
CREATE TABLE IF NOT EXISTS vitarecall.conversation_memories (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES vitarecall.patients(id),
  user_id TEXT NOT NULL REFERENCES vitarecall.users(id), request_id TEXT NOT NULL,
  part INTEGER NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
  job_id TEXT, blob_id TEXT, error TEXT, created_at TEXT NOT NULL,
  UNIQUE (patient_id,user_id,request_id,part)
);
CREATE INDEX IF NOT EXISTS conversation_memories_scope ON vitarecall.conversation_memories(patient_id,user_id,status,created_at);
ALTER TABLE vitarecall.conversation_memory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitarecall.conversation_memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vitarecall.conversation_memory_settings,vitarecall.conversation_memories FROM PUBLIC;
DO $permissions$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON vitarecall.conversation_memory_settings,vitarecall.conversation_memories FROM %I', api_role);
    END IF;
  END LOOP;
END
$permissions$;
INSERT INTO vitarecall.schema_migrations(version) VALUES ('002_conversation_memory') ON CONFLICT (version) DO NOTHING;
COMMIT;
