import test from "node:test";
import assert from "node:assert/strict";

process.env.ARENA_MEMORY_STORE = "1";
process.env.ADMIN_USER = "david";
process.env.ADMIN_PASSWORD = "admin-pass-123";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

const { default: api } = await import("../netlify/functions/api.mjs");
const BASE = "https://arena.test";

async function call(method, path, { body, cookie, origin = BASE } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await api(new Request(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }));
  const data = await res.json();
  const sc = res.headers.get("set-cookie");
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null, setCookie: sc };
}

async function login(username, password) {
  return call("POST", "/api/login", { body: { username, password } });
}

let adminCookie, jacques, tester;

test("admin can log in and cookie is hardened", async () => {
  const r = await login("david", "admin-pass-123");
  assert.equal(r.status, 200);
  assert.equal(r.data.role, "admin");
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /Secure/);
  assert.match(r.setCookie, /SameSite=Strict/);
  adminCookie = r.cookie;
});

test("wrong admin password is rejected", async () => {
  const r = await login("david", "nope");
  assert.equal(r.status, 401);
});

test("unauthenticated requests are rejected", async () => {
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("GET", "/api/admin/users")).status, 401);
  assert.equal((await call("GET", "/api/progress")).status, 401);
});

test("admin creates live and test accounts, validates input", async () => {
  let r = await call("POST", "/api/admin/users", { cookie: adminCookie, body: { username: "jacques", password: "short" } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/admin/users", { cookie: adminCookie, body: { username: "Bad Name!", password: "longenough1" } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/admin/users", { cookie: adminCookie, body: { username: "david", password: "longenough1" } });
  assert.equal(r.status, 400);
  r = await call("POST", "/api/admin/users", { cookie: adminCookie, body: { username: "jacques", name: "Jacques", password: "jacques-pass-1" } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.hash, undefined);
  r = await call("POST", "/api/admin/users", { cookie: adminCookie, body: { username: "toets", name: "Toets", password: "toets-pass-123", test: true } });
  assert.equal(r.status, 201);
  r = await call("POST", "/api/admin/users", { cookie: adminCookie, body: { username: "jacques", password: "jacques-pass-1" } });
  assert.equal(r.status, 409);
  r = await call("GET", "/api/admin/users", { cookie: adminCookie });
  assert.equal(r.data.users.length, 2);
  assert.ok(r.data.users.every((u) => u.hash === undefined));
});

test("students log in, and cannot reach admin routes", async () => {
  let r = await login("jacques", "jacques-pass-1");
  assert.equal(r.status, 200);
  assert.equal(r.data.role, "student");
  jacques = r.cookie;
  r = await login("toets", "toets-pass-123");
  assert.equal(r.data.test, true);
  tester = r.cookie;
  r = await call("GET", "/api/me", { cookie: jacques });
  assert.equal(r.data.username, "jacques");
  assert.equal((await call("GET", "/api/admin/users", { cookie: jacques })).status, 403);
  assert.equal((await call("POST", "/api/admin/users", { cookie: jacques, body: { username: "x1x", password: "longenough1" } })).status, 403);
  assert.equal((await call("GET", "/api/admin/results", { cookie: jacques })).status, 403);
});

test("a forged or tampered cookie is rejected", async () => {
  const [body, sig] = jacques.replace("session=", "").split(".");
  const forged = Buffer.from(JSON.stringify({ u: "david", role: "admin", exp: 9999999999 })).toString("base64url");
  assert.equal((await call("GET", "/api/admin/users", { cookie: `session=${forged}.${sig}` })).status, 401);
  assert.equal((await call("GET", "/api/me", { cookie: `session=${body}.AAAA` })).status, 401);
});

test("progress is private per user and size capped", async () => {
  let r = await call("PUT", "/api/progress", { cookie: jacques, body: { progress: { topics: { a: { days: ["2026-11-01"] } } } } });
  assert.equal(r.status, 200);
  r = await call("GET", "/api/progress", { cookie: jacques });
  assert.deepEqual(r.data.progress.topics.a.days, ["2026-11-01"]);
  r = await call("GET", "/api/progress", { cookie: tester });
  assert.deepEqual(r.data.progress, {});
  r = await call("PUT", "/api/progress", { cookie: jacques, body: { progress: { big: "x".repeat(300000) } } });
  assert.equal(r.status, 413);
  r = await call("PUT", "/api/progress", { cookie: jacques, body: { progress: [1, 2] } });
  assert.equal(r.status, 400);
});

test("cross-origin writes are blocked", async () => {
  const r = await call("PUT", "/api/progress", { cookie: jacques, origin: "https://evil.example", body: { progress: {} } });
  assert.equal(r.status, 403);
  const r2 = await call("PUT", "/api/progress", { cookie: jacques, origin: null, body: { progress: {} } });
  assert.equal(r2.status, 403);
});

test("results are stored; test results are hidden from reports by default", async () => {
  let r = await call("POST", "/api/result", { cookie: jacques, body: { subject: "Wiskunde", topic: "Gewone breuke", topicId: "wisk-gewone-breuke", score: 4, total: 6, pct: 67, status: "Fokus nodig", wrong: ["3/4 - 1/3"], wrongTags: ["c3"] } });
  assert.equal(r.status, 201);
  r = await call("POST", "/api/result", { cookie: tester, body: { subject: "Wiskunde", topic: "Gewone breuke", score: 6, total: 6, pct: 100 } });
  assert.equal(r.status, 201);
  r = await call("GET", "/api/admin/results", { cookie: adminCookie });
  assert.equal(r.data.results.length, 1);
  assert.equal(r.data.results[0].user, "jacques");
  assert.equal(r.data.results[0].pct, 67);
  r = await call("GET", "/api/admin/results?test=1", { cookie: adminCookie });
  assert.equal(r.data.results.length, 2);
  r = await call("GET", "/api/admin/results?user=jacques", { cookie: adminCookie });
  assert.equal(r.data.results.length, 1);
});

test("admin cannot post student data; students cannot read others", async () => {
  assert.equal((await call("POST", "/api/result", { cookie: adminCookie, body: {} })).status, 403);
  assert.equal((await call("GET", "/api/admin/users/jacques/progress", { cookie: jacques })).status, 403);
  const r = await call("GET", "/api/admin/users/jacques/progress", { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.ok(r.data.progress.topics);
});

test("password reset invalidates old sessions", async () => {
  let r = await call("POST", "/api/admin/users/jacques/password", { cookie: adminCookie, body: { password: "brand-new-pass-1" } });
  assert.equal(r.status, 200);
  assert.equal((await call("GET", "/api/me", { cookie: jacques })).status, 401);
  assert.equal((await login("jacques", "jacques-pass-1")).status, 401);
  r = await login("jacques", "brand-new-pass-1");
  assert.equal(r.status, 200);
  jacques = r.cookie;
});

test("login locks after repeated failures", async () => {
  await call("POST", "/api/admin/users", { cookie: adminCookie, body: { username: "vriend", password: "vriend-pass-12" } });
  for (let i = 0; i < 5; i++) assert.equal((await login("vriend", "wrong")).status, 401);
  assert.equal((await login("vriend", "vriend-pass-12")).status, 429);
  // admin reset clears the lock
  await call("POST", "/api/admin/users/vriend/password", { cookie: adminCookie, body: { password: "vriend-pass-99" } });
  assert.equal((await login("vriend", "vriend-pass-99")).status, 200);
});

test("deleting a user removes access and data", async () => {
  let r = await call("DELETE", "/api/admin/users/vriend", { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.equal((await login("vriend", "vriend-pass-99")).status, 401);
  r = await call("GET", "/api/admin/users", { cookie: adminCookie });
  assert.ok(!r.data.users.some((u) => u.username === "vriend"));
});

test("reset-progress clears a test account", async () => {
  await call("PUT", "/api/progress", { cookie: tester, body: { progress: { x: 1 } } });
  let r = await call("POST", "/api/admin/users/toets/reset-progress", { cookie: adminCookie });
  assert.equal(r.status, 200);
  r = await call("GET", "/api/progress", { cookie: tester });
  assert.deepEqual(r.data.progress, {});
  r = await call("GET", "/api/admin/results?test=1", { cookie: adminCookie });
  assert.ok(!r.data.results.some((x) => x.user === "toets"));
});

test("logout clears the cookie", async () => {
  const r = await call("POST", "/api/logout", { cookie: jacques });
  assert.match(r.setCookie, /Max-Age=0/);
});
