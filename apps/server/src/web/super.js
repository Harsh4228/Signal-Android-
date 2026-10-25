// CellMate server owner page: approve companies, add companies, move people between them.
// Plain browser JavaScript, no libraries. Everything shown is built with DOM nodes (no HTML from data),
// except the QR picture, which this server itself generated.
'use strict';

const app = document.getElementById('app');
const who = document.getElementById('who');
const TOKEN = 'cellmate-super-token';
let token = null;
try {
  token = sessionStorage.getItem(TOKEN);
} catch {
  // storage blocked: sign in each time
}
let companies = [];
const openPeople = new Set();

/** h('div', { class: 'x', onclick: fn }, child, 'text', ...) */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function saveToken(t) {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN, t);
    else sessionStorage.removeItem(TOKEN);
  } catch {
    // ignore
  }
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/v1/super/session' && path !== '/v1/super/setup') {
    saveToken(null);
    showLogin('You were signed out. Sign in again.');
    throw new Error('signed out');
  }
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? JSON.parse(text) : null;
}

const idOf = (username) => (username.lastIndexOf('-') < 0 ? username : username.slice(0, username.lastIndexOf('-')));

// ------------------------------------------------------------------ sign in

async function start() {
  if (token) return load().catch(() => showLogin());
  const config = await fetch('/v1/config').then((r) => r.json(), () => ({}));
  if (config.needsSetup) showSetup();
  else showLogin();
}

/** First visit: create the owner account. The one-time setup code is in the server log. */
function showSetup() {
  who.replaceChildren();
  const err = h('div', { class: 'error', hidden: true });
  const code = h('input', { autocomplete: 'off', autocapitalize: 'none' });
  const id = h('input', { autocomplete: 'username', placeholder: 'e.g. harsh', autocapitalize: 'none' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Create owner account');
  const form = h(
    'form',
    {
      class: 'card stack',
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (pw.value !== pw2.value) {
          err.textContent = 'The two passwords are different';
          err.hidden = false;
          return;
        }
        btn.disabled = true;
        const username = id.value.trim().toLowerCase();
        try {
          await api('POST', '/v1/super/setup', { code: code.value.trim(), username, password: pw.value });
          const r = await api('POST', '/v1/super/session', { username, password: pw.value });
          saveToken(r.token);
          await load();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        } finally {
          btn.disabled = false;
        }
      },
    },
    h('h1', {}, 'Set up the owner account'),
    h('div', { class: 'muted small' }, 'You own this CellMate server: you create the companies that may use it. You sign in here with this ID and password (no company code).'),
    h('label', {}, 'Setup code', code, h('span', { class: 'muted small' }, 'Shown once in the server log ("Owner setup: … setup code …").')),
    h('label', {}, 'Your ID', id),
    h('label', {}, 'Password (at least 8 characters)', pw),
    h('label', {}, 'Confirm password', pw2),
    err,
    btn,
  );
  app.replaceChildren(h('div', { class: 'login' }, form));
  code.focus();
}

function showLogin(message) {
  who.replaceChildren();
  const err = h('div', { class: 'error', hidden: !message }, message || '');
  const id = h('input', { autocomplete: 'username', placeholder: 'e.g. harsh', autocapitalize: 'none' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Sign in');
  const form = h(
    'form',
    {
      class: 'card stack',
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        try {
          const r = await api('POST', '/v1/super/session', { username: id.value.trim().toLowerCase(), password: pw.value });
          saveToken(r.token);
          pw.value = '';
          await load();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        } finally {
          btn.disabled = false;
        }
      },
    },
    h('h1', {}, 'Server owner sign-in'),
    h('div', { class: 'muted small' }, 'Create companies, approve requests and move people between companies.'),
    h('label', {}, 'Owner ID', id),
    h('label', {}, 'Password', pw),
    err,
    btn,
  );
  app.replaceChildren(h('div', { class: 'login' }, form));
  id.focus();
}

async function signOut() {
  await api('DELETE', '/v1/super/session').catch(() => {});
  saveToken(null);
  showLogin();
}

// ------------------------------------------------------------------ dialogs

function dialog(...content) {
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'overlay', onclick: (e) => e.target === overlay && close() }, h('div', { class: 'card stack' }, ...content(close)));
  document.body.append(overlay);
  return close;
}

