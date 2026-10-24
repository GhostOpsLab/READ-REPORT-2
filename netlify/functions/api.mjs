// Eksamen Arena API: invite-only accounts, progress and results.
// One function handles every /api/* route.
import {
  hashPassword, verifyPassword, safeEqual, signToken, verifyToken,
  parseCookies, sessionCookie, USERNAME_RE,
} from "./lib/auth.mjs";
import { getArena, env } from "./lib/store.mjs";

export const config = { path: "/api/*" };

const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_PROGRESS_BYTES = 200 * 1024;
const MAX_RESULT_BYTES = 20 * 1024;
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function readBody(req, maxBytes) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Te groot");
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "Ongeldige JSON"); }
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function secret() {
  const s = env("SESSION_SECRET");
  if (!s || s.length < 16) throw new HttpError(500, "SESSION_SECRET is nie gestel nie");
  return s;
}

function getSession(req) {
  const token = parseCookies(req.headers.get("cookie")).session;
  return verifyToken(token, secret());
}

function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

async function checkLock(db, name) {
  const rec = (await db.getJSON(`lock/${name}`)) || { fails: [] };
  const recent = rec.fails.filter((t) => Date.now() - t < LOCK_WINDOW_MS);
  return { recent, locked: recent.length >= MAX_FAILS };
}

async function recordFail(db, name, recent) {
  await db.putJSON(`lock/${name}`, { fails: [...recent, Date.now()] });
}

async function login(req, db) {
  const { username, password } = await readBody(req, 2000);
  const u = str(username, 40).trim().toLowerCase();
  const p = str(password, 200);
  if (!USERNAME_RE.test(u) || !p) {
    verifyPassword(p, DUMMY_HASH);
    return json(401, { error: "Verkeerde gebruikersnaam of wagwoord" });
  }
  const { recent, locked } = await checkLock(db, u);
  if (locked) return json(429, { error: "Te veel pogings. Probeer oor 15 minute weer." });

  let session = null;
  const adminUser = (env("ADMIN_USER") || "").toLowerCase();
  const adminPass = env("ADMIN_PASSWORD") || "";
  if (adminUser && u === adminUser) {
    if (adminPass && safeEqual(p, adminPass)) session = { u, role: "admin", test: false };
  } else {
    const user = await db.getJSON(`user/${u}`);
    const ok = verifyPassword(p, user ? user.hash : DUMMY_HASH);
    if (user && ok) session = { u, role: "student", test: !!user.test, pv: user.pv || 0 };
  }
  if (!session) {
    await recordFail(db, u, recent);
    return json(401, { error: "Verkeerde gebruikersnaam of wagwoord" });
  }
  await db.del(`lock/${u}`);
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = signToken({ ...session, exp }, secret());
  if (session.role === "student") {
    const user = await db.getJSON(`user/${u}`);
    user.lastLogin = new Date().toISOString();
    await db.putJSON(`user/${u}`, user);
  }
  return json(
    200,
    { username: u, role: session.role, test: session.test },
    { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) },
  );
}

// Returns the live session or null. Students are re-checked so deleted users and
// changed passwords lose access straight away.
async function requireSession(req, db) {
  const s = getSession(req);
  if (!s) return null;
  if (s.role === "admin") {
    const adminUser = (env("ADMIN_USER") || "").toLowerCase();
    return adminUser && s.u === adminUser ? s : null;
  }
  const user = await db.getJSON(`user/${s.u}`);
  if (!user || (user.pv || 0) !== (s.pv || 0)) return null;
  return { ...s, test: !!user.test, name: user.name || s.u, notify: user.notify !== false };
}

function publicUser(u) {
  return {
    username: u.username, name: u.name, test: !!u.test, notify: u.notify !== false,
    created: u.created, lastLogin: u.lastLogin || null,
  };
}

