// Varnum API: accounts, letter sync and private usage counts.
//
//   POST   /api/signup            {name, email, password}  -> {token, user}
//   POST   /api/login             {email, password}        -> {token, user}
//   POST   /api/logout            (token)
//   GET    /api/me                (token)                  -> {user}
//   PUT    /api/me/details        (token) {details}        letterhead details (name, address, contact)
//   GET    /api/letters           (token)                  -> {letters: [...], deleted: [ids]}
//   PUT    /api/letters/:id       (token) {letter}         create or update (newer ts wins)
//   DELETE /api/letters/:id       (token)
//   POST   /api/translate         {text, target}           -> {text}  (only when LLM_URL is set: a local llama.cpp
//                                                            server running the open Sarvam Translate model)
//   POST   /api/usage             {event, key}             anonymous daily counters, no letter content
//   GET    /api/health            liveness + database check
//   GET    /admin                 HTTP basic auth: users and usage per day
//
// The website (varnum.alvvintechnology.com, on Friday) calls this cross-origin with a bearer token.
import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { promisify } from "node:util";

const {
  PORT = "8103",
  HOST = "127.0.0.1",
  DATABASE_URL,
  ADMIN_USER,
  ADMIN_PASSWORD,
  ORIGINS = "https://varnum.alvvintechnology.com,https://localhost,capacitor://localhost",
  LLM_URL = "",
} = process.env;

