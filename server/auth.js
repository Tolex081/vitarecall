import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const cookieName = "vita_session";
export const hash = (text) => createHash("sha256").update(text).digest("hex");
export function equal(a, b) {
  return typeof a === "string" && typeof b === "string" && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [salt, expected] = encoded.split(":");
  const key = await derive(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}
export const publicUser = (user) => user ? ({
  id: user.id, name: user.name, email: user.username ? null : user.email, role: user.role,
  isDemo: Boolean(user.username),
  ...(user.username ? { username: user.username, avatarUrl: `/api/avatar/twitter/${user.username}` } : {}),
}) : null;

export function createSessions(store, config) {
  const readUser = (id) => store.get("SELECT u.*,d.username FROM users u LEFT JOIN demo_profiles d ON d.user_id=u.id WHERE u.id=?", id);
  function writeCookie(res, token, maxAge) {
    res.cookie(cookieName, token, { httpOnly: true, sameSite: "strict", secure: config.secureCookies, path: "/", maxAge });
  }
  async function create(req, res, userId = null) {
    const previousTokenHash = req.session?.token_hash;
    const token = randomBytes(32).toString("hex");
    const ttl = userId ? 7 * 86400000 : 3600000;
    const session = { token_hash: hash(token), user_id: userId, csrf_token: randomBytes(32).toString("hex"), expires_at: Date.now() + ttl };
    await store.transaction(async tx => {
      if (previousTokenHash) await tx.run("DELETE FROM sessions WHERE token_hash=?", previousTokenHash);
      await tx.run("INSERT INTO sessions VALUES (?,?,?,?)", ...Object.values(session));
    });
    req.session = session;
    req.user = userId ? await readUser(userId) : null;
    if (req.user) req.user.isDemo = Boolean(req.user.username);
    writeCookie(res, token, ttl);
  }
  async function load(req, _res, next) {
    const match = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`));
    const token = match?.slice(cookieName.length + 1);
    req.session = token ? await store.get("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?", hash(token), Date.now()) : null;
    req.user = req.session?.user_id ? await readUser(req.session.user_id) : null;
    if (req.user) req.user.isDemo = Boolean(req.user.username);
    next();
  }
  return { create, load };
}
