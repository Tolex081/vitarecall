import pg from "pg";

export const SCHEMA_VERSION = "004_telegram_login";
const tables = new Set([
  "users", "sessions", "demo_profiles", "external_identities", "patients", "care_team", "messages",
  "chat_conversations", "message_memory_traces", "chat_requests", "memories",
  "notes", "tasks", "audit_events", "rate_limits", "operation_locks",
  "conversation_memory_settings", "conversation_memories",
  "telegram_link_tokens", "telegram_connections", "telegram_updates",
]);

// The application uses fixed SQL and bound values. This lexer converts its ?
// placeholders without touching literals, quoted identifiers, or comments.
// PostgreSQL JSON ? operators are intentionally outside this small interface.
export function postgresSql(sql, argumentCount) {
  const tokens = [];
  for (let index = 0; index < sql.length;) {
    const start = index;
    const character = sql[index];
    let kind = "punctuation";
    if (/\s/.test(character)) {
      while (index < sql.length && /\s/.test(sql[index])) index++;
      kind = "space";
    } else if (sql.startsWith("--", index)) {
      index = sql.indexOf("\n", index);
      if (index === -1) index = sql.length;
      kind = "comment";
    } else if (sql.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth) {
        if (sql.startsWith("/*", index)) { depth++; index += 2; }
        else if (sql.startsWith("*/", index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error("Unterminated SQL comment.");
      kind = "comment";
    } else if (character === "'" || character === '"') {
      const escaped = character === "'" && /[eE]/.test(sql[start - 1] || "")
        && !/[\w$]/.test(sql[start - 2] || "");
      index++;
      let complete = false;
      while (index < sql.length) {
        if (escaped && sql.charCodeAt(index) === 92) { index += 2; continue; }
        if (sql[index] === character) {
          if (sql[index + 1] === character) { index += 2; continue; }
          index++; complete = true; break;
        }
        index++;
      }
      if (!complete) throw new Error("Unterminated SQL literal.");
      kind = "literal";
    } else if (character === "$" && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(index))) {
      const delimiter = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)[0];
      const end = sql.indexOf(delimiter, index + delimiter.length);
      if (end === -1) throw new Error("Unterminated SQL dollar quote.");
      index = end + delimiter.length;
      kind = "literal";
    } else if (/[A-Za-z_]/.test(character)) {
      index++;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index++;
      kind = "word";
    } else {
      index++;
    }
    tokens.push({ kind, value: sql.slice(start, index) });
  }
  let argument = 0;
  let expectTable = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === "space" || token.kind === "comment") continue;
    if (token.kind === "punctuation" && token.value === "?") token.value = `$${++argument}`;
    const word = token.kind === "word" ? token.value.toLowerCase() : "";
    if (expectTable) {
      const next = tokens.slice(index + 1).find((item) => item.kind !== "space" && item.kind !== "comment");
      if (tables.has(word) && next?.value !== ".") token.value = `vitarecall.${token.value}`;
      expectTable = false;
    }
    if (["from", "join", "into", "update"].includes(word)) expectTable = true;
  }
  if (argumentCount !== undefined && argument !== argumentCount) {
    throw new Error("The SQL placeholder count does not match its bound values.");
  }
  return tokens.map((token) => token.value).join("");
}

export function createPostgresPoolOptions({ connectionString, ca } = {}) {
  let url;
  try { url = new URL(connectionString); } catch { /* Report no supplied credentials. */ }
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
    throw Object.assign(new Error("Set DATABASE_URL to your private PostgreSQL connection string."), { code: "DATABASE_CONFIG" });
  }
  // pg connection-string SSL parameters otherwise override the explicit object.
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("ssl")) url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca: ca.replace(/\\n/g, "\n") } : {}) },
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "vitarecall",
  };
}

function queryMethods(client, ensureActive = () => {}) {
  const query = async (sql, args) => {
    ensureActive();
    return client.query(postgresSql(sql, args.length), args);
  };
  const api = {
    get: async (sql, ...args) => (await query(sql, args)).rows[0],
    all: async (sql, ...args) => (await query(sql, args)).rows,
    run: async (sql, ...args) => ({ changes: Number((await query(sql, args)).rowCount || 0) }),
    audit: (userId, patientId, action) => api.run(
      "INSERT INTO audit_events (user_id,patient_id,action,created_at) VALUES (?,?,?,?)",
      userId || null, patientId || null, action, new Date().toISOString(),
    ),
  };
  return api;
}

export async function createPostgresStore({ connectionString, ca, pool: suppliedPool } = {}) {
  const pool = suppliedPool || new pg.Pool(createPostgresPoolOptions({ connectionString, ca }));
  // Idle network failures are handled by the next request, without logging secrets.
  if (!suppliedPool) pool.on("error", () => {});
  try {
    const result = await pool.query("SELECT version FROM vitarecall.schema_migrations WHERE version=$1", [SCHEMA_VERSION]);
    if (!result.rows.length) throw Object.assign(new Error("Missing schema version."), { code: "42P01" });
  } catch (error) {
    if (!suppliedPool) await pool.end().catch(() => {});
    const missing = ["42P01", "3F000"].includes(error.code);
    throw Object.assign(new Error(missing
      ? "The VitaRecall database schema is missing. Run npm run db:migrate before starting the app."
      : "Could not connect to the PostgreSQL database. Check DATABASE_URL, certificate settings, and project availability."),
    { code: missing ? "DATABASE_MIGRATION_REQUIRED" : "DATABASE_UNAVAILABLE" });
  }
  let closed = false;
  const ensureOpen = () => { if (closed) throw new Error("The database is closed."); };
  return {
    dialect: "postgres",
    pool,
    ...queryMethods(pool, ensureOpen),
    async transaction(fn) {
      ensureOpen();
      const client = await pool.connect();
      let active = true;
      const tx = queryMethods(client, () => { if (!active) throw new Error("The transaction has finished."); });
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        active = false;
        client.release();
      }
    },
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}
