import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { createPostgresPoolOptions } from "../server/postgres-store.js";

// Explicit operator action only. Starting the app never creates/mutates its schema.
let pool;
try {
  pool = new pg.Pool(createPostgresPoolOptions({
    connectionString: process.env.DATABASE_URL,
    ca: process.env.DATABASE_CA_CERT,
  }));
  const sql = (await Promise.all(['001_initial', '002_conversation_memory', '003_telegram'].map(version => readFile(new URL(`../supabase/migrations/${version}.sql`, import.meta.url), 'utf8')))).join('\n');
  const client = await pool.connect();
  try {
    await client.query(sql);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  console.log("VitaRecall database schema 003_telegram is ready. No existing patient records or consent settings were overwritten.");
} catch (error) {
  // Connection errors may contain database credentials. Never echo the raw error.
  console.error(error.code === "DATABASE_CONFIG"
    ? error.message
    : "Database migration failed. Check the private connection string, TLS certificate, project availability, and schema-owner permissions. No connection credentials were logged.");
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
