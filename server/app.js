import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createSessions, equal, hash, hashPassword, publicUser, verifyPassword } from "./auth.js";
import { createAvatarHandler } from "./avatars.js";

const now = () => new Date().toISOString();
function fail(status, message, code) { throw Object.assign(new Error(message), { status, code }); }
function input(value, name, max = 4000, min = 1) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) fail(400, `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
const requestId = (value) => {
  const id = input(value, "Request ID", 80, 16);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail(400, "Invalid request ID.");
  return id;
};
const toMemory = (m) => ({ id: m.id, text: m.text, provenance: m.provenance, status: m.status, jobId: m.job_id, blobId: m.blob_id, createdAt: m.created_at, error: m.error });
const toMessage = (m) => ({ id: m.id, role: m.role, text: m.text, sources: JSON.parse(m.sources_json), createdAt: m.created_at, ...(m.trace_json ? { memoryTrace: JSON.parse(m.trace_json) } : {}) });
const toTask = (t) => ({ id: t.id, title: t.title, completed: Boolean(t.completed), createdAt: t.created_at });

export function createApp({ config, store, memory, chat }) {
  const app = express();
  app.disable("x-powered-by");
  if (config.production) app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" });
    if (config.production) {
      res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      res.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    }
    next();
  });
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", express.json({ limit: "32kb", strict: true }));
  const sessions = createSessions(store, config);
  app.use("/api", sessions.load);
  const buckets = new Map();
  app.use("/api", (req, res, next) => {
    const auth = req.path.startsWith("/auth/");
    const key = `${auth ? "auth" : "api"}:${req.ip}`;
    const time = Date.now();
    if (buckets.size > 10000) for (const [id, bucket] of buckets) if (bucket.until < time) buckets.delete(id);
    const bucket = buckets.get(key) || { count: 0, until: time + (auth ? 300000 : 60000) };
    if (bucket.until < time) { bucket.count = 0; bucket.until = time + (auth ? 300000 : 60000); }
    buckets.set(key, bucket);
    if (++bucket.count > (auth ? 25 : 300)) {
      res.set("Retry-After", String(Math.ceil((bucket.until - time) / 1000)));
      return res.status(429).json({ error: "Too many requests. Please wait a moment before trying again." });
    }
    next();
  });
  app.use("/api", (req, _res, next) => {
    req.body ??= {};
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== config.appOrigin) fail(403, "Request origin is not allowed.");
      if (!req.is("application/json")) fail(415, "Send an application/json request.");
      if (!req.session || !equal(req.headers["x-csrf-token"], req.session.csrf_token)) fail(403, "Session expired. Refresh this page before trying again.", "CSRF_INVALID");
    }
    next();
  });
  const services = () => ({ memoryConfigured: memory.configured, chatConfigured: chat.configured, model: chat.model, network: "mainnet", accountId: memory.accountId || null });
  const sessionPayload = (req) => ({ user: publicUser(req.user), csrfToken: req.session.csrf_token, services: services() });
  app.get("/api/session", (req, res) => {
    if (!req.session) {
      store.run("DELETE FROM sessions WHERE expires_at<?", Date.now());
      sessions.create(req, res);
    }
    res.json(sessionPayload(req));
  });
  function demoUsername(value) {
    const username = input(value, "X username", 16).replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(username)) fail(400, "Use an X username with 1–15 letters, numbers, or underscores.");
    return username;
  }
  app.post("/api/auth/demo", async (req, res) => {
    const username = demoUsername(req.body.username);
    const role = req.body.role ?? "patient";
    if (!["patient", "clinician"].includes(role)) fail(400, "Choose patient or clinician.");
    // A public handle is a display label, never an authentication credential.
    // Re-entering the same handle deliberately creates an isolated workspace.
    const id = randomUUID(), recoveryCode = randomBytes(32).toString("base64url");
    const createdAt = now();
    const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
    store.transaction(() => {
      store.run("INSERT INTO users VALUES (?,?,?,?,?,?)", id, `@${username}`, `${id}@demo.invalid`, passwordHash, role, createdAt);
      store.run("INSERT INTO demo_profiles VALUES (?,?,?,?)", id, username, hash(recoveryCode), createdAt);
      store.run("INSERT INTO patients (id,user_id,care_code) VALUES (?,?,?)", randomUUID(), id, randomBytes(10).toString("hex").toUpperCase());
      store.audit(id, null, "demo.created");
    });
    sessions.create(req, res, id);
    res.status(201).json({ ...sessionPayload(req), recoveryCode });
  });
  app.post("/api/auth/demo/restore", (req, res) => {
    const username = demoUsername(req.body.username);
    const recoveryCode = input(req.body.recoveryCode, "Recovery code", 128);
    const profile = store.get("SELECT user_id FROM demo_profiles WHERE username=? AND recovery_hash=?", username, hash(recoveryCode));
    if (!profile) fail(401, "Username or recovery code is incorrect.");
    sessions.create(req, res, profile.user_id);
    store.audit(profile.user_id, null, "demo.restored");
    res.json(sessionPayload(req));
  });
  app.post("/api/auth/register", async (req, res) => {
    const name = input(req.body.name, "Name", 80, 2);
    const email = input(req.body.email, "Email", 254, 3).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email address.");
    input(req.body.password, "Password", 128, 12);
    const password = req.body.password;
    const role = req.body.role;
    if (!["patient", "clinician"].includes(role)) fail(400, "Choose patient or clinician.");
    if (role === "clinician" && (!config.clinicianInviteCode || !equal(req.body.inviteCode, config.clinicianInviteCode))) fail(403, "A valid clinic invitation code is required.");
    if (store.get("SELECT id FROM users WHERE email=?", email)) fail(409, "Unable to create this account. Try signing in instead.");
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    try {
      store.transaction(() => {
        store.run("INSERT INTO users VALUES (?,?,?,?,?,?)", id, name, email, passwordHash, role, now());
        if (role === "patient") store.run("INSERT INTO patients (id,user_id,care_code) VALUES (?,?,?)", randomUUID(), id, randomBytes(10).toString("hex").toUpperCase());
      });
    } catch (error) {
      if (error.code?.includes("CONSTRAINT")) fail(409, "Unable to create this account. Try signing in instead.");
      throw error;
    }
    sessions.create(req, res, id);
    store.audit(id, null, "account.registered");
    res.status(201).json(sessionPayload(req));
  });
  app.post("/api/auth/login", async (req, res) => {
    const email = input(req.body.email, "Email", 254).toLowerCase();
    input(req.body.password, "Password", 128);
    const password = req.body.password;
    const user = store.get("SELECT * FROM users WHERE email=?", email);
    // The same password derivation work is done for unknown users.
    const encoded = user?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`;
    if (!await verifyPassword(password, encoded) || !user) fail(401, "Email or password is incorrect.");
    sessions.create(req, res, user.id);
    store.audit(user.id, null, "account.login");
    res.json(sessionPayload(req));
  });
  app.post("/api/auth/logout", (req, res) => {
    sessions.create(req, res);
    res.json(sessionPayload(req));
  });
  app.use("/api", (req, _res, next) => {
    if (!req.user) fail(401, "Sign in to continue.", "AUTH_REQUIRED");
    next();
  });
  app.get("/api/avatar/twitter/:username", createAvatarHandler());
  app.use("/api", (req, res, next) => {
    const operation = req.method === "POST" && /\/(chat|memories|recall)$/.exec(req.path)?.[1];
    if (!operation) return next();
    const key = `cost:${req.user.id}:${operation}`;
    const time = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until < time) bucket = { count: 0, until: time + 60000 };
    buckets.set(key, bucket);
    const limit = operation === "memories" ? 6 : operation === "chat" ? 12 : 20;
    if (++bucket.count > limit) {
      res.set("Retry-After", String(Math.ceil((bucket.until - time) / 1000)));
      return res.status(429).json({ error: "Please wait a minute before making another request." });
    }
    next();
  });
  function patientFor(req, id) {
    const patient = store.get("SELECT p.*,u.name,u.email,d.username FROM patients p JOIN users u ON u.id=p.user_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE p.id=?", id);
    if (!patient || (patient.user_id !== req.user.id && !store.get("SELECT 1 FROM care_team WHERE patient_id=? AND clinician_id=?", id, req.user.id))) fail(404, "Patient workspace was not found.");
    return patient;
  }
  const patientJSON = (p, user) => ({ id: p.id, name: p.name, email: p.username ? null : p.email, isDemo: Boolean(p.username), ...(p.username ? { username: p.username } : {}), memoryConsent: Boolean(p.memory_consent), canManageConsent: user.id === p.user_id, ...(user.id === p.user_id ? { careCode: p.care_code } : {}) });
  const readMemories = (id) => store.all("SELECT * FROM memories WHERE patient_id=? ORDER BY created_at DESC", id).map(toMemory);
  const readMessages = (id, userId) => {
    const cutoff = store.get("SELECT cutoff_sequence FROM chat_conversations WHERE patient_id=? AND user_id=?", id, userId)?.cutoff_sequence || 0;
    return store.all("SELECT m.*,t.trace_json FROM (SELECT rowid AS sequence,* FROM messages WHERE patient_id=? AND user_id=? AND rowid>? ORDER BY rowid DESC LIMIT 200) m LEFT JOIN message_memory_traces t ON t.message_id=m.id ORDER BY m.sequence ASC", id, userId, cutoff).map(toMessage);
  };
  const readNotes = (id) => store.all("SELECT n.*,u.name AS author_name FROM notes n JOIN users u ON u.id=n.user_id WHERE patient_id=? ORDER BY n.created_at DESC", id).map(n => ({ id: n.id, text: n.text, authorName: n.author_name, createdAt: n.created_at }));
  const readTasks = (id) => store.all("SELECT * FROM tasks WHERE patient_id=? ORDER BY created_at DESC", id).map(toTask);
  app.get("/api/patients", (req, res) => {
    const patients = store.all("SELECT p.*,u.name,u.email,d.username FROM patients p JOIN users u ON u.id=p.user_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE p.user_id=? OR EXISTS (SELECT 1 FROM care_team c WHERE c.patient_id=p.id AND c.clinician_id=?) ORDER BY CASE WHEN p.user_id=? THEN 0 ELSE 1 END,u.name", req.user.id, req.user.id, req.user.id);
    res.json({ patients: patients.map(p => patientJSON(p, req.user)) });
  });
  app.post("/api/patients/link", (req, res) => {
    if (req.user.role !== "clinician") fail(403, "Only clinician workspaces can link a patient.");
    const code = input(req.body.code, "Care code", 40).replace(/[\s-]/g, "").toUpperCase();
    const p = store.get("SELECT p.*,u.name,u.email,d.username FROM patients p JOIN users u ON u.id=p.user_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE care_code=?", code);
    if (!p) fail(404, "Care code was not found. Ask the patient for their current code.");
    if (req.user.isDemo && !p.username) fail(403, "Unverified demo clinicians can link only fictional demo workspaces.");
    store.run("INSERT OR IGNORE INTO care_team VALUES (?,?,?)", p.id, req.user.id, now());
    store.audit(req.user.id, p.id, "care_team.linked");
    res.json({ patient: patientJSON(p, req.user) });
  });
  app.get("/api/patients/:id/workspace", (req, res) => {
    const p = patientFor(req, req.params.id);
    res.json({ patient: patientJSON(p, req.user), messages: readMessages(p.id, req.user.id), memories: readMemories(p.id), notes: readNotes(p.id), tasks: readTasks(p.id),
      careTeam: store.all("SELECT u.id,u.name,d.username FROM care_team c JOIN users u ON u.id=c.clinician_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE c.patient_id=?", p.id).map(member => ({ ...member, isDemo: Boolean(member.username) })),
      stats: { storedBlobs: store.get("SELECT COUNT(DISTINCT blob_id) AS count FROM memories WHERE patient_id=? AND status='stored'", p.id).count, accountId: memory.accountId || null, network: "mainnet" }, services: services() });
  });
  app.patch("/api/patients/:id/consent", (req, res) => {
    const p = patientFor(req, req.params.id);
    if (req.user.id !== p.user_id) fail(403, "Only the patient can change memory consent.");
    if (typeof req.body.enabled !== "boolean") fail(400, "Consent must be true or false.");
    store.run("UPDATE patients SET memory_consent=?,consent_updated_at=? WHERE id=?", Number(req.body.enabled), now(), p.id);
    store.audit(req.user.id, p.id, req.body.enabled ? "consent.enabled" : "consent.disabled");
    res.json({ patient: patientJSON(patientFor(req, p.id), req.user) });
  });
  app.post("/api/patients/:id/care-code", (req, res) => {
    const p = patientFor(req, req.params.id);
    if (req.user.id !== p.user_id) fail(403, "Only the patient can change their care code.");
    store.run("UPDATE patients SET care_code=? WHERE id=?", randomBytes(10).toString("hex").toUpperCase(), p.id);
    res.json({ patient: patientJSON(patientFor(req, p.id), req.user) });
  });
  app.delete("/api/patients/:id/care-team/:clinicianId", (req, res) => {
    const p = patientFor(req, req.params.id);
    if (req.user.id !== p.user_id) fail(403, "Only the patient can remove a care-team member.");
    store.transaction(() => {
      store.run("DELETE FROM care_team WHERE patient_id=? AND clinician_id=?", p.id, req.params.clinicianId);
      // Rotate the invitation capability so a revoked member cannot immediately relink.
      store.run("UPDATE patients SET care_code=? WHERE id=?", randomBytes(10).toString("hex").toUpperCase(), p.id);
      store.audit(req.user.id, p.id, "care_team.removed");
    });
    res.json({ patient: patientJSON(patientFor(req, p.id), req.user) });
  });
  function recalled(results, patientId) {
    return results.flatMap(result => {
      try {
        const value = JSON.parse(result.text);
        if (value.schema === "vitarecall.memory.v1") {
          if (value.patientId !== patientId || typeof value.text !== "string") return [];
          return [{ ...result, text: `[${value.provenance}; recorded ${value.recordedAt}] ${value.text}` }];
        }
      } catch { /* External memories are still untrusted source text. */ }
      return [result];
    });
  }
  app.post("/api/patients/:id/recall", async (req, res) => {
    const p = patientFor(req, req.params.id);
    const results = await memory.recall(input(req.body.query, "Search query", 1000), `vitarecall:patient:${p.id}`);
    patientFor(req, p.id); // Access may have been revoked during network work.
    store.audit(req.user.id, p.id, "memory.recalled");
    res.json({ memories: recalled(results, p.id) });
  });
  const chatsInFlight = new Set();
  const lastMessageSequence = (patientId, userId) => store.get("SELECT COALESCE(MAX(rowid),0) AS sequence FROM messages WHERE patient_id=? AND user_id=?", patientId, userId).sequence;
  function resetConversation(patientId, userId, cutoff = lastMessageSequence(patientId, userId)) {
    store.run("INSERT INTO chat_conversations (patient_id,user_id,cutoff_sequence,updated_at) VALUES (?,?,?,?) ON CONFLICT(patient_id,user_id) DO UPDATE SET cutoff_sequence=excluded.cutoff_sequence,updated_at=excluded.updated_at", patientId, userId, cutoff, now());
  }
  app.post("/api/patients/:id/conversation/reset", (req, res) => {
    const p = patientFor(req, req.params.id);
    if (chatsInFlight.has(`${p.id}:${req.user.id}`)) fail(409, "Wait for Vita's current reply before starting a new conversation.");
    resetConversation(p.id, req.user.id);
    store.audit(req.user.id, p.id, "chat.conversation_reset");
    res.json({ messages: [] });
  });
  app.post("/api/patients/:id/chat", async (req, res) => {
    const p = patientFor(req, req.params.id);
    const message = input(req.body.message, "Message", 4000);
    const rid = requestId(req.body.requestId);
    if (req.body.freshConversation !== undefined && typeof req.body.freshConversation !== "boolean") fail(400, "Fresh conversation must be true or false.");
    if (!chat.configured) fail(503, "Gemini is not connected yet. Add GEMINI_API_KEY on the server.", "LLM_NOT_CONFIGURED");
    const existing = store.get("SELECT * FROM chat_requests WHERE patient_id=? AND user_id=? AND request_id=?", p.id, req.user.id, rid);
    if (existing?.state === "done") return res.json(JSON.parse(existing.response_json));
    if (existing) fail(409, "This request was already received. Refresh the conversation before retrying.");
    const scope = `${p.id}:${req.user.id}`;
    if (chatsInFlight.has(scope)) fail(409, "Wait for Vita's current reply before sending another message.");
    store.run("INSERT INTO chat_requests VALUES (?,?,?,?,?,?)", p.id, req.user.id, rid, "pending", null, now());
    chatsInFlight.add(scope);
    try {
      const cutoff = lastMessageSequence(p.id, req.user.id);
      const history = req.body.freshConversation ? [] : readMessages(p.id, req.user.id).slice(-12);
      let memories = [], memoryStatus = memory.configured ? "empty" : "not-configured";
      if (memory.configured) {
        try {
          memories = recalled(await memory.recall(message, `vitarecall:patient:${p.id}`), p.id);
          memoryStatus = memories.length ? "recalled" : "empty";
        } catch {
          // An unavailable retrieval service must not prevent a general answer.
          // Keep the lack of recalled context explicit in both model and UI.
          memoryStatus = "unavailable";
          store.audit(req.user.id, p.id, "memory.recall_unavailable");
        }
      }
      patientFor(req, p.id);
      const text = await chat.respond({ role: req.user.role, message, history, memories, memoryStatus,
        profile: { name: p.name, username: p.username || null, isDemo: Boolean(p.username) } });
      patientFor(req, p.id);
      const userMessage = { id: randomUUID(), role: "user", text: message, createdAt: now(), sources: [] };
      const assistantMessage = { id: randomUUID(), role: "assistant", text, createdAt: now(), sources: memories,
        memoryTrace: { status: memoryStatus, sourceCount: memories.length, historyUsed: history.length > 0 } };
      const response = { userMessage, assistantMessage };
      store.transaction(() => {
        if (req.body.freshConversation) resetConversation(p.id, req.user.id, cutoff);
        for (const m of [userMessage, assistantMessage]) store.run("INSERT INTO messages VALUES (?,?,?,?,?,?,?)", m.id, p.id, req.user.id, m.role, m.text, JSON.stringify(m.sources), m.createdAt);
        store.run("INSERT INTO message_memory_traces VALUES (?,?)", assistantMessage.id, JSON.stringify(assistantMessage.memoryTrace));
        store.run("UPDATE chat_requests SET state='done',response_json=? WHERE patient_id=? AND user_id=? AND request_id=?", JSON.stringify(response), p.id, req.user.id, rid);
        store.audit(req.user.id, p.id, "chat.completed");
      });
      res.json(response);
    } catch (error) {
      store.run("UPDATE chat_requests SET state='failed' WHERE patient_id=? AND user_id=? AND request_id=?", p.id, req.user.id, rid);
      throw error;
    } finally { chatsInFlight.delete(scope); }
  });
  app.post("/api/patients/:id/memories", async (req, res) => {
    const p = patientFor(req, req.params.id);
    const text = input(req.body.text, "Memory", 4000);
    const rid = requestId(req.body.requestId);
    const existing = store.get("SELECT * FROM memories WHERE patient_id=? AND user_id=? AND request_id=?", p.id, req.user.id, rid);
    if (existing) return res.json({ memory: toMemory(existing) });
    if (!p.memory_consent) fail(403, "The patient must enable Walrus Memory in settings before a memory can be saved.", "CONSENT_REQUIRED");
    if (!memory.configured) fail(503, "Walrus Memory is not connected yet. Configure the account and delegate key on the server.", "MEMORY_NOT_CONFIGURED");
    const id = randomUUID();
    const namespace = `vitarecall:patient:${p.id}`;
    const provenance = req.user.isDemo ? `demo-${req.user.role}-reported` : req.user.role === "clinician" ? "clinician-confirmed" : "patient-reported";
    const createdAt = now();
    store.run("INSERT INTO memories (id,patient_id,user_id,request_id,text,provenance,status,namespace,created_at) VALUES (?,?,?,?,?,?,?,?,?)", id, p.id, req.user.id, rid, text, provenance, "unknown", namespace, createdAt);
    try {
      const result = await memory.submit(JSON.stringify({ schema: "vitarecall.memory.v1", patientId: p.id, text, provenance, authorRole: req.user.role, recordedAt: createdAt }), namespace);
      store.run("UPDATE memories SET status='processing',job_id=? WHERE id=?", result.jobId, id);
      store.audit(req.user.id, p.id, "memory.submitted");
    } catch (error) {
      // A timeout may happen after upstream acceptance. Do not retry it or invent failure/proof.
      store.run("UPDATE memories SET error=? WHERE id=?", "The submission could not be confirmed. Check the Walrus account before saving again to avoid a duplicate.", id);
      store.audit(req.user.id, p.id, "memory.submission_uncertain");
    }
    patientFor(req, p.id);
    res.status(202).json({ memory: toMemory(store.get("SELECT * FROM memories WHERE id=?", id)) });
  });
  app.get("/api/patients/:id/memories/:memoryId/status", async (req, res) => {
    const p = patientFor(req, req.params.id);
    let row = store.get("SELECT * FROM memories WHERE id=? AND patient_id=?", req.params.memoryId, p.id);
    if (!row) fail(404, "Memory was not found.");
    if (row.status === "processing" && row.job_id) {
      const result = await memory.receipt(row.job_id);
      if (result.status === "stored" && !result.blobId) fail(502, "Walrus did not return a blob ID. Storage is still unconfirmed.");
      if (["stored", "failed"].includes(result.status)) {
        store.run("UPDATE memories SET status=?,blob_id=?,owner=?,error=? WHERE id=?", result.status, result.blobId || null, result.owner || null, result.error || null, row.id);
        store.audit(req.user.id, p.id, `memory.${result.status}`);
        row = store.get("SELECT * FROM memories WHERE id=?", row.id);
      }
    }
    patientFor(req, p.id);
    res.json({ memory: toMemory(row) });
  });
  app.post("/api/patients/:id/notes", (req, res) => {
    const p = patientFor(req, req.params.id);
    const text = input(req.body.text, "Note", 6000);
    const id = randomUUID(), createdAt = now();
    store.run("INSERT INTO notes VALUES (?,?,?,?,?)", id, p.id, req.user.id, text, createdAt);
    store.audit(req.user.id, p.id, "note.created");
    res.status(201).json({ note: { id, text, authorName: req.user.name, createdAt } });
  });
  app.post("/api/patients/:id/tasks", (req, res) => {
    const p = patientFor(req, req.params.id);
    const title = input(req.body.title, "Task", 200);
    const id = randomUUID();
    store.run("INSERT INTO tasks VALUES (?,?,?,?,?,?)", id, p.id, req.user.id, title, 0, now());
    res.status(201).json({ task: toTask(store.get("SELECT * FROM tasks WHERE id=?", id)) });
  });
  app.patch("/api/patients/:id/tasks/:taskId", (req, res) => {
    const p = patientFor(req, req.params.id);
    if (typeof req.body.completed !== "boolean") fail(400, "Task completion must be true or false.");
    const task = store.get("SELECT * FROM tasks WHERE id=? AND patient_id=?", req.params.taskId, p.id);
    if (!task) fail(404, "Task was not found.");
    store.run("UPDATE tasks SET completed=? WHERE id=?", Number(req.body.completed), task.id);
    res.json({ task: toTask(store.get("SELECT * FROM tasks WHERE id=?", task.id)) });
  });
  app.post("/api/services/verify", async (_req, res) => res.json({ verification: await memory.verify() }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "API route was not found." }));
  const dist = path.resolve("dist");
  if (existsSync(path.join(dist, "index.html"))) {
    app.use(express.static(dist, { index: false, maxAge: config.production ? "1h" : 0 }));
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
  app.use((error, _req, res, _next) => {
    const status = error.type === "entity.too.large" ? 413 : error instanceof SyntaxError && error.status === 400 ? 400 : Number.isInteger(error.status) ? error.status : 500;
    const message = status === 500 ? "The server could not complete this request. Please try again." : status === 413 ? "This request is too large." : error.message;
    if (status === 500) console.error("Request failed:", error.code || error.name); // No payloads, tokens, or upstream bodies.
    res.status(status).json({ error: message, ...(error.code ? { code: error.code } : {}) });
  });
  return app;
}