/** The QR invite the person scans in the CellMate app (then they only choose a password). */
function showInvite(title, text, r, login) {
  const qr = h('div', { class: 'qr' });
  qr.innerHTML = r.qrSvg; // generated by this server from the invite code
  const copy = h('button', {}, 'Copy invite code');
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(r.code).catch(() => {});
    copy.textContent = 'Copied';
  });
  dialog((close) => [
    h('div', { class: 'title' }, title),
    h('div', { class: 'note' }, text),
    login
      ? h('div', { class: 'code' }, `Company code: ${login.code}
Admin ID: ${login.id}
Temporary password: ${login.password}`)
      : null,
    login ? h('div', { class: 'muted small' }, 'They sign in with these in the CellMate app and must then choose their own password. Or they scan this QR:') : null,
    h('div', { class: 'row center' }, qr),
    h('div', { class: 'muted small' }, `Works once, until ${new Date(r.invite?.expires ?? r.expires).toLocaleString()}. Anyone with it can set up the account: show it in person or send it privately.`),
    h('div', { class: 'code' }, r.code),
    h('div', { class: 'row' }, copy, h('button', { class: 'primary', onclick: close }, 'Done')),
  ]);
}

function ask(title, fields, submitText, onSubmit) {
  const err = h('div', { class: 'error', hidden: true });
  const inputs = fields.map((f) =>
    f.options
      ? h('select', {}, ...f.options.map(([v, label]) => h('option', { value: v }, label)))
      : h('input', { value: f.value || '', placeholder: f.placeholder || '', autocapitalize: 'none' }),
  );
  const btn = h('button', { class: 'primary', type: 'submit' }, submitText);
  dialog((close) => [
    h(
      'form',
      {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          btn.disabled = true;
          try {
            await onSubmit(inputs.map((i) => i.value.trim()));
            close();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
          } finally {
            btn.disabled = false;
          }
        },
      },
      h('div', { class: 'title' }, title),
      ...fields.map((f, i) => h('label', {}, f.label, inputs[i], f.hint ? h('span', { class: 'muted small' }, f.hint) : null)),
      err,
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: close }, 'Cancel'), btn),
    ),
  ]);
  inputs[0]?.focus();
}

function confirmThen(text, fn) {
  if (window.confirm(text)) fn().catch((e) => window.alert(e.message));
}

// ------------------------------------------------------------------ pages

async function load() {
  const r = await api('GET', '/v1/super/companies');
  companies = r.companies;
  render();
}

function render() {
  who.replaceChildren(h('button', { class: 'link', onclick: () => void signOut() }, 'Sign out'));
  const waiting = companies.filter((c) => c.status === 'pending');
  const others = companies.filter((c) => c.status !== 'pending');
  app.replaceChildren(
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', {}, 'Companies'), h('div', { class: 'muted small' }, 'Admins of each company manage their own people. You decide which companies may use this server.')),
      h('button', { class: 'primary', onclick: newCompany }, '+ New company'),
      h('button', { onclick: () => void load() }, 'Refresh')),
    h(
      'div',
      { class: 'stats' },
      stat('Active companies', companies.filter((c) => c.status === 'active').length, 'active'),
      stat('Waiting for approval', waiting.length, 'pending'),
      stat('Suspended', companies.filter((c) => c.status === 'suspended').length, 'suspended'),
      stat('People in all companies', companies.reduce((n, c) => n + c.users, 0), 'plain'),
    ),
    h('h2', {}, `Waiting for approval (${waiting.length})`),
    waiting.length ? h('div', {}, ...waiting.map(companyCard)) : h('div', { class: 'muted small' }, 'No requests. People ask for a company with "Register your company" in the app.'),
    h('h2', {}, `All companies (${others.length})`),
    h('div', {}, ...others.map(companyCard)),
  );
}

function stat(label, value, kind) {
  return h('div', { class: `card stat ${kind}` }, h('div', { class: 'stat-value' }, String(value)), h('div', { class: 'muted small' }, label));
}