async function admin(req, db, parts) {
  // parts: path segments after /api/admin
  const method = req.method;
  if (parts[0] === "users" && parts.length === 1) {
    if (method === "GET") {
      const keys = await db.keys("user/");
      const users = [];
      for (const k of keys) {
        const u = await db.getJSON(k);
        if (u) users.push(publicUser(u));
      }
      users.sort((a, b) => a.username.localeCompare(b.username));
      return json(200, { users });
    }
    if (method === "POST") {
      const b = await readBody(req, 4000);
      const username = str(b.username, 40).trim().toLowerCase();
      const password = str(b.password, 200);
      if (!USERNAME_RE.test(username)) return json(400, { error: "Gebruikersnaam: 3-30 karakters, kleinletters, syfers, . _ -" });
      if (password.length < 8) return json(400, { error: "Wagwoord moet minstens 8 karakters wees" });
      const adminUser = (env("ADMIN_USER") || "").toLowerCase();
      if (username === adminUser) return json(400, { error: "Naam is gereserveer" });
      if (await db.getJSON(`user/${username}`)) return json(409, { error: "Gebruiker bestaan reeds" });
      const user = {
        username, name: str(b.name, 60).trim() || username, hash: hashPassword(password),
        test: !!b.test, notify: b.notify !== false, pv: 0, created: new Date().toISOString(),
      };
      await db.putJSON(`user/${username}`, user);
      return json(201, { user: publicUser(user) });
    }
  }
  if (parts[0] === "users" && parts.length >= 2) {
    const username = str(parts[1], 40).toLowerCase();
    if (!USERNAME_RE.test(username)) return json(400, { error: "Ongeldige gebruiker" });
    const user = await db.getJSON(`user/${username}`);
    if (!user) return json(404, { error: "Nie gevind nie" });
    if (parts.length === 2 && method === "DELETE") {
      for (const k of await db.keys(`result/${username}/`)) await db.del(k);
      await db.del(`progress/${username}`);
      await db.del(`lock/${username}`);
      await db.del(`user/${username}`);
      return json(200, { ok: true });
    }
    if (parts.length === 3 && parts[2] === "password" && method === "POST") {
      const b = await readBody(req, 2000);
      const password = str(b.password, 200);
      if (password.length < 8) return json(400, { error: "Wagwoord moet minstens 8 karakters wees" });
      user.hash = hashPassword(password);
      user.pv = (user.pv || 0) + 1;
      await db.putJSON(`user/${username}`, user);
      await db.del(`lock/${username}`);
      return json(200, { ok: true });
    }
    if (parts.length === 3 && parts[2] === "reset-progress" && method === "POST") {
      await db.del(`progress/${username}`);
      for (const k of await db.keys(`result/${username}/`)) await db.del(k);
      return json(200, { ok: true });
    }
    if (parts.length === 3 && parts[2] === "progress" && method === "GET") {
      return json(200, { progress: (await db.getJSON(`progress/${username}`)) || {} });
    }
  }
  if (parts[0] === "results" && parts.length === 1 && method === "GET") {
    const url = new URL(req.url);
    const only = (url.searchParams.get("user") || "").toLowerCase();
    const includeTest = url.searchParams.get("test") === "1";
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const keys = (await db.keys(only ? `result/${only}/` : "result/")).sort().reverse();
    const out = [];
    for (const k of keys) {
      if (out.length >= limit) break;
      const r = await db.getJSON(k);
      if (!r) continue;
      if (r.test && !includeTest) continue;
      out.push(r);
    }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return json(200, { results: out });
  }
  return json(404, { error: "Nie gevind nie" });
}

async function handle(req) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  const db = await getArena();

  if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) {
    return json(403, { error: "Ongeldige oorsprong" });
  }

  if (parts[0] === "login" && method === "POST") return login(req, db);
  if (parts[0] === "logout" && method === "POST") {
    return json(200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
  }

  const s = await requireSession(req, db);
  if (!s) return json(401, { error: "Nie ingeteken nie" });

  if (parts[0] === "me" && method === "GET") {
    return json(200, {
      username: s.u, role: s.role, test: !!s.test, name: s.name || s.u,
      notify: s.role === "student" && !s.test && s.notify !== false,
    });
  }

  if (parts[0] === "admin") {
    if (s.role !== "admin") return json(403, { error: "Net vir admin" });
    return admin(req, db, parts.slice(1));
  }

  if (s.role !== "student") return json(403, { error: "Net vir leerders" });

  if (parts[0] === "progress" && parts.length === 1) {
    if (method === "GET") return json(200, { progress: (await db.getJSON(`progress/${s.u}`)) || {} });
    if (method === "PUT") {
      const b = await readBody(req, MAX_PROGRESS_BYTES);
      if (!b || typeof b.progress !== "object" || Array.isArray(b.progress) || b.progress === null) {
        return json(400, { error: "Ongeldige data" });
      }
      await db.putJSON(`progress/${s.u}`, b.progress);
      return json(200, { ok: true });
    }
  }

  if (parts[0] === "result" && parts.length === 1 && method === "POST") {
    const b = await readBody(req, MAX_RESULT_BYTES);
    const at = new Date().toISOString();
    const rec = {
      at, user: s.u, name: s.name || s.u, test: !!s.test,
      subject: str(b.subject, 60), topic: str(b.topic, 120), topicId: str(b.topicId, 80),
      score: num(b.score), total: num(b.total), pct: num(b.pct), status: str(b.status, 40),
      seconds: num(b.seconds), device: str(b.device, 20),
      wrongTags: Array.isArray(b.wrongTags) ? b.wrongTags.slice(0, 30).map((x) => str(x, 40)) : [],
      wrong: Array.isArray(b.wrong) ? b.wrong.slice(0, 20).map((x) => str(x, 300)) : [],
    };
    const rand = Math.random().toString(36).slice(2, 8);
    await db.putJSON(`result/${s.u}/${at}-${rand}`, rec);
    return json(201, { ok: true });
  }

  return json(404, { error: "Nie gevind nie" });
}

export default async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: "Bedienerfout" });
  }
};
