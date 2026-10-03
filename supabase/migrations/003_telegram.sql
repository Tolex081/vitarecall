-- Additive server-only support for a patient-owned Telegram channel.
BEGIN;
SELECT pg_advisory_xact_lock(1987346112);
CREATE TABLE IF NOT EXISTS vitarecall.telegram_link_tokens (
  token_hash TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES vitarecall.patients(id),
  user_id TEXT NOT NULL REFERENCES vitarecall.users(id), expires_at BIGINT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS telegram_link_tokens_expiry ON vitarecall.telegram_link_tokens(expires_at);
CREATE TABLE IF NOT EXISTS vitarecall.telegram_connections (
  telegram_user_id TEXT PRIMARY KEY, chat_id TEXT UNIQUE NOT NULL,
  patient_id TEXT UNIQUE NOT NULL REFERENCES vitarecall.patients(id), user_id TEXT NOT NULL REFERENCES vitarecall.users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vitarecall.telegram_updates (
  update_id TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
ALTER TABLE vitarecall.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitarecall.telegram_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitarecall.telegram_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vitarecall.telegram_link_tokens, vitarecall.telegram_connections, vitarecall.telegram_updates FROM PUBLIC;
DO $permissions$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON vitarecall.telegram_link_tokens, vitarecall.telegram_connections, vitarecall.telegram_updates FROM %I', api_role);
    END IF;
  END LOOP;
END
$permissions$;
INSERT INTO vitarecall.schema_migrations(version) VALUES ('003_telegram') ON CONFLICT (version) DO NOTHING;
COMMIT;
