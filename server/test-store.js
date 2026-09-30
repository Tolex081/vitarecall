import { createStore } from './store.js';

export async function createTestStore(filename = ':memory:') {
  if (process.env.STORE_TEST_ENGINE !== 'pglite') return createStore(filename);
  const { createPostgresStore } = await import('./postgres-store.js');
  const { createTestPostgresPool } = await import('./testing/postgres.js');
  const pool = await createTestPostgresPool({ filename: filename === ':memory:' ? undefined : filename });
  try { return await createPostgresStore({ pool }); }
  catch (error) { await pool.end(); throw error; }
}