function companyCard(c) {
  const actions = [];
  if (c.status === 'pending') {
    actions.push(
      h('button', { class: 'ok', onclick: () => confirmThen(`Approve "${c.name}"? Its admin can start using CellMate at once.`, async () => {
        await api('PUT', `/v1/super/companies/${c.code}/status`, { status: 'active' });
        await load();
      }) }, 'Approve'),
      h('button', { class: 'danger', onclick: () => confirmThen(`Turn down "${c.name}"? The company and its account are deleted.`, async () => {
        await api('DELETE', `/v1/super/companies/${c.code}`);
        await load();
      }) }, 'Turn down'),
    );
  } else if (c.status === 'suspended') {
    actions.push(h('button', { class: 'ok', onclick: () => confirmThen(`Let "${c.name}" use CellMate again?`, async () => {
      await api('PUT', `/v1/super/companies/${c.code}/status`, { status: 'active' });
      await load();
    }) }, 'Resume'));
  } else {
    actions.push(h('button', { class: 'danger', onclick: () => confirmThen(`Suspend "${c.name}"? Everyone in it is signed out and can't connect until you resume it. Nothing is deleted.`, async () => {
      await api('PUT', `/v1/super/companies/${c.code}/status`, { status: 'suspended' });
      await load();
    }) }, 'Suspend'));
  }
  actions.push(h('button', { onclick: () => ask(`Rename ${c.code}`, [{ label: 'Company name', value: c.name }], 'Save', async ([name]) => {
    await api('PUT', `/v1/super/companies/${c.code}`, { name });
    await load();
  }) }, 'Rename'));
  const open = openPeople.has(c.code);
  actions.push(h('button', { onclick: () => {
    if (open) openPeople.delete(c.code);
    else openPeople.add(c.code);
    render();
  } }, open ? 'Hide people' : `People (${c.users})`));

  const card = h('div', { class: 'card company' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('span', { class: 'title' }, c.name), ' ', h('span', { class: 'muted small' }, `code: ${c.code}`)),
      h('span', { class: `pill ${c.status}` }, c.status === 'pending' ? 'Waiting' : c.status === 'active' ? 'Active' : 'Suspended')),
    h('div', { class: 'muted small' }, `${c.users} ${c.users === 1 ? 'person' : 'people'} · admins: ${c.admins.map(idOf).join(', ') || 'none'} · since ${new Date(c.createdAt).toLocaleDateString()}`),
    h('div', { class: 'row' }, ...actions),
  );
  if (open) {
    const box = h('div', { class: 'people' }, h('div', { class: 'muted small' }, 'Loading…'));
    card.append(box);
    void api('GET', `/v1/super/companies/${c.code}/users`).then((r) => box.replaceChildren(...peopleList(c, r.users)), (e) => box.replaceChildren(h('div', { class: 'error' }, e.message)));
  }
  return card;
}

function peopleList(c, users) {
  if (!users.length) return [h('div', { class: 'muted small' }, 'Nobody yet.')];
  return users.map((u) => {
    const tags = [];
    if (u.admin) tags.push(h('span', { class: 'pill active' }, 'Admin'));
    if (u.moved) tags.push(h('span', { class: 'pill plain' }, 'Moved away'));
    if (u.banned) tags.push(h('span', { class: 'pill suspended' }, 'Blocked'));
    if (!u.active && !u.moved) tags.push(h('span', { class: 'pill pending' }, 'Not signed in yet'));
    const buttons = [];
    if (!u.moved) {
      buttons.push(h('button', { onclick: () => moveDialog(c, u) }, 'Move to…'));
      if (!u.banned) buttons.push(h('button', { onclick: async () => {
        try {
          const r = await api('POST', `/v1/super/companies/${c.code}/invite`, { username: u.username });
          showInvite(`New QR for ${u.name || idOf(u.username)}`, 'Their old phone stops working once they use this.', r);
        } catch (e) {
          window.alert(e.message);
        }
      } }, 'New QR'));
    }
    return h('div', { class: 'person' }, h('div', { class: 'grow' }, h('b', {}, u.name || idOf(u.username)), ' ', h('span', { class: 'muted small' }, `@${idOf(u.username)}`)), ...tags, ...buttons);
  });
}

function moveDialog(c, u) {
  const targets = companies.filter((x) => x.code !== c.code && x.status !== 'pending');
  if (!targets.length) return window.alert('There is no other approved company to move them to.');
  ask(
    `Move ${u.name || idOf(u.username)}`,
    [
      { label: 'To company', options: targets.map((t) => [t.code, `${t.name} (${t.code})`]) },
      { label: 'Their ID there', value: idOf(u.username), hint: 'Change it if that ID is already taken there.' },
    ],
    'Move',
    async ([to, id]) => {
      const r = await api('POST', '/v1/super/transfer', { username: u.username, to, id });
      await load();
      showInvite(
        r.returning ? 'Back to their old account' : 'Moved',
        `${u.name || idOf(u.username)} now belongs to ${to}${r.returning ? ': their old account there opens again with its groups and settings' : ''}. In the app they scan this QR and choose a password; their chats stay on their phone. Their account in ${c.code} is kept, closed.`,
        r,
      );
    },
  );
}

function newCompany() {
  ask(
    'New company',
    [
      { label: 'Company name', placeholder: 'e.g. Acme Pvt Ltd' },
      { label: 'Company code', placeholder: 'e.g. acme', hint: '2-16 letters/digits. People type it when they sign in. It cannot be changed later.' },
      { label: 'First admin: ID', placeholder: 'e.g. ravi' },
      { label: 'First admin: full name', placeholder: 'e.g. Ravi Kumar' },
    ],
    'Create',
    async ([name, code, adminId, adminName]) => {
      const r = await api('POST', '/v1/super/companies', { name, code: code.toLowerCase(), adminId: adminId.toLowerCase(), adminName });
      await load();
      showInvite(
        `${name} created`,
        `Send these to ${adminName || adminId} privately. After signing in they add their own people from the Admin page of the app.`,
        r,
        { code: code.toLowerCase(), id: adminId.toLowerCase(), password: r.tempPassword },
      );
    },
  );
}

void start();
