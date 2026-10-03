import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock3, Copy, Database, HeartPulse, History, Info, LoaderCircle, LockKeyhole, LogOut, MessageCircle, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Sparkles, Stethoscope, Trash2, UsersRound, X } from "lucide-react";
import { api } from "./api";
import ConversationMemory from "./ConversationMemory";
import MessageText from "./MessageText";
import { useMobileViewport } from "./useMobileViewport";
import { useConversationScroll } from "./useConversationScroll";
import { blobExplorerUrl } from "./memory-links";
import clinicianImage from "./assets/vitarecall-walrus-clinician.png";
import memoryImage from "./assets/memory-current.png";
import "./live.css";

const NAV = [
  { id: "chat", label: "Chat with Vita", icon: MessageCircle },
  { id: "memory", label: "Patient memory", icon: Database },
  { id: "plan", label: "Notes & care plan", icon: ClipboardList },
  { id: "settings", label: "Settings", icon: Settings2 },
];
const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
const displayName = user => (user?.username || user?.name || "V").replace(/^@/, "");
const initials = name => {
  const parts = (name || "V").replace(/^@/, "").split(/[\s_]+/).filter(Boolean);
  return (parts.length > 1 ? parts.map(part => part[0]).slice(0, 2).join("") : parts[0]?.slice(0, 2) || "V").toUpperCase();
};
function Brand({ light = false }) { return <div className={`brand ${light ? "light" : ""}`}><span className="brand-symbol"><HeartPulse size={22} /></span><span>Vita<span>Recall</span></span></div>; }
function Spinner() { return <LoaderCircle className="spin" size={17} aria-hidden="true" />; }
function Empty({ icon: Icon = Sparkles, title, children }) { return <div className="empty"><span className="empty-icon"><Icon size={24} /></span><h3>{title}</h3><p>{children}</p></div>; }
function Notice({ children, type = "info" }) { return <div className={`notice ${type}`} role={type === "error" ? "alert" : "status"}><Info size={17} /><span>{children}</span></div>; }
function Avatar({ user, small = false, large = false }) {
  const [failedSource, setFailedSource] = useState(null);
  const [loadedSource, setLoadedSource] = useState(null);
  const source = user?.avatarUrl;
  const name = displayName(user);
  return <span className={`avatar ${small ? "small" : large ? "large" : ""}`} role="img" aria-label={`${name}'s ${user?.username ? "X avatar" : "profile"}`}><span aria-hidden="true">{initials(name)}</span>{source && failedSource !== source && <img className={loadedSource === source ? "is-loaded" : ""} src={source} alt="" onLoad={() => setLoadedSource(source)} onError={() => setFailedSource(source)} />}</span>;
}
function VitaAvatar({ large = false }) { return <span className={large ? "large-vita walrus-avatar" : "vita-orb walrus-avatar"}><img src={clinicianImage} alt="Vita the walrus care companion" /></span>; }
function MemoryTrace({ trace }) {
  if (!trace) return null;
  const labels = { partial: `${trace.sourceCount} Walrus memories retrieved; some recall unavailable`, recalled: `${trace.sourceCount} Walrus memor${trace.sourceCount === 1 ? "y" : "ies"} retrieved`, empty: "Walrus checked · no matching memory", unavailable: "Walrus recall unavailable for this reply", "not-configured": "Walrus not configured" };
  return <div className={`memory-trace ${trace.status}`}><Database size={12} /><span>{labels[trace.status] || "Memory status unavailable"}{trace.historyUsed === false ? " · No previous chat history sent" : ""}</span></div>;
}
function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return <span className="copy-wrap"><button type="button" className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setError(false); window.setTimeout(() => setCopied(false), 2000); } catch { setError(true); } }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : label}</button>{error && <small role="status">Select the text to copy it.</small>}</span>;
}
function TelegramQuickAccess({ telegram, busy, onConnect, compact = false }) {
  const [link, setLink] = useState(null);
  if (!telegram?.configured || !telegram.canLink) return null;
  const className = `telegram-quick-access ${compact ? "compact" : ""}`;
  if (telegram.connected) return <a className={className} href={`https://t.me/${telegram.botUsername}`} target="_blank" rel="noreferrer" title="Continue your Vita conversation in Telegram"><Send size={compact ? 16 : 17} /><span>{compact ? "Telegram" : "Continue in Telegram"}</span></a>;
  if (link?.startUrl) return <a className={className} href={link.startUrl} target="_blank" rel="noreferrer" title="Open the secure one-time Telegram link"><Send size={compact ? 16 : 17} /><span>Open Telegram</span></a>;
  return <button type="button" className={className} disabled={busy.connectTelegram} onClick={async () => setLink(await onConnect())} title="Connect your private Vita workspace to Telegram">{busy.connectTelegram ? <Spinner /> : <Send size={compact ? 16 : 17} />}<span>{compact ? "Telegram" : "Chat on Telegram"}</span></button>;
}
function TelegramSettings({ telegram, busy, onConnect, onDisconnect, onActivate }) {
  const [link, setLink] = useState(null);
  if (!telegram?.canLink) return null;
  const configured = Boolean(telegram.configured);
  return <section className="panel pad telegram-panel">
    <div className="title-with-icon"><span className="small-icon"><Send size={21} /></span><div><h2>Telegram</h2><p className="muted small-text">Continue your private Vita chat from Telegram.</p></div></div>
    {!configured ? <Notice>Telegram is not connected to this deployment yet. Add the three server-only Telegram values, then refresh this page.</Notice> : <>
      <div className="service-row"><span className="small-icon"><MessageCircle size={20} /></span><div><strong>@{telegram.botUsername}</strong><p>{telegram.connected ? `Linked ${date(telegram.linkedAt)}` : "Not linked to a Telegram account"}</p></div><span className={`soft-pill ${telegram.connected ? "" : "amber"}`}>{telegram.connected ? "Connected" : "Not linked"}</span></div>
      {!telegram.connected && !link && <button className="button primary" disabled={busy.connectTelegram} onClick={async () => setLink(await onConnect())}>{busy.connectTelegram ? <Spinner /> : <Send size={16} />}Connect Telegram</button>}
      {link && <div className="telegram-link"><strong>Finish in Telegram</strong><p>Open this one-time link before {date(link.expiresAt)}. It connects only the Telegram account you use there.</p><a className="button secondary" href={link.startUrl} target="_blank" rel="noreferrer"><Send size={16} />Open @{link.botUsername}</a><CopyButton value={link.startUrl} label="Copy secure link" /><p className="small-text muted">After you press Start in Telegram, send a message. It will appear in this same Vita chat history and follows your automatic Walrus-memory choice.</p></div>}
      {telegram.connected && <button className="text-button danger-text" disabled={busy.disconnectTelegram} onClick={onDisconnect}>{busy.disconnectTelegram ? <Spinner /> : <LogOut size={15} />}Disconnect Telegram</button>}
      <div className="telegram-activate"><p className="small-text muted">First-time bot setup: after the server variables are saved, activate the secure webhook once. This never exposes the bot token to the browser.</p><button className="text-button" disabled={busy.activateTelegram} onClick={onActivate}>{busy.activateTelegram ? <Spinner /> : <RefreshCw size={14} />}Activate Telegram bot</button></div>
    </>}
    <p className="small-text muted">Fictional data only. Telegram has its own privacy policies; do not send real health information, prescriptions, secrets, or emergency requests here.</p>
  </section>;
}

