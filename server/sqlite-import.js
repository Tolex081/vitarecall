import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import path from "node:path";

// Static table/column lists: no identifiers are accepted from external input.
const tables = {
  users: "id,name,email,password_hash,role,created_at",
  demo_profiles: "user_id,username,recovery_hash,created_at",
  patients: "id,user_id,care_code,memory_consent,consent_updated_at",
  care_team: "patient_id,clinician_id,created_at",
  messages: "rowid,id,patient_id,user_id,role,text,sources_json,created_at",
  chat_conversations: "patient_id,user_id,cutoff_sequence,updated_at",
  message_memory_traces: "message_id,trace_json",
  chat_requests: "patient_id,user_id,request_id,state,response_json,created_at",
  memories: "id,patient_id,user_id,request_id,text,provenance,status,job_id,blob_id,owner,namespace,error,created_at",
  notes: "id,patient_id,user_id,text,created_at",
  tasks: "id,patient_id,user_id,title,completed,created_at",
  audit_events: "id,user_id,patient_id,action,created_at",
};
const destinationTables = [...Object.keys(tables), "sessions", "rate_limits", "operation_locks"];

export async function importSqlite({ filename, destination, confirmEmptyDestination = false }) {
  if (!confirmEmptyDestination) throw new Error("Explicit empty-destination confirmation is required.");
  if (destination?.dialect !== "postgres") throw new Error("The destination must be PostgreSQL.");
  if (typeof filename !== "string" || !filename || filename === ":memory:") throw new Error("Choose an existing SQLite file.");
  const sourcePath = path.resolve(filename);
  if (!statSync(sourcePath).isFile()) throw new Error("Choose an existing SQLite file.");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const snapshot = {};
  try {
    // Read the live SQLite file through SQLite (including its WAL), never copy
    // only the main file. One read transaction supplies a consistent snapshot.
    source.exec("PRAGMA query_only=ON; BEGIN");
    for (const [table, columns] of Object.entries(tables)) {
      snapshot[table] = source.prepare(`SELECT ${columns} FROM ${table}`).all();
    }
    source.exec("COMMIT");
  } finally { source.close(); }

  return destination.transaction(async tx => {
    // Block application writes while checking emptiness and importing. This is
    // an explicit setup action, never part of normal app startup.
    await tx.run(`LOCK TABLE ${destinationTables.map(table => `vitarecall.${table}`).join(",")} IN ACCESS EXCLUSIVE MODE`);
    for (const table of destinationTables) {
      if (Number((await tx.get(`SELECT COUNT(*) AS count FROM ${table}`)).count)) {
        throw new Error("Destination contains app data. Import stopped without overwriting it.");
      }
    }
    const counts = {};
    for (const [table, columns] of Object.entries(tables)) {
      const fields = columns.split(",");
      const sql = `INSERT INTO ${table} (${columns}) VALUES (${fields.map(() => "?").join(",")})`;
      for (const row of snapshot[table]) await tx.run(sql, ...fields.map(field => row[field]));
      counts[table] = snapshot[table].length;
    }
    await tx.get("SELECT setval(pg_get_serial_sequence('vitarecall.messages','rowid'), GREATEST(COALESCE(MAX(rowid),0),1), COUNT(*)>0) FROM messages");
    await tx.get("SELECT setval(pg_get_serial_sequence('vitarecall.audit_events','id'), GREATEST(COALESCE(MAX(id),0),1), COUNT(*)>0) FROM audit_events");
    return counts;
  });
}
