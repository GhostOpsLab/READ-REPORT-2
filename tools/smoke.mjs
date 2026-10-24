// Local end-to-end smoke test. Needs Playwright with Chromium (not part of `npm test`).
// Usage: node tools/smoke.mjs [screenshotDir]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

process.env.ARENA_MEMORY_STORE = "1";
process.env.ADMIN_USER = "david";
process.env.ADMIN_PASSWORD = "admin-pass-123";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.join(root, "site");
const shots = process.argv[2];
const { default: api } = await import("../netlify/functions/api.mjs");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain" };
let formPosts = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (url.pathname.startsWith("/api/")) {
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
    const headers = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (req.method === "POST" && url.pathname === "/") { formPosts.push(new URLSearchParams(body.toString())); res.writeHead(200); res.end("ok"); return; }
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(siteDir, p);
  if (!file.startsWith(siteDir) || !fs.existsSync(file)) { res.writeHead(404); res.end("nie gevind"); return; }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error("MISLUK:", m); } else console.log("ok:", m); };

async function adminCall(cookie, method, p, b) {
  const r = await fetch(base + "/api" + p, { method, headers: { "Content-Type": "application/json", Origin: base, cookie }, body: b ? JSON.stringify(b) : undefined });
  return r;
}
const lr = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ username: "david", password: "admin-pass-123" }) });
const adminCookie = lr.headers.get("set-cookie").split(";")[0];
await adminCall(adminCookie, "POST", "/admin/users", { username: "jacques", name: "Jacques", password: "jacques-pass-1" });
await adminCall(adminCookie, "POST", "/admin/users", { username: "toets", name: "Toets", password: "toets-pass-123", test: true });

const content = JSON.parse(fs.readFileSync(path.join(siteDir, "content", "wisk-gewone-breuke.json"), "utf8"));
const answers = Object.fromEntries(content.questions.map((q) => [q.q, q.answer]));

const browser = await chromium.launch();
const errors = [];
async function newPage(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return page;
}
async function shot(page, name) { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true }); } }

async function loginAs(page, user, pass) {
  await page.goto(base + "/");
  await page.fill("#u", user);
  await page.fill("#p", pass);
  await page.click("button[type=submit]");
  await page.waitForSelector(".hud");
}

async function runQuiz(page, perfect) {
  await page.click("text=Begin met die notas");
  for (let i = 0; i < 4; i++) await page.click("text=Volgende");
  await page.click("text=Gaan toets");
  for (let i = 0; i < 6; i++) {
    const q = await page.textContent(".qtext");
    const right = answers[q];
    ok(!!right, `vraag herken: ${q}`);
    const opts = await page.$$(".opt");
    let target = null, wrongOne = null;
    for (const o of opts) { const t = await o.textContent(); if (t === right) target = o; else if (!wrongOne) wrongOne = o; }
    await (perfect || i > 0 ? target : wrongOne).click();
    await page.click(i === 5 ? "text=Sien my uitslag" : "text=Volgende vraag");
  }
}