function TelegramLoginButton({ botUsername, onSession }) {
  const target = useRef(null);
  const onSessionRef = useRef(onSession);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onSessionRef.current = onSession; }, [onSession]);
  useEffect(() => {
    if (!botUsername || !target.current) return undefined;
    let active = true;
    const callbackName = "vitaTelegramLogin";
    const previous = window[callbackName];
    const authenticate = async data => {
      if (!active) return;
      setBusy(true); setError("");
      try { onSessionRef.current(await api("/auth/telegram", { method: "POST", body: data })); }
      catch (reason) { if (active) setError(reason.message); }
      finally { if (active) setBusy(false); }
    };
    window[callbackName] = authenticate;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = "large";
    script.dataset.radius = "12";
    script.dataset.onauth = `${callbackName}(user)`;
    target.current.replaceChildren(script);
    return () => {
      active = false;
      script.remove();
      if (window[callbackName] === authenticate) {
        if (previous) window[callbackName] = previous;
        else delete window[callbackName];
      }
    };
  }, [botUsername]);
  return <div className="telegram-login-control"><div ref={target} aria-label="Continue with Telegram" />{busy && <p className="small-text muted"><Spinner />Signing in securely…</p>}{error && <Notice type="error">{error}</Notice>}</div>;
}

function Auth({ onSession, signedOutName = "", services = {} }) {
  const [mode, setMode] = useState("demo");
  const [emailMode, setEmailMode] = useState("login");
  const [role, setRole] = useState("patient");
  const [automaticMemory, setAutomaticMemory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const email = mode === "email";
  const register = email && emailMode === "register";
  const telegramLogin = Boolean(services.telegramLoginConfigured && services.telegramBotUsername);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const endpoint = email ? `/auth/${register ? "register" : "login"}` : mode === "restore" ? "/auth/demo/restore" : "/auth/demo";
    try { onSession(await api(endpoint, { method: "POST", body: { ...values, role, ...((mode === "demo" || register) ? { automaticMemory } : {}) } })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story"><Brand light /><div className="auth-heading"><span className="eyebrow"><Sparkles size={14} /> CARE THAT REMEMBERS</span><h1>Your story.<br />Better connected.</h1><p>A calmer space to prepare for care, keep track of what matters, and pick up where you left off.</p></div><div className="auth-art"><img src={clinicianImage} alt="A friendly illustrated walrus clinician holding a tablet" /><div className="art-note"><ShieldCheck size={22} /><span><strong>A little continuity goes a long way.</strong><small>Patient-led memory. Clear sources.</small></span></div></div><p className="auth-footer">Made for patients. Connected with their care team.</p></section>
    <section className="auth-form-section"><div className="mobile-brand"><Brand /></div><div className="auth-form-card"><VitaAvatar large /><p className="eyebrow">A CHATBOT THAT REMEMBERS</p><h2>{email ? register ? "Let's get to know you." : "Welcome back." : mode === "restore" ? "Pick up your story." : "Meet your walrus doc."}</h2><p className="muted">{email ? "Your existing email account still works here." : mode === "restore" ? "Use your private recovery code to reopen the same memory workspace, even on another device." : "Sign in with Telegram to reopen the same private workspace on any browser or device."}</p>{telegramLogin && <section className="telegram-login-card"><div><strong>Continue with Telegram</strong><p>Telegram securely confirms your account. Vita uses its unique Telegram ID, not an editable username, to find your existing chats and Walrus memories.</p></div><TelegramLoginButton botUsername={services.telegramBotUsername} onSession={onSession} /></section>}<div className="auth-tabs"><button type="button" className={mode === "demo" ? "selected" : ""} onClick={() => { setMode("demo"); setError(""); }}>Try the demo</button><button type="button" className={mode === "restore" ? "selected" : ""} onClick={() => { setMode("restore"); setError(""); }}>Restore demo</button><button type="button" className={email ? "selected" : ""} onClick={() => { setMode("email"); setError(""); }}>Email account</button></div>
      {email && <div className="email-mode"><button className={`text-button ${!register ? "selected" : ""}`} onClick={() => setEmailMode("login")}>Sign in</button><button className={`text-button ${register ? "selected" : ""}`} onClick={() => setEmailMode("register")}>Create account</button></div>}
      {signedOutName && <Notice>Signed out of <strong>{signedOutName}</strong>. Sign in with the same Telegram account to return to its protected workspace, or enter another username for a separate demo.</Notice>}
      <form onSubmit={submit} className="form-stack">
        {!email && <label>X / Twitter username<input name="username" aria-label="X / Twitter username" aria-describedby="username-help" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={Boolean(signedOutName)} maxLength={16} pattern="@?[A-Za-z0-9_]{1,15}" required placeholder="yourusername" /><small id="username-help">For a separate fictional demo only — this is not X sign-in and cannot reopen an existing workspace. Public avatars come from unavatar.io; initials appear if a photo is unavailable.</small></label>}
        {mode === "restore" && <label>Private recovery code<input name="recoveryCode" type="password" autoComplete="off" required maxLength={200} placeholder="The code saved when you joined" /></label>}
        {register && <label>Your name<input name="name" autoComplete="name" minLength={2} maxLength={80} required placeholder="e.g. Ada Okafor" /></label>}
        {(register || mode === "demo") && <fieldset className="role-options"><legend>{email ? "I’m joining as a" : "Explore the demo as a"}</legend>{["patient", "clinician"].map(value => <label key={value}><input type="radio" name="accountRole" checked={role === value} onChange={() => setRole(value)} /><span>{value === "patient" ? <HeartPulse size={17} /> : <Stethoscope size={17} />}{value === "patient" ? "Patient" : "Clinician"}</span></label>)}</fieldset>}
        {mode === "demo" && role === "clinician" && <p className="small-text muted">No invitation needed for this demo. You get a fictional patient workspace; this does not grant clinical credentials or access to other patients.</p>}
        {email && <><label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" /></label><label>Password<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 12 : 1} maxLength={128} required placeholder={register ? "At least 12 characters" : "Your password"} /></label></>}
        {register && role === "clinician" && <label>Clinic invitation code<input name="inviteCode" type="password" required autoComplete="off" aria-label="Clinic invitation code" aria-describedby="invite-help" /><small id="invite-help">Your workspace administrator provides this code.</small></label>}
        {(mode === "demo" || (register && role === "patient")) && <section className="signup-memory" aria-label="Default chat memory"><label><input type="checkbox" checked={automaticMemory} onChange={e => setAutomaticMemory(e.target.checked)} aria-describedby="signup-memory-disclosure" />Save chats to Walrus automatically</label><p id="signup-memory-disclosure">On by default for this fictional-data demo. Your messages and Vita replies go to the Walrus relayer, which processes text before encryption; recalled text goes to Gemini. Uncheck now or turn it off later in Memory or Settings. Turning it off does not delete existing blobs. Never enter real health information or secrets.</p></section>}
        {error && <Notice type="error">{error}</Notice>}
        <button className="button primary full" disabled={busy}>{busy ? <Spinner /> : <ArrowRight size={18} />}{busy ? "Please wait…" : email ? register ? "Create my account" : "Sign in to VitaRecall" : mode === "restore" ? "Restore my workspace" : "Start chatting with Vita"}</button>
      </form><div className="pilot-note"><ShieldCheck size={16} /><p>Hackathon pilot · Fictional patient information only. Vita is an AI companion, not a doctor. <a href="https://unavatar.io" target="_blank" rel="noreferrer">Avatars by Unavatar</a>.</p></div></div></section>
  </main>;
}

function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [patients, setPatients] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [tab, setTab] = useState("chat");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});
  const [chatDraft, setChatDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [recallQuery, setRecallQuery] = useState("");
  const [recallResults, setRecallResults] = useState(null);
  const [verification, setVerification] = useState(null);
  const [showLink, setShowLink] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [signedOutName, setSignedOutName] = useState("");
  const scope = useRef("");
  const generation = useRef(0);
  const pendingChat = useRef(null);
  const pendingMemory = useRef(null);
  const chatScroll = useConversationScroll({ scopeKey: selectedId, active: tab === "chat", lastMessageId: workspace?.messages.at(-1)?.id, waiting: Boolean(busy.chat) });
  const user = session?.user;
  const keyboardOpen = useMobileViewport(Boolean(user) && tab === "chat");
  const patient = workspace?.patient;
  const services = workspace?.services || session?.services || {};
  const isPatient = user?.role === "patient";
  const canConsent = isPatient || Boolean(user?.isDemo && patient?.canManageConsent);
  const base = `/patients/${selectedId}`;

  function acceptSession(next) { if (next.user) setSignedOutName(""); setRecoveryCode(next.recoveryCode || ""); setSession(next); }

  async function boot() {
    setBooting(true); setError("");
    try { setSession(await api("/session")); } catch (e) { setError(e.message); }
    finally { setBooting(false); }
  }
  useEffect(() => { boot(); }, []);
  useEffect(() => {
    const current = ++generation.current;
    setPatients([]); setSelectedId(""); setWorkspace(null); setTab("chat"); setError(""); setNotice("");
    setChatDraft(""); setMemoryDraft(""); setRecallResults(null); setVerification(null); setBusy({}); setShowLink(false);
    if (!user) return;
    setLoading(true);
    api("/patients").then(data => { if (current !== generation.current) return; setPatients(data.patients); setSelectedId(data.patients[0]?.id || ""); }).catch(e => { if (current === generation.current) setError(e.message); }).finally(() => { if (current === generation.current) setLoading(false); });
  }, [user?.id]);
  useEffect(() => {
    scope.current = selectedId;
    setWorkspace(null); setChatDraft(""); setMemoryDraft(""); setRecallResults(null); setRecallQuery(""); pendingChat.current = null; pendingMemory.current = null;
    setBusy(b => ({ ...b, chat: false }));
    if (!selectedId) return;
    let active = true;
    setLoading(true);
    api(`/patients/${selectedId}/workspace`).then(data => { if (active) setWorkspace(data); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedId]);
  async function perform(key, action) {
    const currentGeneration = generation.current;
    setBusy(b => ({ ...b, [key]: true })); setError(""); setNotice("");
    try { await action(); }
    catch (e) { if (generation.current === currentGeneration) { setError(e.message); if (e.status === 401) await boot(); } }
    finally { if (generation.current === currentGeneration) setBusy(b => ({ ...b, [key]: false })); }
  }
  function updatePatient(p) { setWorkspace(w => w && w.patient.id === p.id ? { ...w, patient: p } : w); setPatients(items => items.map(item => item.id === p.id ? p : item)); }
  function updateMemory(memory, patientId = selectedId) {
    setWorkspace(w => {
      if (!w || w.patient.id !== patientId || patientId !== scope.current) return w;
      const memories = w.memories.some(m => m.id === memory.id) ? w.memories.map(m => m.id === memory.id ? memory : m) : [memory, ...w.memories];
      return { ...w, memories, stats: { ...w.stats, storedBlobs: new Set(memories.filter(m => m.status === "stored").map(m => m.blobId)).size } };
    });
  }
  const processing = workspace?.memories.filter(m => m.status === "processing").map(m => m.id).join(",") || "";
  useEffect(() => {
    if (!processing || !selectedId) return;
    let active = true, attempts = 0, timer;
    async function poll() {
      for (const id of processing.split(",")) {
        if (!active) break;
        try { const data = await api(`/patients/${selectedId}/memories/${id}/status`); if (active && scope.current === selectedId) updateMemory(data.memory); }
        catch { /* A transient error never changes a pending receipt into a success. */ }
      }
      if (active && ++attempts < 20) timer = window.setTimeout(poll, 5000);
      else if (active) setNotice("Storage is taking longer than usual. Use Refresh receipt to check again later.");
    }
    timer = window.setTimeout(poll, 1500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [processing, selectedId]);

  function updateConversationMemory(value, id = selectedId) {
    setWorkspace(w => w && w.patient.id === id && scope.current === id ? { ...w, conversationMemory: value } : w);
  }
  async function syncConversationMemory() {
    const id = selectedId;
    await perform("conversationMemory", async () => {
      const data = await api(`/patients/${id}/conversation-memory/sync`, { method: "POST", body: {} });
      updateConversationMemory(data.conversationMemory, id);
    });
  }
  async function changeAutomaticMemory(enabled) {
    const id = selectedId;
    await perform("conversationMemory", async () => {
      const data = await api(`/patients/${id}/conversation-memory/consent`, { method: "PATCH", body: { enabled } });
      updateConversationMemory(data.conversationMemory, id);
    });
  }
  async function archiveEarlierChats() {
    const id = selectedId;
    await perform("conversationMemory", async () => {
      const data = await api(`/patients/${id}/conversation-memory/backfill`, { method: "POST", body: {} });
      updateConversationMemory(data.conversationMemory, id);
      setNotice(data.remaining ? "Earlier exchanges queued. Select Also save earlier chats again to include the next batch." : "Earlier exchanges are queued or already archived. Wait for confirmed blob receipts.");
    });
  }
  const archivePending = (workspace?.conversationMemory?.counts.queued || 0) + (workspace?.conversationMemory?.counts.processing || 0);
  useEffect(() => {
    if (!archivePending || !selectedId || !services.memoryConfigured || !patient?.canManageConsent) return;
    let active = true, attempts = 0, timer;
    const id = selectedId;
    async function pollArchive() {
      try {
        const data = await api(`/patients/${id}/conversation-memory/sync`, { method: "POST", body: {} });
        if (active) updateConversationMemory(data.conversationMemory, id);
      } catch { /* Preserve pending state. Never present an error as successful storage. */ }
      // Keep checking automatically, with a slower cadence for long-running
      // jobs. No per-message save or manual refresh is required.
      if (active) timer = window.setTimeout(pollArchive, ++attempts < 20 ? 6000 : 30000);
    }
    timer = window.setTimeout(pollArchive, 1000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [archivePending, selectedId, services.memoryConfigured, patient?.canManageConsent]);
  const automaticMemoryPanel = receipts => <ConversationMemory state={workspace?.conversationMemory} canManage={patient?.canManageConsent} configured={services.memoryConfigured} busy={busy.conversationMemory} onChange={changeAutomaticMemory} onSync={syncConversationMemory} onBackfill={archiveEarlierChats} receipts={receipts} />;
  async function connectTelegram() {
    const id = selectedId;
    let link;
    await perform("connectTelegram", async () => { link = await api(`/patients/${id}/telegram/link`, { method: "POST", body: {} }); });
    return link;
  }
  async function disconnectTelegram() {
    const id = selectedId;
    await perform("disconnectTelegram", async () => {
      const data = await api(`/patients/${id}/telegram`, { method: "DELETE", body: {} });
      if (scope.current === id) setWorkspace(w => ({ ...w, telegram: data.telegram }));
      setNotice("Telegram was disconnected. Existing chats and Walrus memories were not deleted.");
    });
  }
  async function activateTelegram() {
    await perform("activateTelegram", async () => {
      const data = await api("/services/telegram/webhook", { method: "POST", body: {} });
      setNotice(`@${data.botUsername} is ready to receive secure Vita messages.`);
    });
  }

  async function sendChat(event) {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text || pendingChat.current || busy.chat || busy.newConversation || !services.chatConfigured) return;
    const requestId = crypto.randomUUID();
    const message = { id: `pending-${requestId}`, requestId, role: "user", text, createdAt: new Date().toISOString(), delivery: "pending" };
    // This bubble is local pending UI, not a storage or delivery receipt.
    chatScroll.followNextMessage();
    setWorkspace(w => w && w.patient.id === selectedId ? { ...w, messages: [...w.messages, message] } : w);
    setChatDraft("");
    await deliverChat(message);
  }
  async function deliverChat(message) {
    if (pendingChat.current || busy.newConversation || !services.chatConfigured) return;
    const attempt = { requestId: message.requestId, patientId: selectedId, generation: generation.current };
    pendingChat.current = attempt; // Synchronous guard against double taps.
    const current = () => pendingChat.current === attempt && scope.current === attempt.patientId && generation.current === attempt.generation;
    setBusy(b => ({ ...b, chat: true })); setError(""); setNotice("");
    setWorkspace(w => w && w.patient.id === attempt.patientId ? { ...w, messages: w.messages.map(m => m.id === message.id ? { ...m, delivery: "pending", deliveryError: "" } : m) } : w);
    try {
      const result = await api(`/patients/${attempt.patientId}/chat`, { method: "POST", body: { message: message.text, requestId: attempt.requestId } });
      if (!current()) return;
      setWorkspace(w => {
        if (!w || w.patient.id !== attempt.patientId) return w;
        const resultIds = [result.userMessage.id, result.assistantMessage.id];
        const hadPending = w.messages.some(m => m.id === message.id);
        const messages = w.messages.flatMap(m => m.id === message.id ? [result.userMessage, result.assistantMessage] : resultIds.includes(m.id) ? [] : [m]);
        if (!hadPending) messages.push(result.userMessage, result.assistantMessage);
        // An older failed bubble may be retried after a later exchange. Match
        // the server's actual chronology, including cached lost responses.
        messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return { ...w, ...(result.conversationMemory ? { conversationMemory: result.conversationMemory } : {}), messages };
      });
      // Do not clear a new draft the user typed while waiting for this reply.
    } catch (e) {
      if (!current()) return;
      setWorkspace(w => w && w.patient.id === attempt.patientId ? { ...w, messages: w.messages.map(m => m.id === message.id ? { ...m, delivery: "failed", deliveryError: e.message } : m) } : w);
      // Retrying retains the original request ID, even after a lost response.
      // The server can return the existing exchange without duplicating it.
      if (e.status === 401) await boot();
    } finally {
      if (pendingChat.current === attempt) {
        pendingChat.current = null;
        if (scope.current === attempt.patientId && generation.current === attempt.generation) setBusy(b => ({ ...b, chat: false }));
      }
    }
  }
  async function saveMemory(event) {
    event.preventDefault(); const text = memoryDraft.trim(), id = selectedId;
    if (!text || busy.memory) return;
    if (pendingMemory.current?.text !== text) pendingMemory.current = { text, requestId: crypto.randomUUID() };
    await perform("memory", async () => {
      try {
        const result = await api(`${base}/memories`, { method: "POST", body: { text, requestId: pendingMemory.current.requestId } });
        if (scope.current === id) { updateMemory(result.memory); setMemoryDraft(""); setNotice(result.memory.status === "unknown" ? "Submission is unconfirmed. Check the account before saving again." : "Memory submitted. Its receipt will update when Walrus confirms storage."); }
        pendingMemory.current = null;
      } catch (e) { if (e.status) pendingMemory.current = null; throw e; }
    });
  }
  async function logout() {
    if (Object.values(busy).some(Boolean)) return;
    await perform("logout", async () => { const result = await api("/auth/logout", { method: "POST", body: {} }); scope.current = ""; setSignedOutName(user.isDemo ? displayName(user) : ""); acceptSession(result); });
  }
  async function refreshConnections() {
    await perform("refreshConnections", async () => {
      const nextSession = await api("/session");
      setSession(nextSession);
      if (selectedId) { const id = selectedId; const nextWorkspace = await api(`${base}/workspace`); if (scope.current === id) setWorkspace(nextWorkspace); }
      setNotice("Connection settings refreshed. A configured key still needs a successful live call to prove it works.");
    });
  }
  async function newConversation() {
    await perform("newConversation", async () => {
      const id = selectedId;
      await api(`${base}/conversation/reset`, { method: "POST", body: {} });
      if (scope.current === id) { setWorkspace(w => w && ({ ...w, messages: [] })); setChatDraft(""); pendingChat.current = null; setNotice("Fresh conversation started. Earlier local chat messages will not be sent to Gemini. Confirmed Walrus memories can still be recalled; pending saves are kept in the queue."); }
    });
  }

  if (booting) return <div className="boot"><Brand /><Spinner /><p>Opening your care workspace…</p></div>;
  if (!session) return <div className="boot"><Brand /><Notice type="error">{error || "The server is unavailable."}</Notice><button className="button primary" onClick={boot}>Try again</button></div>;
  if (!user) return <Auth onSession={acceptSession} signedOutName={signedOutName} services={services} />;

  const stored = (workspace?.stats.storedBlobs || 0) + (workspace?.conversationMemory?.counts.stored || 0);
  const completed = workspace?.tasks.filter(task => task.completed).length || 0;
  function changeTab(value) { setTab(value); setError(""); setNotice(""); }
  const archiveAttention = (workspace?.conversationMemory?.counts.unknown || 0) + (workspace?.conversationMemory?.counts.failed || 0);
  const mobileMemoryStatus = archiveAttention ? "Check saves" : archivePending ? `${archivePending} pending` : `${stored} saved / auto ${workspace?.conversationMemory?.enabled ? "on" : "off"}`;
  return <div className={`app-shell ${tab === "chat" ? "chat-view" : ""} ${tab === "chat" && workspace && !recoveryCode && services.chatConfigured ? "compact-chat" : ""} ${keyboardOpen ? "keyboard-open" : ""}`}>
    <aside className="sidebar"><Brand light /><div className="workspace-label"><span className="workspace-symbol">{isPatient ? <HeartPulse size={19} /> : <Stethoscope size={19} />}</span><span><strong>{isPatient ? "My care space" : user.isDemo ? "Clinician demo" : "Clinical workspace"}</strong><small>{user.isDemo ? "Walrus Memory demo" : isPatient ? "Patient portal" : "Care team"}</small></span></div><span className="nav-title">WORKSPACE</span><nav aria-label="Primary navigation">{NAV.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => changeTab(id)}><Icon size={19} /><span>{label}</span>{id === "memory" && stored > 0 && <b>{stored}</b>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-tip"><ShieldCheck size={23} /><h3>You stay in control.</h3><p>Choose what to remember and who can access your care space.</p><button onClick={() => changeTab("settings")}>Memory & privacy <ArrowRight size={14} /></button></div><div className="profile"><Avatar user={user} /><span><strong>{displayName(user)}</strong><small>{user.isDemo ? `${isPatient ? "Patient" : "Clinician"} demo · unverified` : user.authProvider === "telegram" ? "Telegram-secured patient account" : isPatient ? "Patient account" : "Invited clinician"}</small></span></div></div></aside>
    <main className="main-workspace"><header className="topbar"><div className="mobile-brand"><Brand /></div><div className="breadcrumbs"><span>{isPatient ? "My care space" : user.isDemo ? "Clinician demo" : "Care team"}</span><ChevronRight size={14} /><strong>{NAV.find(n => n.id === tab).label}</strong></div><div className="top-actions"><span className="pilot-tag">Synthetic-data pilot</span><Avatar user={user} small /><button className="button secondary sign-out-button" title={user.isDemo ? "Sign out to use another username" : "Sign out"} onClick={logout} disabled={Object.values(busy).some(Boolean)}>{busy.logout ? <Spinner /> : <LogOut size={16} />}<span>{busy.logout ? "Signing out..." : "Sign out"}</span></button></div></header>
      <div className="page-content">
        {recoveryCode && <section className="recovery-banner" aria-label="Save your recovery code"><LockKeyhole size={22} /><div><h2>Save your private recovery code</h2><p>Your username alone cannot reopen this workspace. Keep this code to restore the same memories on another browser or device. Anyone with it can access your demo.</p><div className="recovery-code"><code>{recoveryCode}</code><CopyButton value={recoveryCode} label="Copy recovery code" /></div><small>Shown once. It is not stored in browser local storage or sent to Walrus.</small></div><button className="button secondary" onClick={() => setRecoveryCode("")}>I've saved my code</button></section>}
        {!services.memoryConfigured || !services.chatConfigured ? <div className="setup-banner"><span className="setup-icon"><Settings2 size={19} /></span><div><strong>One more step to connect Vita</strong><p>{!services.chatConfigured && "Gemini needs its server API key. "}{!services.memoryConfigured && "Walrus needs your mainnet account and delegate key. "}Your account, notes, and care plan already work.</p></div><button className="text-button" onClick={() => changeTab("settings")}>Setup details <ArrowRight size={15} /></button></div> : null}
        <section className="page-heading"><div><p className="eyebrow">{user.isDemo ? "CARE WITH CONTINUITY · WALRUS MEMORY DEMO" : isPatient ? "A LITTLE MORE CONTINUITY" : "CLINICAL MEMORY, WITH PROVENANCE"}</p><div className="greeting-line">{tab === "chat" && <Avatar key={user.id} user={user} large />}<h1>{tab === "chat" ? `Hello, ${displayName(user).split(" ")[0]}.` : NAV.find(n => n.id === tab).label}</h1></div><p>{tab === "chat" ? "Make room for a conversation that remembers." : tab === "memory" ? "Your context, with a source and a storage receipt." : tab === "plan" ? "Keep the next step close. Pick up where you left off." : "Control your connections, memory, and care team."}</p></div>{!isPatient && !user.isDemo && <button className="button secondary" onClick={() => setShowLink(true)}><Plus size={17} />Link a patient</button>}</section>
        {!isPatient && patients.length > 0 && <label className="patient-picker"><UsersRound size={17} /><span>Patient workspace</span><select aria-label="Patient workspace" value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={busy.chat || busy.memory}>{patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={15} /></label>}
        {error && <Notice type="error">{error}</Notice>}{notice && <Notice>{notice}</Notice>}
        {loading ? <div className="loading-panel"><Spinner /> Loading workspace…</div> : !patient && tab !== "settings" ? <div className="panel no-patient"><Empty icon={UsersRound} title={isPatient ? "Unable to load your workspace" : "Start with a patient connection"}>{isPatient ? "Refresh the page to try again." : "Ask a patient to share their care code, then link their workspace. Only linked patients appear here."}</Empty>{!isPatient && <button className="button primary" onClick={() => setShowLink(true)}><Plus size={17} />Link a patient</button>}</div> : <>
          {tab === "chat" && patient && <>
            <section className="welcome-card"><div><span className="eyebrow"><Sparkles size={13} /> MEET YOUR CARE COMPANION</span><h2>A familiar place<br />to talk things through.</h2><p>Prepare for appointments, find saved context, and keep the details that matter close.</p><div className="welcome-actions"><a className="welcome-cta" href="#chat-input" onClick={() => document.getElementById("chat-input")?.focus()}>Let’s talk <ArrowRight size={17} /></a><TelegramQuickAccess telegram={workspace.telegram} busy={busy} onConnect={connectTelegram} /></div></div><img src={clinicianImage} alt="Vita, an illustrated walrus care companion" /><div className="welcome-mini"><ShieldCheck size={16} /><span>Memory you can review.</span></div></section>
            <div className="chat-grid"><section className="panel chat-panel" aria-label="Chat with Vita">
              <div className="panel-heading"><div className="title-with-icon"><VitaAvatar /><div><h2>Chat with Vita</h2><p>Your walrus care companion · AI, not a doctor</p></div></div><div className="chat-panel-actions"><TelegramQuickAccess telegram={workspace.telegram} busy={busy} onConnect={connectTelegram} compact /><span className={services.chatConfigured ? "connection-tag" : "connection-tag pending"}><i />{services.chatConfigured ? "Gemini configured" : "Setup needed"}</span></div></div>
              <div className="conversation-toolbar"><button className="mobile-memory-summary" aria-label="Open memory settings" onClick={() => changeTab("memory")}><Database size={15} /><span><strong>Walrus memory</strong><small aria-live="polite">{services.memoryConfigured ? mobileMemoryStatus : "Setup needed"}</small></span><ChevronRight size={14} /></button><span className="desktop-memory-label"><Database size={13} />Walrus memory, with receipts</span><button className="text-button" aria-label="New conversation" onClick={newConversation} disabled={busy.chat || busy.newConversation || !workspace.messages.length}>{busy.newConversation ? <Spinner /> : <Plus size={14} />}<span className="desktop-label">New conversation</span><span className="mobile-label">New chat</span></button></div>
              {!services.chatConfigured && <div className="chat-setup"><strong>Vita needs its Gemini key before it can reply.</strong><p>Get a key from <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a>, add it as <code>GEMINI_API_KEY</code> in the server's <code>.env</code>, then restart the server. Your Walrus account ID is a different setting.</p><button className="text-button" onClick={refreshConnections} disabled={busy.refreshConnections}><RefreshCw size={13} />Refresh connection status</button></div>}
              <div className="conversation" ref={chatScroll.conversationRef} onScroll={chatScroll.onScroll} role="log" aria-live="polite" aria-label="Conversation messages">
                {workspace.messages.length === 0 ? <div className="chat-empty"><VitaAvatar large /><span className="intro-label">A welcome from Vita · not an AI reply</span><h3>Hi, I'm Vita. I'm here to listen.</h3><p>{isPatient ? "What would you like me to call you, and what brings you here today? We can take it one step at a time." : "Which fictional patient are we discussing, and what would you like help preparing? We can take it one step at a time."}</p><div className="suggestions">{["You can call me Ada. I'm a little nervous about my next appointment.", "What do you remember about my care preferences?", "Help me explain a concern to my care team"].map((text, index) => <button key={text} aria-label={text} onClick={() => { setChatDraft(text); document.getElementById("chat-input")?.focus(); }}><span className="desktop-label">{text}</span><span className="mobile-label">{["Talk about a concern", "Recall my preferences", "Prepare for a visit"][index]}</span><ArrowRight size={14} /></button>)}</div></div> : workspace.messages.map(message => <article className={"chat-message " + message.role} key={message.id}>
                  <div className="message-byline">{message.role === "assistant" ? <><VitaAvatar /> Vita</> : <><Avatar user={user} small />You</>}<time>{date(message.createdAt)}</time></div>
                  {message.role === "assistant" ? <MessageText text={message.text} /> : <div className="message-text">{message.text}</div>}
                  {message.delivery === "pending" && <small className="message-delivery" role="status">Waiting for Vita’s reply…</small>}
                  {message.delivery === "failed" && <div className="message-delivery failed" role="alert"><strong>Reply not confirmed.</strong><p>{message.deliveryError}</p><button type="button" className="text-button" disabled={busy.chat || busy.newConversation} onClick={() => { chatScroll.followNextMessage(); deliverChat(message); }}><RefreshCw size={13} />Retry message</button><CopyButton value={message.text} label="Copy message" /></div>}
                  {message.role === "assistant" && <MemoryTrace trace={message.memoryTrace} />}
                  {message.sources?.length > 0 && <details className="message-sources"><summary><BookIcon />{message.sources.length} retrieved memory source{message.sources.length === 1 ? "" : "s"}</summary><p>Retrieved from Walrus and supplied as context. Retrieval alone does not mean every source was used; citation numbers in the reply identify cited sources.</p>{message.sources.map((source, index) => <div key={source.blobId + "-" + index}><strong>[{index + 1}] Saved context</strong><p>{source.text}</p><code>{source.blobId}</code><a className="text-button" href={blobExplorerUrl(source.blobId)} target="_blank" rel="noreferrer">View source on Walrus Scan</a></div>)}</details>}
                </article>)}
                {busy.chat && <div className="thinking" role="status"><VitaAvatar /><Spinner />Vita is checking saved context and preparing your reply…</div>}
              </div>
              {chatScroll.hasNewMessages && <button type="button" className="new-messages-button" onClick={chatScroll.jumpToLatest}>New reply · Jump to latest <ChevronDown size={15} /></button>}
              <form className="chat-composer" onSubmit={sendChat}><label className="sr-only" htmlFor="chat-input">Message Vita</label><textarea id="chat-input" value={chatDraft} onChange={e => setChatDraft(e.target.value)} placeholder={busy.chat ? "You can draft your next message…" : "Tell Vita what's on your mind…"} maxLength={4000} rows={2} disabled={busy.newConversation} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} /><button className="send-button" aria-label="Send message" disabled={!chatDraft.trim() || busy.chat || busy.newConversation || !services.chatConfigured}>{busy.chat ? <Spinner /> : <Send size={19} />}</button></form><p className="mobile-chat-safety">AI support, not a doctor. Fictional data only.<br />For emergencies, contact local emergency services.</p><p className="composer-footnote"><LockKeyhole size={12} /> {workspace.conversationMemory?.enabled ? "Automatic memory is on. Check confirmed chat receipts in Patient memory." : "Automatic memory is off. Enable it in the memory panel to remember future conversations."}</p>
            </section><aside className="context-column">{automaticMemoryPanel(false)}<div className="panel context-card"><div className="context-icon"><Database size={20} /></div><p className="eyebrow">SEE MEMORY MAKE A DIFFERENCE</p><h3>{stored === 0 ? "Your memory starts here." : stored + " confirmed " + (stored === 1 ? "memory." : "memories.")}</h3><p>Chat history and Walrus memory are different. Try a fresh conversation to see what survives.</p><ol className="memory-steps"><li>Automatic chat memory is on for new profiles. You can pause it anytime.</li><li>Chat normally. Your messages and Vita replies are archived automatically.</li><li>Wait for a confirmed blob ID.</li><li>Start a <strong>New conversation</strong> and ask what Vita remembers.</li></ol><div className="mini-stat"><span>Automatic chat memory</span><strong>{workspace.conversationMemory?.enabled ? "On" : "Off"}</strong></div><div className="mini-stat"><span>Confirmed blobs · this patient</span><strong>{stored}</strong></div><button className="button secondary full" onClick={() => changeTab("memory")}>Open patient memory <ArrowRight size={16} /></button></div><div className="care-tip"><HeartPulse size={19} /><h3>Warm support. Honest limits.</h3><p>Vita helps you feel heard and prepare for care. It cannot diagnose, prescribe, or replace a qualified clinician.</p></div><div className="urgent-note">If you may be experiencing a medical emergency, contact local emergency services or seek urgent care.</div></aside></div>
          </>}
          {tab === "memory" && patient && <>{automaticMemoryPanel(true)}<div className="memory-overview"><div><span className="eyebrow">VERIFIABLE CONTINUITY</span><h2>Remember what matters.</h2><p>{stored} confirmed unique blob{stored === 1 ? "" : "s"} tracked for this patient in this app.</p><span className="soft-pill"><Database size={13} />Walrus mainnet · {services.memoryConfigured ? "Configured" : "Not connected"}</span></div><img src={memoryImage} alt="Abstract translucent layers representing connected memories" /></div><div className="memory-grid"><section className="panel pad"><div className="section-title"><h2>Review a new memory</h2><span className="soft-pill">{user.isDemo ? "Fictional demo · self-reported" : isPatient ? "Patient-reported" : "Clinician-confirmed"}</span></div><p className="muted small-text">{user.isDemo || isPatient ? "Review and edit the detail you want to bring into future conversations. Saving does not verify a medical fact." : "Confirm only information you have reviewed. Your save records it as clinician-confirmed."}</p>{!patient.memoryConsent && <Notice>Reviewed note saves need separate consent. The Walrus relayer processes text before encryption; recalled text goes to Gemini during chat. {canConsent && <button className="inline-link" disabled={busy.consent} onClick={() => perform("consent", async () => { const data = await api(`${base}/consent`, { method: "PATCH", body: { enabled: true } }); updatePatient(data.patient); })}>Allow reviewed memory saves</button>}</Notice>}<form className="form-stack" onSubmit={saveMemory}><label>Memory to save<textarea aria-label="Memory to save" rows={5} maxLength={4000} required value={memoryDraft} onChange={e => setMemoryDraft(e.target.value)} placeholder="e.g. I prefer short, plain-language appointment summaries." /></label><small>Walrus’s relayer receives this text before encrypting it. Save fictional data only during this pilot.</small><button className="button primary" disabled={!memoryDraft.trim() || !patient.memoryConsent || !services.memoryConfigured || busy.memory}>{busy.memory ? <Spinner /> : <ShieldCheck size={17} />}{isPatient || user.isDemo ? "Save reviewed memory" : "Confirm & save memory"}</button></form></section><section className="panel pad"><h2>Recall from Walrus</h2><p className="muted small-text">Search the patient’s memory namespace. The returned context comes from Walrus Memory.</p><form className="search-form" onSubmit={e => { e.preventDefault(); perform("recall", async () => { const id = selectedId; const data = await api(`${base}/recall`, { method: "POST", body: { query: recallQuery } }); if (scope.current === id) setRecallResults(data.memories); }); }}><label className="sr-only" htmlFor="recall-query">Search memories</label><input id="recall-query" maxLength={1000} required value={recallQuery} onChange={e => setRecallQuery(e.target.value)} placeholder="What are my care preferences?" /><button className="button secondary" disabled={busy.recall || !services.memoryConfigured}>{busy.recall ? <Spinner /> : <Search size={16} />}Search</button></form>{recallResults === null ? <Empty icon={Search} title="Find a familiar detail">Ask a question to retrieve relevant stored context.</Empty> : recallResults.length === 0 ? <Empty title="No matching memories">Try another question or save your first memory.</Empty> : <div className="recall-results">{recallResults.map((m, i) => <article key={`${m.blobId}-${i}`}><p>{m.text}</p><code>{m.blobId}</code><a className="text-button" href={blobExplorerUrl(m.blobId)} target="_blank" rel="noreferrer">View source on Walrus Scan</a></article>)}</div>}</section></div><section className="panel pad receipts-panel"><div className="section-title"><h2>Memory & storage receipts</h2><span className="muted small-text">A blob ID is not a transaction hash.</span></div>{workspace.memories.length === 0 ? <Empty icon={History} title="No memories saved yet">Your reviewed memories and their storage status will appear here.</Empty> : <div className="memory-list">{workspace.memories.map(m => <article className="memory-record" key={m.id}><div className="record-top"><span className={`status-pill ${m.status}`}>{m.status === "stored" ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}{m.status === "stored" ? "Stored on Walrus" : m.status === "processing" ? "Awaiting confirmation" : m.status === "unknown" ? "Submission unconfirmed" : "Storage failed"}</span><time>{date(m.createdAt)}</time></div><p>{m.text}</p><span className="provenance"><ShieldCheck size={13} />{m.provenance === "clinician-confirmed" ? "Clinician-confirmed" : m.provenance?.startsWith("demo-") ? "Fictional demo · self-reported" : "Patient-reported"}</span>{m.error && <Notice type="error">{m.error}</Notice>}{m.jobId && <div className="receipt-line"><span>Job ID</span><code>{m.jobId}</code></div>}{m.blobId && <div className="receipt-line"><span>Blob ID</span><code>{m.blobId}</code><CopyButton value={m.blobId} label="Copy blob ID" /></div>}{m.status === "stored" && m.blobId && <a className="text-button blob-link" href={blobExplorerUrl(m.blobId)} target="_blank" rel="noreferrer">View blob on Walrus Scan <ArrowRight size={12} /></a>}{m.status === "processing" && <button className="text-button" disabled={busy[m.id]} onClick={() => perform(m.id, async () => { const data = await api(`${base}/memories/${m.id}/status`); updateMemory(data.memory); })}><RefreshCw size={14} />Refresh receipt</button>}</article>)}</div>}</section></>}
          {tab === "plan" && patient && <div className="plan-grid"><section className="panel pad"><div className="section-title"><h2>Care notes</h2><span className="soft-pill"><UsersRound size={13} />Shared care workspace</span></div><p className="muted small-text">Notes are saved in this app and visible to the patient and linked clinicians. They are not automatically uploaded to Walrus.</p><form className="form-stack" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const text = new FormData(form).get("note"); perform("note", async () => { const id = selectedId; const data = await api(`${base}/notes`, { method: "POST", body: { text } }); if (scope.current === id) setWorkspace(w => ({ ...w, notes: [data.note, ...w.notes] })); form.reset(); setNotice("Care note saved."); }); }}><label>New care note<textarea name="note" rows={4} maxLength={6000} required placeholder="A question, a visit summary, or something to discuss…" /></label><button className="button primary" disabled={busy.note}>{busy.note ? <Spinner /> : <Plus size={17} />}Save note</button></form><div className="note-list">{workspace.notes.length === 0 ? <Empty icon={ClipboardList} title="A little space to prepare">Your saved care notes will appear here.</Empty> : workspace.notes.map(note => <article key={note.id}><p>{note.text}</p><span>{note.authorName} · {date(note.createdAt)}</span></article>)}</div></section><section className="panel pad"><div className="section-title"><h2>Care plan checklist</h2><span className="soft-pill">{completed}/{workspace.tasks.length} done</span></div><p className="muted small-text">Keep track of practical next steps for your care.</p><form className="search-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const title = new FormData(form).get("task"); perform("task", async () => { const id = selectedId; const data = await api(`${base}/tasks`, { method: "POST", body: { title } }); if (scope.current === id) setWorkspace(w => ({ ...w, tasks: [data.task, ...w.tasks] })); form.reset(); }); }}><label className="sr-only" htmlFor="new-task">New care task</label><input id="new-task" name="task" maxLength={200} required placeholder="e.g. Prepare questions for my visit" /><button className="button secondary" disabled={busy.task}>{busy.task ? <Spinner /> : <Plus size={16} />}Add</button></form><div className="task-list">{workspace.tasks.length === 0 ? <Empty icon={CheckCircle2} title="Small steps, all in one place">Add a task and mark it complete when you’re done.</Empty> : workspace.tasks.map(task => <label className={`task ${task.completed ? "done" : ""}`} key={task.id}><input type="checkbox" checked={task.completed} disabled={busy[task.id]} onChange={e => { const checked = e.target.checked; perform(task.id, async () => { const id = selectedId; const data = await api(`${base}/tasks/${task.id}`, { method: "PATCH", body: { completed: checked } }); if (scope.current === id) setWorkspace(w => ({ ...w, tasks: w.tasks.map(t => t.id === task.id ? data.task : t) })); }); }} /><span>{task.title}</span>{busy[task.id] && <Spinner />}</label>)}</div></section></div>}
          {tab === "settings" && <div className="settings-grid"><section className="panel pad"><div className="title-with-icon"><span className="small-icon"><LockKeyhole size={21} /></span><div><h2>Memory & privacy</h2><p className="muted small-text">You decide what stays connected.</p></div></div>{patient ? <>{automaticMemoryPanel(false)}<div className="consent-row"><div><strong>Reviewed memory saves</strong><p>Enable explicit saves for this patient’s care workspace.</p></div><label className="switch"><input type="checkbox" aria-label="Allow reviewed memory saves" checked={patient.memoryConsent} disabled={!canConsent || busy.consent} onChange={e => { const enabled = e.target.checked; perform("consent", async () => { const data = await api(`${base}/consent`, { method: "PATCH", body: { enabled } }); updatePatient(data.patient); }); }} /><span /></label></div><p className="muted small-text">Saved memories are encrypted through the Walrus relayer, which processes plaintext during storage. Relevant recalled text is sent to Gemini when you chat. This switch only controls reviewed note saves. Use Automatic conversation memory above to pause chat archiving. Neither switch deletes existing records or blobs.</p>{!canConsent && <Notice>Only the patient can change their consent.</Notice>}</> : <p className="muted">Link a patient to view their consent settings.</p>}<div className="account-details"><strong>{displayName(user)}</strong><span>{user.username ? "@" + user.username + " · unverified demo label" : user.email}</span><span>{user.isDemo ? "Fictional-data demo account" : isPatient ? "Patient account" : "Invited clinician account"}</span></div></section>
            <section className="panel pad"><h2>Connected services</h2><div className="service-row"><span className="small-icon"><Sparkles size={20} /></span><div><strong>Gemini</strong><p>{services.model || "gemini-3.1-flash-lite"}</p></div><span className={`soft-pill ${services.chatConfigured ? "" : "amber"}`}>{services.chatConfigured ? "Key configured" : "Needs API key"}</span></div><div className="service-row"><span className="small-icon"><Database size={20} /></span><div><strong>Walrus Memory</strong><p>Mainnet relayer</p></div><span className={`soft-pill ${verification?.connected ? "" : "amber"}`}>{verification?.connected ? "Connection verified" : services.memoryConfigured ? "Needs verification" : "Needs account"}</span></div><button className="button secondary" disabled={!services.memoryConfigured || busy.verify} onClick={() => perform("verify", async () => { const data = await api("/services/verify", { method: "POST", body: {} }); setVerification(data.verification); setNotice("Walrus authenticated connection verified. No blob was written by this check."); })}>{busy.verify ? <Spinner /> : <RefreshCw size={16} />}Test Walrus connection</button><button className="text-button refresh-connections" onClick={refreshConnections} disabled={busy.refreshConnections}><RefreshCw size={14} />Refresh connection status</button>{services.accountId && <div className="receipt-line account-id"><span>Account ID</span><code>{services.accountId}</code><CopyButton value={services.accountId} /></div>}<details className="setup-details" open={!services.memoryConfigured || !services.chatConfigured}><summary>Server setup instructions</summary><p>In the existing server <code>.env</code> file, fill missing values locally, then restart the server. Do not overwrite working Walrus credentials:</p><ul><li><code>GEMINI_API_KEY</code> from <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a></li><li><code>MEMWAL_ACCOUNT_ID</code> and <code>MEMWAL_KEY</code> from your own <a href="https://memory.walrus.xyz" target="_blank" rel="noreferrer">Walrus Memory account</a></li><li><code>CLINICIAN_INVITE_CODE</code> is only for advanced email-based clinician accounts. The clinician demo needs no code.</li></ul><p>Keep private keys on the server. Do not enter them in chat. A configured key is not proof of a successful live call.</p></details></section>
            {isPatient && patient && <TelegramSettings telegram={workspace.telegram} busy={busy} onConnect={connectTelegram} onDisconnect={disconnectTelegram} onActivate={activateTelegram} />}
            {isPatient && patient && <section className="panel pad care-team-panel"><h2>Your care team</h2><p className="muted small-text">Share your care code only with an invited clinician you want to give access to your shared notes, tasks, and memories. Your private chat stays separate.</p><div className="care-code"><code>{patient.careCode}</code><CopyButton value={patient.careCode} label="Copy care code" /></div><button className="text-button" disabled={busy.rotate} onClick={() => perform("rotate", async () => { const data = await api(`${base}/care-code`, { method: "POST", body: {} }); updatePatient(data.patient); setNotice("New care code created. Existing care-team access is unchanged."); })}><RefreshCw size={14} />Generate a new care code</button><div className="care-team-list">{workspace.careTeam?.length ? workspace.careTeam.map(member => <div key={member.id}><span className="avatar small">{initials(member.name)}</span><strong>{member.name}</strong><button className="text-button danger-text" disabled={busy[member.id]} onClick={() => perform(member.id, async () => { const data = await api(`${base}/care-team/${member.id}`, { method: "DELETE", body: {}}); updatePatient(data.patient); setWorkspace(w => ({ ...w, careTeam: w.careTeam.filter(m => m.id !== member.id) })); setNotice("Clinician access removed and care code changed."); })}><Trash2 size={14} />Remove access</button></div>) : <p className="muted small-text">No clinicians are linked yet.</p>}</div></section>}
          </div>}
        </>}
        <footer className="page-footer"><span><ShieldCheck size={13} />Patient-led memory. Human-led care.</span><small>Fictional data only during this pilot. <a href="https://unavatar.io" target="_blank" rel="noreferrer">Avatars by Unavatar</a>.</small></footer>
      </div>
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{NAV.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} className={tab === id ? "active" : ""} onClick={() => changeTab(id)}><Icon size={20} /><span>{id === "chat" ? "Chat" : id === "memory" ? "Memory" : id === "plan" ? "Care plan" : "Settings"}</span></button>)}</nav>
    {showLink && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="link-title"><div className="section-title"><h2 id="link-title">Link a patient</h2><button className="icon-button" aria-label="Close dialog" onClick={() => setShowLink(false)}><X size={20} /></button></div><p className="muted small-text">Ask the patient for their care code from Settings. This grants access to their shared care workspace.</p><form className="form-stack" onSubmit={e => { e.preventDefault(); const code = new FormData(e.currentTarget).get("code"); perform("link", async () => { const data = await api("/patients/link", { method: "POST", body: { code } }); setPatients(p => p.some(item => item.id === data.patient.id) ? p : [...p, data.patient]); setSelectedId(data.patient.id); setShowLink(false); setTab("chat"); }); }}><label>Patient care code<input name="code" autoFocus required maxLength={40} autoComplete="off" /></label>{error && <Notice type="error">{error}</Notice>}<button className="button primary" disabled={busy.link}>{busy.link ? <Spinner /> : <UsersRound size={17} />}Link patient workspace</button></form></section></div>}
  </div>;
}
function BookIcon() { return <History size={13} aria-hidden="true" />; }
createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
