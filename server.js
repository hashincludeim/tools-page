'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SITE_TITLE = process.env.SITE_TITLE || 'Tools';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tools.json');
const DEFAULT_CATEGORY = 'Other';

const COOKIE_NAME = 'session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, in seconds
const MAX_FAILED_LOGINS = 20;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and choose a password.');
  process.exit(1);
}

// ---------- Storage ----------

// Each link is { id, category, name, url, createdAt }. Links saved before categories existed go under "Other".
function loadLinks() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return saved.map((link) => ({ ...link, category: link.category || DEFAULT_CATEGORY }));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function saveLinks() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(links, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let links = loadLinks();

// Categories appear in the order they were first used; links keep the order they were added.
function groupByCategory() {
  const groups = new Map();
  for (const link of links) {
    const key = link.category.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: link.category, links: [] });
    groups.get(key).links.push(link);
  }
  return [...groups.values()];
}

// Reuse an existing category's spelling so "finance" joins "Finance".
function canonicalCategory(input) {
  const match = links.find((l) => l.category.toLowerCase() === input.toLowerCase());
  return match ? match.category : input;
}

// ---------- Auth ----------

// Including the password in the key means changing the password logs out every session.
const signingKey = crypto.createHash('sha256').update(`${SESSION_SECRET}:${ADMIN_PASSWORD}`).digest();

function sign(value) {
  return crypto.createHmac('sha256', signingKey).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createSessionToken() {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE);
  return `${expires}.${sign(expires)}`;
}

function isValidSession(token) {
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || !safeEqual(sig, sign(expires))) return false;
  return Number(expires) > Date.now() / 1000;
}

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return cookies;
}

function isHttps(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return req.socket.encrypted || proto === 'https';
}

