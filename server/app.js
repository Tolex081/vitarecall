import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createSessions, equal, hash, hashPassword, publicUser, verifyPassword } from "./auth.js";
import { createAvatarHandler } from "./avatars.js";
import { createCoordination } from "./coordination.js";

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
  const coordination = createCoordination(store);
  const releaseLease = async lease => {
    try { await coordination.release(lease); }
    catch { console.error("Operation lease cleanup was unavailable; the lease will expire automatically."); }
  };
  app.use("/api", async (req, res, next) => {
    const auth = req.path.startsWith("/auth/");
    const key = `${auth ? "auth" : "api"}:${hash(req.ip || "unknown")}`;
    const bucket = await coordination.consume(key, auth ? 25 : 300, auth ? 300000 : 60000);
    if (!bucket.allowed) {
      res.set("Retry-After", String(bucket.retryAfter));
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
  app.get("/api/session", async (req, res) => {
    if (!req.session) {
      await store.run("DELETE FROM sessions WHERE expires_at<?", Date.now());
      await coordination.cleanup();
      await sessions.create(req, res);
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
    await store.transaction(async tx => {
      await tx.run("INSERT INTO users VALUES (?,?,?,?,?,?)", id, `@${username}`, `${id}@demo.invalid`, passwordHash, role, createdAt);
      await tx.run("INSERT INTO demo_profiles VALUES (?,?,?,?)", id, username, hash(recoveryCode), createdAt);
      await tx.run("INSERT INTO patients (id,user_id,care_code) VALUES (?,?,?)", randomUUID(), id, randomBytes(10).toString("hex").toUpperCase());
      await tx.audit(id, null, "demo.created");
    });
    await sessions.create(req, res, id);
    res.status(201).json({ ...sessionPayload(req), recoveryCode });
  });
  app.post("/api/auth/demo/restore", async (req, res) => {
    const username = demoUsername(req.body.username);
    const recoveryCode = input(req.body.recoveryCode, "Recovery code", 128);
    const profile = await store.get("SELECT user_id FROM demo_profiles WHERE username=? AND recovery_hash=?", username, hash(recoveryCode));
    if (!profile) fail(401, "Username or recovery code is incorrect.");
    await sessions.create(req, res, profile.user_id);
    await store.audit(profile.user_id, null, "demo.restored");
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
    if (await store.get("SELECT id FROM users WHERE email=?", email)) fail(409, "Unable to create this account. Try signing in instead.");
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    try {
      await store.transaction(async tx => {
        await tx.run("INSERT INTO users VALUES (?,?,?,?,?,?)", id, name, email, passwordHash, role, now());
        if (role === "patient") await tx.run("INSERT INTO patients (id,user_id,care_code) VALUES (?,?,?)", randomUUID(), id, randomBytes(10).toString("hex").toUpperCase());
      });
    } catch (error) {
      if (error.code === "23505" || (typeof error.code === "string" && error.code.includes("CONSTRAINT"))) fail(409, "Unable to create this account. Try signing in instead.");
      throw error;
    }
    await sessions.create(req, res, id);
    await store.audit(id, null, "account.registered");
    res.status(201).json(sessionPayload(req));
  });
  app.post("/api/auth/login", async (req, res) => {
    const email = input(req.body.email, "Email", 254).toLowerCase();
    input(req.body.password, "Password", 128);
    const password = req.body.password;
    const user = await store.get("SELECT * FROM users WHERE email=?", email);
    // The same password derivation work is done for unknown users.
    const encoded = user?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`;
    if (!await verifyPassword(password, encoded) || !user) fail(401, "Email or password is incorrect.");
    await sessions.create(req, res, user.id);
    await store.audit(user.id, null, "account.login");
    res.json(sessionPayload(req));
  });
  app.post("/api/auth/logout", async (req, res) => {
    await sessions.create(req, res);
    res.json(sessionPayload(req));
  });
  app.use("/api", (req, _res, next) => {
    if (!req.user) fail(401, "Sign in to continue.", "AUTH_REQUIRED");
    next();
  });
  app.get("/api/avatar/twitter/:username", createAvatarHandler());
  app.use("/api", async (req, res, next) => {
    const operation = req.method === "POST" && /\/(chat|memories|recall)$/.exec(req.path)?.[1];
    if (!operation) return next();
    const key = `cost:${req.user.id}:${operation}`;
    const limit = operation === "memories" ? 6 : operation === "chat" ? 12 : 20;
    const bucket = await coordination.consume(key, limit, 60000);
    if (!bucket.allowed) {
      res.set("Retry-After", String(bucket.retryAfter));
      return res.status(429).json({ error: "Please wait a minute before making another request." });
    }
    next();
  });
  async function patientFor(req, id, db = store) {
    const patient = await db.get("SELECT p.*,u.name,u.email,d.username FROM patients p JOIN users u ON u.id=p.user_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE p.id=?", id);
    if (!patient || (patient.user_id !== req.user.id && !await db.get("SELECT 1 FROM care_team WHERE patient_id=? AND clinician_id=?", id, req.user.id))) fail(404, "Patient workspace was not found.");
    return patient;
  }
  const patientJSON = (p, user) => ({ id: p.id, name: p.name, email: p.username ? null : p.email, isDemo: Boolean(p.username), ...(p.username ? { username: p.username } : {}), memoryConsent: Boolean(p.memory_consent), canManageConsent: user.id === p.user_id, ...(user.id === p.user_id ? { careCode: p.care_code } : {}) });
  const readMemories = async (id) => (await store.all("SELECT * FROM memories WHERE patient_id=? ORDER BY created_at DESC", id)).map(toMemory);
  const readMessages = async (id, userId) => {
    const cutoff = (await store.get("SELECT cutoff_sequence FROM chat_conversations WHERE patient_id=? AND user_id=?", id, userId))?.cutoff_sequence || 0;
    return (await store.all("SELECT m.*,t.trace_json FROM (SELECT rowid AS sequence,* FROM messages WHERE patient_id=? AND user_id=? AND rowid>? ORDER BY rowid DESC LIMIT 200) m LEFT JOIN message_memory_traces t ON t.message_id=m.id ORDER BY m.sequence ASC", id, userId, cutoff)).map(toMessage);
  };
  const readNotes = async (id) => (await store.all("SELECT n.*,u.name AS author_name FROM notes n JOIN users u ON u.id=n.user_id WHERE patient_id=? ORDER BY n.created_at DESC", id)).map(n => ({ id: n.id, text: n.text, authorName: n.author_name, createdAt: n.created_at }));
  const readTasks = async (id) => (await store.all("SELECT * FROM tasks WHERE patient_id=? ORDER BY created_at DESC", id)).map(toTask);
  app.get("/api/patients", async (req, res) => {
    const patients = await store.all("SELECT p.*,u.name,u.email,d.username FROM patients p JOIN users u ON u.id=p.user_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE p.user_id=? OR EXISTS (SELECT 1 FROM care_team c WHERE c.patient_id=p.id AND c.clinician_id=?) ORDER BY CASE WHEN p.user_id=? THEN 0 ELSE 1 END,u.name", req.user.id, req.user.id, req.user.id);
    res.json({ patients: patients.map(p => patientJSON(p, req.user)) });
  });
  app.post("/api/patients/link", async (req, res) => {
    if (req.user.role !== "clinician") fail(403, "Only clinician workspaces can link a patient.");
    const code = input(req.body.code, "Care code", 40).replace(/[\s-]/g, "").toUpperCase();
    const p = await store.get("SELECT p.*,u.name,u.email,d.username FROM patients p JOIN users u ON u.id=p.user_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE care_code=?", code);
    if (!p) fail(404, "Care code was not found. Ask the patient for their current code.");
    if (req.user.isDemo && !p.username) fail(403, "Unverified demo clinicians can link only fictional demo workspaces.");
    await store.run("INSERT INTO care_team VALUES (?,?,?) ON CONFLICT(patient_id,clinician_id) DO NOTHING", p.id, req.user.id, now());
    await store.audit(req.user.id, p.id, "care_team.linked");
    res.json({ patient: patientJSON(p, req.user) });
  });
  app.get("/api/patients/:id/workspace", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const [messages, memories, notes, tasks, careTeam, stats] = await Promise.all([
      readMessages(p.id, req.user.id), readMemories(p.id), readNotes(p.id), readTasks(p.id),
      store.all("SELECT u.id,u.name,d.username FROM care_team c JOIN users u ON u.id=c.clinician_id LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE c.patient_id=?", p.id),
      store.get("SELECT COUNT(DISTINCT blob_id) AS count FROM memories WHERE patient_id=? AND status='stored'", p.id),
    ]);
    await patientFor(req, p.id);
    res.json({ patient: patientJSON(p, req.user), messages, memories, notes, tasks,
      careTeam: careTeam.map(member => ({ ...member, isDemo: Boolean(member.username) })),
      stats: { storedBlobs: Number(stats.count), accountId: memory.accountId || null, network: "mainnet" }, services: services() });
  });
  app.patch("/api/patients/:id/consent", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    if (req.user.id !== p.user_id) fail(403, "Only the patient can change memory consent.");
    if (typeof req.body.enabled !== "boolean") fail(400, "Consent must be true or false.");
    await store.run("UPDATE patients SET memory_consent=?,consent_updated_at=? WHERE id=?", Number(req.body.enabled), now(), p.id);
    await store.audit(req.user.id, p.id, req.body.enabled ? "consent.enabled" : "consent.disabled");
    res.json({ patient: patientJSON(await patientFor(req, p.id), req.user) });
  });
  app.post("/api/patients/:id/care-code", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    if (req.user.id !== p.user_id) fail(403, "Only the patient can change their care code.");
    await store.run("UPDATE patients SET care_code=? WHERE id=?", randomBytes(10).toString("hex").toUpperCase(), p.id);
    res.json({ patient: patientJSON(await patientFor(req, p.id), req.user) });
  });
  app.delete("/api/patients/:id/care-team/:clinicianId", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    if (req.user.id !== p.user_id) fail(403, "Only the patient can remove a care-team member.");
    await store.transaction(async tx => {
      await tx.run("DELETE FROM care_team WHERE patient_id=? AND clinician_id=?", p.id, req.params.clinicianId);
      // Rotate the invitation capability so a revoked member cannot immediately relink.
      await tx.run("UPDATE patients SET care_code=? WHERE id=?", randomBytes(10).toString("hex").toUpperCase(), p.id);
      await tx.audit(req.user.id, p.id, "care_team.removed");
    });
    res.json({ patient: patientJSON(await patientFor(req, p.id), req.user) });
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
    const p = await patientFor(req, req.params.id);
    const results = await memory.recall(input(req.body.query, "Search query", 1000), `vitarecall:patient:${p.id}`);
    await patientFor(req, p.id); // Access may have been revoked during network work.
    await store.audit(req.user.id, p.id, "memory.recalled");
    res.json({ memories: recalled(results, p.id) });
  });
  const lastMessageSequence = async (patientId, userId, db = store) => (await db.get("SELECT COALESCE(MAX(rowid),0) AS sequence FROM messages WHERE patient_id=? AND user_id=?", patientId, userId)).sequence;
  async function resetConversation(patientId, userId, cutoff, db = store) {
    await db.run("INSERT INTO chat_conversations (patient_id,user_id,cutoff_sequence,updated_at) VALUES (?,?,?,?) ON CONFLICT(patient_id,user_id) DO UPDATE SET cutoff_sequence=excluded.cutoff_sequence,updated_at=excluded.updated_at", patientId, userId, cutoff, now());
  }
  app.post("/api/patients/:id/conversation/reset", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const lease = await coordination.acquire(`chat:${p.id}:${req.user.id}`);
    if (!lease) fail(409, "Wait for Vita's current reply before starting a new conversation.");
    try {
      await store.transaction(async tx => {
        await coordination.assert(lease, tx);
        await patientFor(req, p.id, tx);
        await resetConversation(p.id, req.user.id, await lastMessageSequence(p.id, req.user.id, tx), tx);
        await tx.audit(req.user.id, p.id, "chat.conversation_reset");
      });
      res.json({ messages: [] });
    } finally { await releaseLease(lease); }
  });
  app.post("/api/patients/:id/chat", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const message = input(req.body.message, "Message", 4000);
    const rid = requestId(req.body.requestId);
    if (req.body.freshConversation !== undefined && typeof req.body.freshConversation !== "boolean") fail(400, "Fresh conversation must be true or false.");
    if (!chat.configured) fail(503, "Gemini is not connected yet. Add GEMINI_API_KEY on the server.", "LLM_NOT_CONFIGURED");
    const existing = await store.get("SELECT * FROM chat_requests WHERE patient_id=? AND user_id=? AND request_id=?", p.id, req.user.id, rid);
    if (existing?.state === "done") return res.json(JSON.parse(existing.response_json));
    if (existing) fail(409, "This request was already received. Refresh the conversation before retrying.");
    const lease = await coordination.acquire(`chat:${p.id}:${req.user.id}`);
    if (!lease) fail(409, "Wait for Vita's current reply before sending another message.");
    let requestCreated = false;
    try {
      const inserted = await store.run("INSERT INTO chat_requests VALUES (?,?,?,?,?,?) ON CONFLICT(patient_id,user_id,request_id) DO NOTHING", p.id, req.user.id, rid, "pending", null, now());
      if (!Number(inserted.changes)) {
        const duplicate = await store.get("SELECT * FROM chat_requests WHERE patient_id=? AND user_id=? AND request_id=?", p.id, req.user.id, rid);
        if (duplicate?.state === "done") return res.json(JSON.parse(duplicate.response_json));
        fail(409, "This request was already received. Refresh the conversation before retrying.");
      }
      requestCreated = true;
      const cutoff = await lastMessageSequence(p.id, req.user.id);
      const history = req.body.freshConversation ? [] : (await readMessages(p.id, req.user.id)).slice(-12);
      let memories = [], memoryStatus = memory.configured ? "empty" : "not-configured";
      if (memory.configured) {
        try {
          memories = recalled(await memory.recall(message, `vitarecall:patient:${p.id}`), p.id);
          memoryStatus = memories.length ? "recalled" : "empty";
        } catch {
          // An unavailable retrieval service must not prevent a general answer.
          // Keep the lack of recalled context explicit in both model and UI.
          memoryStatus = "unavailable";
          await store.audit(req.user.id, p.id, "memory.recall_unavailable");
        }
      }
      await patientFor(req, p.id);
      const text = await chat.respond({ role: req.user.role, message, history, memories, memoryStatus,
        profile: { name: p.name, username: p.username || null, isDemo: Boolean(p.username) } });
      await patientFor(req, p.id);
      const userMessage = { id: randomUUID(), role: "user", text: message, createdAt: now(), sources: [] };
      const assistantMessage = { id: randomUUID(), role: "assistant", text, createdAt: now(), sources: memories,
        memoryTrace: { status: memoryStatus, sourceCount: memories.length, historyUsed: history.length > 0 } };
      const response = { userMessage, assistantMessage };
      await store.transaction(async tx => {
        await coordination.assert(lease, tx);
        await patientFor(req, p.id, tx);
        if (req.body.freshConversation) await resetConversation(p.id, req.user.id, cutoff, tx);
        for (const m of [userMessage, assistantMessage]) await tx.run("INSERT INTO messages (id,patient_id,user_id,role,text,sources_json,created_at) VALUES (?,?,?,?,?,?,?)", m.id, p.id, req.user.id, m.role, m.text, JSON.stringify(m.sources), m.createdAt);
        await tx.run("INSERT INTO message_memory_traces VALUES (?,?)", assistantMessage.id, JSON.stringify(assistantMessage.memoryTrace));
        await tx.run("UPDATE chat_requests SET state='done',response_json=? WHERE patient_id=? AND user_id=? AND request_id=?", JSON.stringify(response), p.id, req.user.id, rid);
        await tx.audit(req.user.id, p.id, "chat.completed");
      });
      res.json(response);
    } catch (error) {
      if (requestCreated) await store.run("UPDATE chat_requests SET state='failed' WHERE patient_id=? AND user_id=? AND request_id=? AND state='pending'", p.id, req.user.id, rid);
      throw error;
    } finally { await releaseLease(lease); }
  });
  app.post("/api/patients/:id/memories", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const text = input(req.body.text, "Memory", 4000);
    const rid = requestId(req.body.requestId);
    const existing = await store.get("SELECT * FROM memories WHERE patient_id=? AND user_id=? AND request_id=?", p.id, req.user.id, rid);
    if (existing) return res.json({ memory: toMemory(existing) });
    if (!p.memory_consent) fail(403, "The patient must enable Walrus Memory in settings before a memory can be saved.", "CONSENT_REQUIRED");
    if (!memory.configured) fail(503, "Walrus Memory is not connected yet. Configure the account and delegate key on the server.", "MEMORY_NOT_CONFIGURED");
    const id = randomUUID();
    const namespace = `vitarecall:patient:${p.id}`;
    const provenance = req.user.isDemo ? `demo-${req.user.role}-reported` : req.user.role === "clinician" ? "clinician-confirmed" : "patient-reported";
    const createdAt = now();
    // A unique database claim prevents two instances submitting the same save.
    const inserted = await store.run("INSERT INTO memories (id,patient_id,user_id,request_id,text,provenance,status,namespace,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(patient_id,user_id,request_id) DO NOTHING", id, p.id, req.user.id, rid, text, provenance, "unknown", namespace, createdAt);
    if (!Number(inserted.changes)) {
      const duplicate = await store.get("SELECT * FROM memories WHERE patient_id=? AND user_id=? AND request_id=?", p.id, req.user.id, rid);
      return res.json({ memory: toMemory(duplicate) });
    }
    try {
      const result = await memory.submit(JSON.stringify({ schema: "vitarecall.memory.v1", patientId: p.id, text, provenance, authorRole: req.user.role, recordedAt: createdAt }), namespace);
      await store.run("UPDATE memories SET status='processing',job_id=? WHERE id=?", result.jobId, id);
      await store.audit(req.user.id, p.id, "memory.submitted");
    } catch (error) {
      // A timeout may happen after upstream acceptance. Do not retry it or invent failure/proof.
      await store.run("UPDATE memories SET error=? WHERE id=?", "The submission could not be confirmed. Check the Walrus account before saving again to avoid a duplicate.", id);
      await store.audit(req.user.id, p.id, "memory.submission_uncertain");
    }
    await patientFor(req, p.id);
    res.status(202).json({ memory: toMemory(await store.get("SELECT * FROM memories WHERE id=?", id)) });
  });
  app.get("/api/patients/:id/memories/:memoryId/status", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    let row = await store.get("SELECT * FROM memories WHERE id=? AND patient_id=?", req.params.memoryId, p.id);
    if (!row) fail(404, "Memory was not found.");
    if (row.status === "processing" && row.job_id) {
      const result = await memory.receipt(row.job_id);
      if (result.status === "stored" && !result.blobId) fail(502, "Walrus did not return a blob ID. Storage is still unconfirmed.");
      if (["stored", "failed"].includes(result.status)) {
        const updated = await store.run("UPDATE memories SET status=?,blob_id=?,owner=?,error=? WHERE id=? AND status='processing'", result.status, result.blobId || null, result.owner || null, result.error || null, row.id);
        if (Number(updated.changes)) await store.audit(req.user.id, p.id, `memory.${result.status}`);
        row = await store.get("SELECT * FROM memories WHERE id=?", row.id);
      }
    }
    await patientFor(req, p.id);
    res.json({ memory: toMemory(row) });
  });
  app.post("/api/patients/:id/notes", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const text = input(req.body.text, "Note", 6000);
    const id = randomUUID(), createdAt = now();
    await store.run("INSERT INTO notes VALUES (?,?,?,?,?)", id, p.id, req.user.id, text, createdAt);
    await store.audit(req.user.id, p.id, "note.created");
    res.status(201).json({ note: { id, text, authorName: req.user.name, createdAt } });
  });
  app.post("/api/patients/:id/tasks", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    const title = input(req.body.title, "Task", 200);
    const id = randomUUID();
    await store.run("INSERT INTO tasks VALUES (?,?,?,?,?,?)", id, p.id, req.user.id, title, 0, now());
    res.status(201).json({ task: toTask(await store.get("SELECT * FROM tasks WHERE id=?", id)) });
  });
  app.patch("/api/patients/:id/tasks/:taskId", async (req, res) => {
    const p = await patientFor(req, req.params.id);
    if (typeof req.body.completed !== "boolean") fail(400, "Task completion must be true or false.");
    const task = await store.get("SELECT * FROM tasks WHERE id=? AND patient_id=?", req.params.taskId, p.id);
    if (!task) fail(404, "Task was not found.");
    await store.run("UPDATE tasks SET completed=? WHERE id=?", Number(req.body.completed), task.id);
    res.json({ task: toTask(await store.get("SELECT * FROM tasks WHERE id=?", task.id)) });
  });
  app.post("/api/services/verify", async (_req, res) => res.json({ verification: await memory.verify() }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "API route was not found." }));
  const dist = path.resolve("dist");
  if (!config.vercel && existsSync(path.join(dist, "index.html"))) {
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
