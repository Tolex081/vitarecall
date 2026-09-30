import "dotenv/config";
import { createPostgresStore } from "../server/postgres-store.js";
import { importSqlite } from "../server/sqlite-import.js";

const args = process.argv.slice(2);
let store;
try {
  if (args.length !== 3 || args[0] !== "--sqlite" || !args[1] || args[2] !== "--confirm-empty-destination") {
    throw new Error("Usage: npm run db:import:sqlite -- --sqlite ./data/vitarecall.sqlite --confirm-empty-destination");
  }
  store = await createPostgresStore({ connectionString: process.env.DATABASE_URL, ca: process.env.DATABASE_CA_CERT });
  const counts = await importSqlite({ filename: args[1], destination: store, confirmEmptyDestination: true });
  console.log("SQLite import completed. Original patient IDs, memory mappings and recovery hashes are preserved. Sign in or restore your profile again; browser sessions were not copied.");
  console.log(JSON.stringify({ importedRows: counts }));
} catch {
  console.error("Import did not complete. Check command arguments, source file, empty migrated destination and private database configuration. Existing records were not overwritten. No credentials or patient content were logged.");
  process.exitCode = 1;
} finally { await store?.close(); }