try {
  /* login failure */
  let page = await newPage(390, 800);
  await page.goto(base + "/");
  await page.fill("#u", "toets"); await page.fill("#p", "verkeerd"); await page.click("button[type=submit]");
  await page.waitForSelector(".err:not(:empty)");
  ok((await page.textContent(".err")).includes("Verkeerde"), "verkeerde wagwoord gee 'n boodskap");

  /* test account on a phone-sized screen */
  await loginAs(page, "toets", "toets-pass-123");
  ok(await page.isVisible("text=TOETS-rekening"), "toets-rekening banier sigbaar");
  await shot(page, "home-mobile");
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(noOverflow, "geen horisontale oorloop op 390px");
  ok(await page.isVisible("text=Vandag se missie"), "vandag se missie wys");
  await page.click("summary:has-text('Wiskunde V1')");
  await page.click(".trow:has-text('Gewone breuke')");
  await page.waitForSelector("text=Begin met die notas");
  ok(await page.isVisible("text=Voorbeeld-inhoud"), "voorbeeld-inhoud waarskuwing wys");
  await runQuiz(page, false);
  await page.waitForSelector(".score-big");
  const sc = await page.textContent(".score-big");
  ok(sc === "5/6", `telling is 5/6 (kry ${sc})`);
  await shot(page, "result-mobile");
  ok(await page.isVisible("text=Om weer te kyk"), "foute word gewys");
  ok(await page.isVisible("text=Lees notas oor my foute") === false, "5/6 is 83%, so geen verpligte herlees nie");
  await page.waitForTimeout(500);
  ok(formPosts.length === 0, "toets-rekening stuur geen vorm/e-pos nie");

  /* second, perfect round the same day: still only 1 day counted */
  await page.click("text=Nog 'n rondte");
  for (let i = 0; i < 6; i++) {
    const q = await page.textContent(".qtext");
    for (const o of await page.$$(".opt")) if ((await o.textContent()) === answers[q]) { await o.click(); break; }
    await page.click(i === 5 ? "text=Sien my uitslag" : "text=Volgende vraag");
  }
  await page.waitForSelector(".score-big");
  ok((await page.textContent(".score-big")) === "6/6", "tweede rondte 6/6");
  ok(await page.isVisible("text=vandag reeds gehaal"), "dieselfde dag tel nie as tweede dag nie");
  await page.click("text=Terug na die kaart");
  await page.waitForSelector(".hud");
  await page.click("summary:has-text('Wiskunde V1')");
  ok(await page.isVisible(".trow:has-text('Gewone breuke') >> text=Dag 1 gehaal"), "onderwerp wys Dag 1 gehaal");
  await page.click("text=Teken uit");
  await page.waitForSelector("#u");

  /* progress is stored server side: log in again in a fresh browser context */
  const page2 = await newPage(1100, 900);
  await loginAs(page2, "toets", "toets-pass-123");
  const hud = await page2.textContent(".hud-meta");
  ok(/Missies\s*2/.test(hud), `vordering oorleef nuwe sessie (${hud.replace(/\s+/g, " ")})`);
  await shot(page2, "home-desktop");

  /* live account sends a report through Netlify Forms */
  const page3 = await newPage(1100, 900);
  await loginAs(page3, "jacques", "jacques-pass-1");
  ok(!(await page3.isVisible("text=TOETS-rekening")), "regtige rekening het geen toets-banier nie");
  await page3.click("text=Begin >> nth=0");
  await runQuiz(page3, true);
  await page3.waitForSelector(".score-big");
  await page3.waitForTimeout(800);
  ok(formPosts.length === 1, "regtige rekening stuur een vorm");
  const fp = formPosts[0];
  ok(fp && fp.get("form-name") === "uitslag" && fp.get("gebruiker") === "jacques" && fp.get("telling") === "6/6", "vorm bevat die regte velde");
  ok(fp && /Uitslag: 6\/6/.test(fp.get("verslag")), "verslag teks is reg");

  /* admin page */
  const pageA = await newPage(1100, 900);
  await pageA.goto(base + "/admin.html");
  await pageA.fill("#au", "david"); await pageA.fill("#ap", "admin-pass-123"); await pageA.click("button[type=submit]");
  await pageA.waitForSelector("table");
  ok(await pageA.isVisible("td:has-text('jacques')"), "admin sien jacques");
  await pageA.waitForSelector("text=6/6 (100%)");
  ok(await pageA.isVisible("td:has-text('Gewone breuke')"), "admin sien die uitslag");
  ok(!(await pageA.isVisible("td:has-text('Toets (toets)')")), "toets-uitslae is by verstek versteek");
  await pageA.fill("#cn", "Vriend"); await pageA.fill("#cu", "vriend1"); await pageA.fill("#cp", "vriend-pass-1");
  await pageA.click("text=Skep rekening");
  await pageA.waitForSelector("td:has-text('vriend1')");
  ok(true, "admin skep 'n nuwe rekening");
  await pageA.click("tr:has-text('jacques') >> text=Vordering");
  await pageA.waitForSelector("text=Vordering: Jacques");
  await shot(pageA, "admin");

  /* a student visiting the admin page is turned away */
  const pageS = await newPage(1100, 900);
  await loginAs(pageS, "jacques", "jacques-pass-1");
  await pageS.goto(base + "/admin.html");
  await pageS.waitForSelector("text=net vir admin");
  ok(true, "leerder kan nie admin-bladsy gebruik nie");
} catch (e) {
  failed++;
  console.error("Toets het gecrash:", e.message);
} finally {
  await browser.close();
  server.close();
}
ok(errors.length === 0, `geen konsole-foute (${errors.join(" | ")})`);
console.log(failed ? `${failed} MISLUK` : "ALMAL GESLAAG");
process.exit(failed ? 1 : 0);
