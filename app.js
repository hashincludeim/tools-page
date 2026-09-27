'use strict';

// Where the links live. Change these if the repo is renamed or moved.
const REPO = { owner: 'hashincludeim', name: 'tools-page', branch: 'main', path: 'links.json' };

const CONTENTS_API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${REPO.path}`;
const TOKEN_KEY = 'tools-page:github-token';

// ---------- Token (kept in this browser only) ----------

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

// ---------- GitHub API ----------

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function apiMessage(status) {
  if (status === 401) return 'github rejected the token. log in again.';
  if (status === 403 || status === 404) return "the token can't edit this repo. give it contents: read and write access.";
  if (status === 409 || status === 422) return 'the links changed somewhere else. reload and try again.';
  return `github returned an error (${status}).`;
}

async function api(url, token, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers, body, cache: 'no-store' });
  } catch {
    throw new ApiError(0, "couldn't reach github. check your connection.");
  }
  if (!res.ok) throw new ApiError(res.status, apiMessage(res.status));
  return res.json();
}

// The API sends file contents as base64; these keep non-ASCII names (é, ü, emoji) intact.
function decodeBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function encodeBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function fetchLinksFromGitHub(token) {
  const file = await api(`${CONTENTS_API}?ref=${REPO.branch}`, token);
  return { links: JSON.parse(decodeBase64(file.content)), sha: file.sha };
}

async function saveLinksToGitHub(token, links, sha, message) {
  const content = encodeBase64(`${JSON.stringify(links, null, 2)}\n`);
  await api(CONTENTS_API, token, { method: 'PUT', body: JSON.stringify({ message, content, sha, branch: REPO.branch }) });
}

// Only tokens from the repo owner's account are accepted.
async function tokenBelongsToOwner(token) {
  const user = await api('https://api.github.com/user', token);
  return user.login.toLowerCase() === REPO.owner.toLowerCase();
}

// The published copy of links.json; the query string skips the CDN cache.
async function fetchPublishedLinks() {
  const res = await fetch(`${REPO.path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`links.json returned ${res.status}`);
  return res.json();
}

// ---------- Helpers ----------

function normalizeUrl(input) {
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  return safeHref(value);
}

function safeHref(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// Categories appear in the order they were first used; links keep the order they were added.
function groupByCategory(links) {
  const groups = new Map();
  for (const link of links) {
    const key = link.category.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: link.category, links: [] });
    groups.get(key).links.push(link);
  }
  return [...groups.values()];
}

// Reuse an existing category's spelling so "finance" joins "Finance".
function canonicalCategory(links, input) {
  const match = links.find((l) => l.category.toLowerCase() === input.toLowerCase());
  return match ? match.category : input;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.classList.toggle('is-error', isError);
  status.hidden = !message;
}

// ---------- Home page ----------

const home = { token: null, rendered: false };

function renderLinks(links, admin) {
  const root = document.getElementById('links');
  // Only the first render types itself in; later updates appear instantly.
  root.classList.toggle('no-anim', home.rendered);
  home.rendered = true;

  const groups = groupByCategory(links);
  let n = admin ? 5 : 0; // typing order continues after the add panel's five lines

  root.replaceChildren(
    ...groups.map((group, i) => {
      const title = el('h2', { className: 'type', textContent: group.name });
      title.style.setProperty('--n', n++);
      const heading = admin ? el('div', { className: 'cat-head' }, [title, ...moveButtons(group, i, groups.length)]) : title;

      const items = group.links
        .filter((link) => safeHref(link.url))
        .map((link) => {
          const a = el('a', { className: 'type', href: safeHref(link.url), target: '_blank', rel: 'noopener noreferrer', textContent: link.name });
          a.style.setProperty('--n', n++);
          return el('li', { className: 'link' }, admin ? [a, deleteButton(link)] : [a]);
        });

      return el('section', { className: 'cat' }, [heading, el('ul', { className: 'tree' }, items)]);
    }),
  );

  if (!groups.length) {
    root.append(el('p', { className: 'empty', textContent: admin ? 'add your first link above.' : 'nothing here yet.' }));
  }
  if (admin) {
    document.getElementById('categories').replaceChildren(...groups.map((g) => el('option', { value: g.name })));
  }
}

function moveButtons(group, index, count) {
  const make = (label, offset, disabled) => {
    const direction = offset < 0 ? 'up' : 'down';
    const button = el('button', { type: 'button', className: 'btn btn-move', textContent: label, disabled });
    button.setAttribute('aria-label', `Move ${group.name} ${direction}`);
    button.addEventListener('click', () => saveChange((links) => moveCategory(links, group.name, offset), `Move category ${direction}: ${group.name}`));
    return button;
  };
  return [make('↑', -1, index === 0), make('↓', 1, index === count - 1)];
}