if (!DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
const scrypt = promisify(crypto.scrypt);

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         bigserial PRIMARY KEY,
      email      text UNIQUE NOT NULL,
      name       text NOT NULL,
      salt       text NOT NULL,
      pass_hash  text NOT NULL,
      details    jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen  timestamptz
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used  timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS letters (
      user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id         text NOT NULL,
      data       jsonb,
      ts         bigint NOT NULL,
      deleted    boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS usage_daily (
      day   date NOT NULL,
      event text NOT NULL,
      key   text NOT NULL DEFAULT '',
      count integer NOT NULL DEFAULT 0,
      PRIMARY KEY (day, event, key)
    );
  `);
}

// ---------- helpers ----------
const clip = (s, n) => (s == null ? "" : String(s).slice(0, n));
const normEmail = (e) => clip(e, 160).trim().toLowerCase();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
async function hashPw(pw, salt) { return (await scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 })).toString("hex"); }
const publicUser = (u) => ({ name: u.name, email: u.email, details: u.details || {}, created: u.created_at });
const clientIp = (req) => (req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();

const hits = new Map();
function limited(bucket, ip, lim, winMin) {
  const k = bucket + "|" + ip, now = Date.now(), win = winMin * 60_000;
  const recent = (hits.get(k) || []).filter((t) => now - t < win);
  recent.push(now); hits.set(k, recent);
  if (hits.size > 20_000) hits.clear();
  return recent.length > lim;
}

async function newSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [sha(token), userId]);
  return token;
}
async function auth(req, res, next) {
  const m = (req.headers.authorization || "").match(/^Bearer\s+(\S+)$/);
  if (!m) return res.status(401).json({ ok: false, error: "Please sign in." });
  const r = await pool.query(
    `UPDATE sessions s SET last_used = now() FROM users u
     WHERE s.token_hash = $1 AND u.id = s.user_id RETURNING u.*`, [sha(m[1])]);
  if (!r.rows[0]) return res.status(401).json({ ok: false, error: "Please sign in again." });
  req.user = r.rows[0]; req.tokenHash = sha(m[1]);
  next();
}
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- app ----------
const app = express();
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
app.use(express.json({ limit: "400kb" }));

const allowed = new Set(ORIGINS.split(",").map((s) => s.trim()).filter(Boolean));
app.use("/api", (req, res, next) => {
  const o = req.headers.origin;
  if (o && allowed.has(o)) { res.set("Access-Control-Allow-Origin", o); res.set("Vary", "Origin"); }
  if (req.method === "OPTIONS") {
    if (!o || !allowed.has(o)) return res.status(403).end();
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }
  next();
});

app.get("/api/health", wrap(async (_req, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, db: true }); }
  catch (e) { res.status(503).json({ ok: false, db: false }); }
}));

app.post("/api/signup", wrap(async (req, res) => {
  if (limited("signup", clientIp(req), 10, 60)) return res.status(429).json({ ok: false, error: "Too many tries. Please wait a while." });
  const name = clip(req.body?.name, 80).trim().replace(/\s+/g, " "), email = normEmail(req.body?.email), password = String(req.body?.password || "");
  if (name.length < 2) return res.status(422).json({ ok: false, error: "Enter your name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ ok: false, error: "Enter a valid email address." });
  if (password.length < 6 || password.length > 200) return res.status(422).json({ ok: false, error: "Password must be at least 6 characters." });
  const salt = crypto.randomBytes(16).toString("hex");
  const r = await pool.query(
    `INSERT INTO users (email, name, salt, pass_hash, last_seen) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (email) DO NOTHING RETURNING *`, [email, name, salt, await hashPw(password, salt)]);
  if (!r.rows[0]) return res.status(409).json({ ok: false, code: "exists", error: "An account with this email already exists. Sign in instead." });
  await bump("signup", "");
  res.json({ ok: true, token: await newSession(r.rows[0].id), user: publicUser(r.rows[0]) });
}));

app.post("/api/login", wrap(async (req, res) => {
  const ip = clientIp(req), email = normEmail(req.body?.email), password = String(req.body?.password || "");
  if (limited("login", ip, 20, 15) || limited("login:" + email, "", 10, 15)) return res.status(429).json({ ok: false, error: "Too many tries. Please wait 15 minutes." });
  const r = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const u = r.rows[0];
  if (!u) return res.status(404).json({ ok: false, code: "no_account", error: "No account with this email. Create one first." });
  const h = await hashPw(password, u.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(u.pass_hash, "hex"))) return res.status(401).json({ ok: false, code: "wrong_password", error: "Wrong password." });
  await pool.query("UPDATE users SET last_seen = now() WHERE id = $1", [u.id]);
  await bump("login", "");
  res.json({ ok: true, token: await newSession(u.id), user: publicUser(u) });
}));

app.post("/api/logout", wrap(auth), wrap(async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [req.tokenHash]);
  res.json({ ok: true });
}));

app.get("/api/me", wrap(auth), (req, res) => res.json({ ok: true, user: publicUser(req.user) }));

app.put("/api/me/details", wrap(auth), wrap(async (req, res) => {
  const d = req.body?.details || {};
  const details = { lhName: clip(d.lhName, 200), lhAddr: clip(d.lhAddr, 600), lhContact: clip(d.lhContact, 200), ts: Number(d.ts) || Date.now() };
  await pool.query("UPDATE users SET details = $2 WHERE id = $1", [req.user.id, details]);
  res.json({ ok: true });
}));

app.get("/api/letters", wrap(auth), wrap(async (req, res) => {
  const r = await pool.query("SELECT id, data, ts, deleted FROM letters WHERE user_id = $1 ORDER BY ts DESC LIMIT 2000", [req.user.id]);
  res.json({ ok: true, letters: r.rows.filter((x) => !x.deleted).map((x) => x.data), deleted: r.rows.filter((x) => x.deleted).map((x) => ({ id: x.id, ts: Number(x.ts) })) });
}));

app.put("/api/letters/:id", wrap(auth), wrap(async (req, res) => {
  const id = clip(req.params.id, 40), l = req.body?.letter || {};
  if (!/^[\w-]{1,40}$/.test(id)) return res.status(422).json({ ok: false, error: "bad id" });
  const letter = { id, title: clip(l.title, 120), src: clip(l.src, 60000), out: clip(l.out, 120000), lang: clip(l.lang, 40), style: clip(l.style, 20), folder: clip(l.folder, 40), ts: Number(l.ts) || Date.now() };
  await pool.query(
    `INSERT INTO letters (user_id, id, data, ts, deleted) VALUES ($1, $2, $3, $4, false)
     ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, ts = EXCLUDED.ts, deleted = false, updated_at = now()
     WHERE letters.ts <= EXCLUDED.ts`, [req.user.id, id, letter, letter.ts]);
  res.json({ ok: true });
}));

app.delete("/api/letters/:id", wrap(auth), wrap(async (req, res) => {
  const id = clip(req.params.id, 40), ts = Date.now();
  await pool.query(
    `INSERT INTO letters (user_id, id, data, ts, deleted) VALUES ($1, $2, NULL, $3, true)
     ON CONFLICT (user_id, id) DO UPDATE SET data = NULL, ts = EXCLUDED.ts, deleted = true, updated_at = now()`, [req.user.id, id, ts]);
  res.json({ ok: true });
}));

// Usage: only an event name and a short key (a language or template name) are counted per day.
const EVENTS = new Set(["visit", "translate", "template", "download", "word", "ppt", "pdf", "merge", "share", "tool", "signup", "login"]);
async function bump(event, key) {
  await pool.query(
    `INSERT INTO usage_daily (day, event, key, count) VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, $1, $2, 1)
     ON CONFLICT (day, event, key) DO UPDATE SET count = usage_daily.count + 1`, [event, key]);
}
app.post("/api/usage", wrap(async (req, res) => {
  const event = clip(req.body?.event, 20), key = clip(req.body?.key, 40).replace(/[^\w ()-]/g, "");
  if (!EVENTS.has(event) || event === "signup" || event === "login") return res.status(422).json({ ok: false });
  if (limited("usage", clientIp(req), 120, 10)) return res.status(429).json({ ok: false });
  await bump(event, key);
  res.json({ ok: true });
}));

// ---------- translation (open Sarvam Translate model on this machine) ----------
// One request runs at a time on the CPU; others wait in line. A short queue keeps answers quick:
// when it is full the website falls back to its free online translators.
const LANG_NAMES = { hi: "Hindi", mr: "Marathi", gu: "Gujarati", pa: "Punjabi", bn: "Bengali", or: "Odia", ta: "Tamil", te: "Telugu", kn: "Kannada",
  ml: "Malayalam", ur: "Urdu", ne: "Nepali", sa: "Sanskrit", as: "Assamese", kok: "Konkani", mai: "Maithili", sd: "Sindhi", en: "English" };
const tCache = new Map();
let tChain = Promise.resolve(), tWaiting = 0;
async function llmTranslate(text, target) {
  const r = await fetch(LLM_URL.replace(/\/$/, "") + "/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ messages: [{ role: "system", content: `Translate the text below to ${LANG_NAMES[target]}.` }, { role: "user", content: text }],
      temperature: 0.01, max_tokens: Math.min(1024, text.length * 3 + 64) }),
  });
  if (!r.ok) throw new Error("llm " + r.status);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content || "").trim();
}
async function llmLines(text, target) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!/\p{L}/u.test(line)) { out.push(line); continue; }
    const k = target + "|" + line.trim();
    let r = tCache.get(k);
    if (!r) { r = await llmTranslate(line.trim(), target); if (!r) throw new Error("empty"); tCache.set(k, r); }
    out.push(line.match(/^\s*/)[0] + r.replace(/\s*\n\s*/g, " "));
  }
  return out.join("\n");
}
app.post("/api/translate", wrap(async (req, res) => {
  if (!LLM_URL) return res.status(503).json({ ok: false, error: "not_available" });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "", target = clip(req.body?.target, 4);
  if (!text || text.length > 1500 || !LANG_NAMES[target]) return res.status(422).json({ ok: false });
  if (limited("translate", clientIp(req), 300, 10)) return res.status(429).json({ ok: false });
  const key = target + "|" + text;
  if (tCache.has(key)) return res.json({ ok: true, text: tCache.get(key), cached: true });
  if (tWaiting >= 6) return res.status(503).json({ ok: false, error: "busy" });
  tWaiting++;
  // The model joins lines and can drop short ones ("Thanking you,"), so a letter goes one line at a time
  // and keeps its blank lines and indents.
  const job = tChain.then(() => llmLines(text, target));
  tChain = job.catch(() => {});
  let out;
  try { out = await job; } catch (e) { console.error("[varnum-api] translate", e.message); return res.status(502).json({ ok: false }); } finally { tWaiting--; }
  if (!out) return res.status(502).json({ ok: false });
  tCache.set(key, out);
  while (tCache.size > 5000) tCache.delete(tCache.keys().next().value);
  res.json({ ok: true, text: out });
}));

// ---------- admin ----------
function adminAuth(req, res, next) {
  if (!ADMIN_USER || !ADMIN_PASSWORD) return res.status(503).send("Admin login is not configured (ADMIN_USER / ADMIN_PASSWORD).");
  const [scheme, b64] = (req.headers.authorization || "").split(" ");
  let ok = false;
  if (scheme === "Basic" && b64) {
    const a = Buffer.from(Buffer.from(b64, "base64").toString()), b = Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!ok) { res.set("WWW-Authenticate", 'Basic realm="Varnum"'); return res.status(401).send("Login required"); }
  next();
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
app.get(["/", "/admin"], adminAuth, wrap(async (_req, res) => {
  const [tot, days, tops, recent] = await Promise.all([
    pool.query(`SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM users WHERE last_seen > now() - interval '7 days') active7,
                       (SELECT count(*) FROM letters WHERE NOT deleted) letters`),
    pool.query(`SELECT day, event, sum(count)::int n FROM usage_daily WHERE day > current_date - 30 GROUP BY 1,2 ORDER BY 1 DESC`),
    pool.query(`SELECT event, key, sum(count)::int n FROM usage_daily WHERE day > current_date - 30 AND key <> '' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 30`),
    pool.query(`SELECT name, email, created_at, last_seen FROM users ORDER BY created_at DESC LIMIT 50`),
  ]);
  const t = tot.rows[0], ev = ["visit", "translate", "template", "download", "word", "ppt", "pdf", "merge", "share", "signup", "login"];
  const byDay = {}; for (const r of days.rows) { const d = r.day.toISOString().slice(0, 10); (byDay[d] ||= {})[r.event] = r.n; }
  res.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Varnum · usage</title>
<style>body{font:15px system-ui,sans-serif;margin:16px;color:#0f172a}table{border-collapse:collapse;margin:8px 0 22px}td,th{border-bottom:1px solid #e2e8f0;padding:5px 9px;text-align:right}th:first-child,td:first-child{text-align:left}.k{display:flex;gap:14px;flex-wrap:wrap}.k div{background:#f1f5f9;border-radius:10px;padding:10px 14px}.k b{display:block;font-size:1.5rem}</style>
<h1>Varnum</h1><div class="k"><div><b>${t.users}</b>accounts</div><div><b>${t.active7}</b>active in 7 days</div><div><b>${t.letters}</b>saved letters</div></div>
<h2>Last 30 days</h2><div style="overflow:auto"><table><tr><th>Day</th>${ev.map((e) => `<th>${e}</th>`).join("")}</tr>
${Object.entries(byDay).map(([d, v]) => `<tr><td>${d}</td>${ev.map((e) => `<td>${v[e] || ""}</td>`).join("")}</tr>`).join("")}</table></div>
<h2>Top languages, templates and downloads (30 days)</h2><table><tr><th>What</th><th>Which</th><th>Count</th></tr>${tops.rows.map((r) => `<tr><td>${esc(r.event)}</td><td>${esc(r.key)}</td><td>${r.n}</td></tr>`).join("")}</table>
<h2>Newest accounts</h2><table><tr><th>Name</th><th>Email</th><th>Joined</th><th>Last seen</th></tr>${recent.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.created_at.toISOString().slice(0, 10)}</td><td>${r.last_seen ? r.last_seen.toISOString().slice(0, 10) : ""}</td></tr>`).join("")}</table>`);
}));

app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
app.use((err, _req, res, _next) => { console.error("[varnum-api]", err); res.status(500).json({ ok: false, error: "Something went wrong. Please try again." }); });

migrate().then(() => {
  app.listen(Number(PORT), HOST, () => console.log(`varnum-api listening on ${HOST}:${PORT}`));
}).catch((e) => { console.error("migration failed", e); process.exit(1); });
