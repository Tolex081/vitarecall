-- Add an immutable, provider-verified Telegram identity for cross-device sign-in.
BEGIN;
SELECT pg_advisory_xact_lock(1987346112);
CREATE TABLE IF NOT EXISTS vitarecall.external_identities (
  provider TEXT NOT NULL CHECK (provider IN ('telegram')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES vitarecall.users(id),
  username TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, user_id)
);
ALTER TABLE vitarecall.external_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vitarecall.external_identities FROM PUBLIC;
DO $permissions$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON vitarecall.external_identities FROM %I', api_role);
    END IF;
  END LOOP;
END
$permissions$;
INSERT INTO vitarecall.schema_migrations(version) VALUES ('004_telegram_login') ON CONFLICT (version) DO NOTHING;
COMMIT;
-- Run explicitly with npm run db:migrate or paste the entire file in SQL Editor.