// Categories are ordered by where their links sit in links.json, so moving one
// regroups the list with that category swapped with its neighbour.
function moveCategory(links, name, offset) {
  const groups = groupByCategory(links);
  const from = groups.findIndex((g) => g.name.toLowerCase() === name.toLowerCase());
  const to = from + offset;
  if (from < 0 || to < 0 || to >= groups.length) return links;
  [groups[from], groups[to]] = [groups[to], groups[from]];
  return groups.flatMap((g) => g.links);
}

function deleteButton(link) {
  const button = el('button', { type: 'button', className: 'btn btn-rm', textContent: 'rm' });
  button.setAttribute('aria-label', `Delete ${link.name}`);
  let disarm;

  button.addEventListener('click', () => {
    if (!button.classList.contains('armed')) {
      button.classList.add('armed');
      button.textContent = 'sure?';
      disarm = setTimeout(() => {
        button.classList.remove('armed');
        button.textContent = 'rm';
      }, 3000);
      return;
    }
    clearTimeout(disarm);
    saveChange((links) => links.filter((l) => l.id !== link.id), `Remove link: ${link.name}`);
  });
  return button;
}

// Applies a change to the latest links on GitHub, so nothing saved elsewhere is overwritten.
async function saveChange(change, message) {
  const panel = document.getElementById('add-panel');
  const list = document.getElementById('links');
  panel.inert = list.inert = true;
  showStatus('saving…');
  try {
    const { links, sha } = await fetchLinksFromGitHub(home.token);
    const next = change(links);
    await saveLinksToGitHub(home.token, next, sha, message);
    renderLinks(next, true);
    showStatus('saved. visitors will see it in about a minute.');
    return true;
  } catch (err) {
    if (err.status === 401) {
      clearToken();
      location.href = 'login.html?expired';
      return false;
    }
    showStatus(err.message, true);
    return false;
  } finally {
    panel.inert = list.inert = false;
  }
}

function setUpAddForm() {
  const form = document.getElementById('add-form');
  const category = document.getElementById('category');
  const name = document.getElementById('name');
  const url = document.getElementById('url');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = { category: category.value.trim().slice(0, 50), name: name.value.trim().slice(0, 80), url: normalizeUrl(url.value) };
    const error = !values.category
      ? 'please enter a category.'
      : !values.name
        ? 'please enter a name.'
        : !values.url
          ? 'please enter a valid http(s) link.'
          : '';
    if (error) return showStatus(error, true);

    const saved = await saveChange(
      (links) => [
        ...links,
        { id: crypto.randomUUID(), category: canonicalCategory(links, values.category), name: values.name, url: values.url, createdAt: new Date().toISOString() },
      ],
      `Add link: ${values.name}`,
    );
    // Keep the category filled in, so adding several links to one category is quick.
    if (saved) {
      name.value = '';
      url.value = '';
      name.focus();
    }
  });
}

async function initHome() {
  home.token = getToken();
  const admin = Boolean(home.token);

  document.getElementById('login-link').hidden = admin;
  document.getElementById('logout').hidden = !admin;
  document.getElementById('add-panel').hidden = !admin;
  document.getElementById('logout').addEventListener('click', () => {
    clearToken();
    location.reload();
  });

  let links = [];
  if (admin) {
    setUpAddForm();
    try {
      // Straight from GitHub, so edits show immediately rather than after the site rebuilds.
      ({ links } = await fetchLinksFromGitHub(home.token));
    } catch (err) {
      if (err.status === 401) {
        clearToken();
        location.href = 'login.html?expired';
        return;
      }
      showStatus(err.message, true);
      links = await fetchPublishedLinks().catch(() => []);
    }
  } else {
    links = await fetchPublishedLinks().catch(() => []);
  }
  renderLinks(links, admin);
}

// ---------- Login page ----------

function initLogin() {
  if (getToken()) {
    location.replace('./');
    return;
  }
  const form = document.getElementById('login-form');
  const input = document.getElementById('password');

  if (new URLSearchParams(location.search).has('expired')) {
    showStatus('your password expired. log in with a new one.', true);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = input.value.trim();
    if (!token) return showStatus('enter your password first.', true);

    form.inert = true;
    showStatus('checking…');
    try {
      if (!(await tokenBelongsToOwner(token))) {
        showStatus('incorrect password.', true);
      } else if (!setToken(token)) {
        showStatus("this browser won't let the site remember you. is it in private mode?", true);
      } else {
        location.replace('./');
        return;
      }
    } catch (err) {
      showStatus(err.status === 401 ? 'incorrect password.' : err.message, true);
    } finally {
      form.inert = false;
    }
  });
}

if (document.body.dataset.page === 'login') initLogin();
else initHome();
