import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL engine with a pg-compatible minimal pool facade. No network.
export async function createTestPostgresPool({ migrate = true, filename } = {}) {
  const database = new PGlite(filename ? `${filename}.pglite` : undefined);
  await database.waitReady;
  await database.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;`);
  const migration = (await Promise.all(['001_initial', '002_conversation_memory', '003_telegram', '004_telegram_login'].map(version => readFile(new URL(`../../supabase/migrations/${version}.sql`, import.meta.url), 'utf8')))).join('\n');
  if (migrate) await database.exec(migration);
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }
  const query = async (sql, values = []) => {
    const result = await database.query(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows || 0 };
  };
  return {
    database,
    migration,
    async query(sql, values = []) {
      const release = await acquire();
      try { return await query(sql, values); } finally { release(); }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
    async end() {
      const release = await acquire();
      try { await database.close(); } finally { release(); }
    },
  };
}