function sessionCookie(req, value, maxAge) {
  const secure = isHttps(req) ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// A global limit keeps brute-forcing impractical without trusting proxy IP headers.
let failedLogins = [];

function tooManyFailedLogins() {
  const cutoff = Date.now() - FAILED_LOGIN_WINDOW_MS;
  failedLogins = failedLogins.filter((t) => t > cutoff);
  return failedLogins.length >= MAX_FAILED_LOGINS;
}

// ---------- Helpers ----------

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function normalizeUrl(input) {
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function send(res, status, html, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(html);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

// ---------- Views ----------

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #060907;
  --fg: #b9f6c9;
  --dim: #5c9169;
  --faint: #2f4a37;
  --hi: #3dff8b;
  --err: #ff6b62;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--fg);
  font: 15px/1.75 var(--mono);
  background: radial-gradient(ellipse 90% 70% at 50% 0%, #0e1d13, var(--bg) 70%) fixed;
  text-shadow: 0 0 8px rgba(61, 255, 139, 0.28);
}
/* CRT scanlines with an occasional flicker */
body::after {
  content: "";
  position: fixed; inset: 0; z-index: 10;
  pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 3px);
  animation: flicker 6s infinite;
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.wrap { max-width: 760px; margin: 0 auto; padding: 20px 24px 96px; }
.topbar { display: flex; justify-content: flex-end; margin-bottom: clamp(24px, 7vh, 64px); }
.topbar form { margin: 0; }

/* Text buttons, drawn as [ label ] */
.btn {
  padding: 1px 0.5ch;
  font: inherit;
  color: var(--dim);
  text-decoration: none;
  text-shadow: inherit;
  background: none;
  border: 0;
  border-radius: 0;
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}
.btn::before { content: "[ "; }
.btn::after { content: " ]"; }
.btn:hover, .btn:focus-visible { color: var(--bg); background: var(--hi); text-shadow: none; outline: none; }
.btn-hi { color: var(--hi); }

/* Headings drawn as shell prompts and folders */
.prompt { margin: 0 0 6px; font: inherit; font-weight: 700; color: var(--hi); }
.prompt::before { content: "$ "; color: var(--dim); }
.cat { margin-bottom: 30px; }
.cat h2 { margin: 0 0 6px; font: inherit; font-weight: 700; color: var(--hi); text-transform: lowercase; overflow-wrap: anywhere; }
.cat h2::before { content: "~/"; color: var(--dim); }

/* Indented block with a dashed guide line, used for link lists and forms */
.tree { list-style: none; margin: 0 0 0 1ch; padding: 0 0 0 2ch; border-left: 1px dashed var(--dim); }

.link { position: relative; }
.link a { display: block; padding: 1px 1ch; color: var(--fg); text-decoration: none; overflow-wrap: anywhere; }
.link a::before { content: ">"; display: inline-block; width: 2ch; opacity: 0; }
.link a:hover, .link a:focus-visible { color: var(--bg); background: var(--hi); text-shadow: none; outline: none; }
.link a:hover::before, .link a:focus-visible::before { opacity: 1; }

/* Admin: [ rm ] sits at the end of each row */
.link:has(form) a { padding-right: 9ch; }
.link form { position: absolute; top: 50%; right: 0; margin: 0; transform: translateY(-50%); }
.btn-rm { color: var(--err); background: var(--bg); }
.btn-rm:hover, .btn-rm:focus-visible { color: var(--bg); background: var(--err); }
@media (hover: hover) {
  .link .btn-rm { opacity: 0; }
  .link:hover .btn-rm, .link .btn-rm:focus-visible { opacity: 1; }
}

/* Forms */
.panel { margin-bottom: 40px; }
.field { display: grid; grid-template-columns: 10ch 1fr; align-items: center; gap: 1ch; }
.field label { color: var(--dim); }
input {
  width: 100%; min-width: 0; height: 30px; padding: 0 0.5ch;
  font: inherit;
  color: var(--fg);
  caret-color: var(--hi);
  text-shadow: inherit;
  background: transparent;
  border: 0;
  border-bottom: 1px dashed var(--faint);
  border-radius: 0;
  transition: border-color 0.15s, background-color 0.15s;
}
input::placeholder { color: var(--faint); text-shadow: none; }
input:focus { outline: none; border-bottom: 1px solid var(--hi); background: rgba(61, 255, 139, 0.05); }
input:-webkit-autofill { -webkit-text-fill-color: var(--fg); box-shadow: 0 0 0 1000px var(--bg) inset; transition: background-color 9999s; }
form.tree .btn { margin-top: 10px; }

.error { margin: 0 0 8px; color: var(--err); text-shadow: 0 0 8px rgba(255, 107, 98, 0.3); text-transform: lowercase; }
.error::before { content: "error: "; font-weight: 700; }
.empty { margin: 0 0 12px; color: var(--dim); }
.empty::before { content: "# "; }

.cursor {
  display: inline-block;
  width: 0.6em; height: 1.15em;
  margin-top: 4px;
  vertical-align: middle;
  background: var(--hi);
  box-shadow: 0 0 10px var(--hi);
  animation: blink 1.05s steps(1) infinite;
}

/* Login */
.login {
  max-width: 560px; min-height: 100vh; margin: 0 auto;
  display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
  padding: 40px 24px 14vh;
}
.login .prompt { margin-bottom: 10px; }
.login form { align-self: stretch; }

/* Lines type themselves in on load */
.type { animation: type 0.55s steps(22) backwards; animation-delay: min(calc(var(--n) * 70ms), 1400ms); }
@keyframes type { from { clip-path: inset(0 100% 0 0); } }
@keyframes blink { 50% { opacity: 0; } }
@keyframes flicker { 0%, 97%, 100% { opacity: 1; } 98% { opacity: 0.85; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function renderAddPanel(groups, error, values) {
  const options = groups.map((g) => `<option value="${esc(g.name)}"></option>`).join('');
  return `<section class="panel" aria-labelledby="add-title">
    <h2 class="prompt type" id="add-title" style="--n:0">add link</h2>
    <form class="tree" method="post" action="/links">
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <div class="field type" style="--n:1">
        <label for="category">category:</label>
        <input id="category" name="category" list="categories" maxlength="50" required autocomplete="off" value="${esc(values.category || '')}" placeholder="Finance">
      </div>
      <div class="field type" style="--n:2">
        <label for="name">name:</label>
        <input id="name" name="name" maxlength="80" required autocomplete="off" value="${esc(values.name || '')}" placeholder="Budget Tracker">
      </div>
      <div class="field type" style="--n:3">
        <label for="url">url:</label>
        <input id="url" name="url" maxlength="2000" required autocomplete="off" inputmode="url" value="${esc(values.url || '')}" placeholder="https://example.com">
      </div>
      <button class="btn btn-hi type" type="submit" style="--n:4">add</button>
    </form>
    <datalist id="categories">${options}</datalist>
  </section>`;
}

function renderHome({ admin, error = '', values = {} }) {
  const groups = groupByCategory();
  // Stagger index for the typing animation; continues after the add panel's lines.
  let n = admin ? 5 : 0;

  const categories = groups
    .map(
      (group) => `
  <section class="cat">
    <h2 class="type" style="--n:${n++}">${esc(group.name)}</h2>
    <ul class="tree">${group.links
      .map(
        (link) => `
      <li class="link">
        <a class="type" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" style="--n:${n++}">${esc(link.name)}</a>${
          admin
            ? `
        <form method="post" action="/links/${esc(link.id)}/delete"><button class="btn btn-rm" type="submit" aria-label="Delete ${esc(link.name)}">rm</button></form>`
            : ''
        }
      </li>`,
      )
      .join('')}
    </ul>
  </section>`,
    )
    .join('');

  const content = groups.length ? categories : `<p class="empty">${admin ? 'add your first link above.' : 'nothing here yet.'}</p>`;

  return layout(
    SITE_TITLE,
    `<main class="wrap">
  <h1 class="sr-only">${esc(SITE_TITLE)}</h1>
  <div class="topbar">
    ${
      admin
        ? '<form method="post" action="/logout"><button class="btn" type="submit">logout</button></form>'
        : '<a class="btn" href="/login">login</a>'
    }
  </div>
  ${admin ? renderAddPanel(groups, error, values) : ''}
  ${content}
  <span class="cursor" aria-hidden="true"></span>
</main>`,
  );
}

function renderLogin(error = '') {
  return layout(
    `Log in · ${SITE_TITLE}`,
    `<main class="login">
  <h1 class="prompt type" style="--n:0">login</h1>
  <form class="tree" method="post" action="/login">
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <div class="field type" style="--n:1">
      <label for="password">password:</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    </div>
    <button class="btn btn-hi type" type="submit" style="--n:2">enter</button>
  </form>
  <span class="cursor" aria-hidden="true"></span>
</main>`,
  );
}

// ---------- Routes ----------

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const admin = isValidSession(parseCookies(req)[COOKIE_NAME]);

  if (req.method === 'GET' && pathname === '/') {
    return send(res, 200, renderHome({ admin }));
  }

  if (req.method === 'GET' && pathname === '/login') {
    return admin ? redirect(res, '/') : send(res, 200, renderLogin());
  }

  if (req.method === 'POST' && pathname === '/login') {
    if (tooManyFailedLogins()) {
      return send(res, 429, renderLogin('Too many attempts. Try again in a few minutes.'));
    }
    const form = await readForm(req);
    if (!safeEqual(form.get('password') || '', ADMIN_PASSWORD)) {
      failedLogins.push(Date.now());
      return send(res, 401, renderLogin('Incorrect password.'));
    }
    return redirect(res, '/', { 'Set-Cookie': sessionCookie(req, createSessionToken(), SESSION_MAX_AGE) });
  }

  if (req.method === 'POST' && pathname === '/logout') {
    return redirect(res, '/', { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (req.method === 'POST' && pathname === '/links') {
    if (!admin) return redirect(res, '/login');
    const form = await readForm(req);
    const category = (form.get('category') || '').trim().slice(0, 50);
    const name = (form.get('name') || '').trim().slice(0, 80);
    const rawUrl = form.get('url') || '';
    const url = normalizeUrl(rawUrl);
    const error = !category
      ? 'Please enter a category.'
      : !name
        ? 'Please enter a name.'
        : !url
          ? 'Please enter a valid http(s) link.'
          : '';
    if (error) {
      return send(res, 400, renderHome({ admin, error, values: { category, name, url: rawUrl } }));
    }
    links.push({ id: crypto.randomUUID(), category: canonicalCategory(category), name, url, createdAt: new Date().toISOString() });
    saveLinks();
    return redirect(res, '/');
  }

  const deleteMatch = pathname.match(/^\/links\/([\w-]+)\/delete$/);
  if (req.method === 'POST' && deleteMatch) {
    if (!admin) return redirect(res, '/login');
    links = links.filter((l) => l.id !== deleteMatch[1]);
    saveLinks();
    return redirect(res, '/');
  }

  send(res, 404, layout('Not found', '<main class="login"><h1 class="prompt">not found</h1><p><a class="btn btn-hi" href="/">cd ~</a></p></main>'));
}

http
  .createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, err.status || 500, layout('Error', '<main class="login"><h1 class="prompt">something went wrong</h1></main>'));
    }
  })
  .listen(PORT, () => {
    console.log(`Tools page running at http://localhost:${PORT}`);
  });
