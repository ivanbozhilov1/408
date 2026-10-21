// Scoped shared shortlist access. This file contains no access credentials.
(() => {
  'use strict';
  const API = __PICKS_API__;
  const CATALOG = __PICKS_CATALOG__;
  const board = __PICKS_BOARD__;
  const local = window.unit408Picks;
  if (!local) return;
  const ACCESS = 'unit408-shared-access-v1';
  const OPS = 'unit408-shared-op-v1:';
  const CACHE = 'unit408-shared-cache-v1:';
  const MIGRATED = 'unit408-shared-migrated-v1:';
  const entries = new Map(CATALOG.map(item => [item.id, item]));
  const memory = new Map();
  let session = null, scope = '', remote = new Set(), revision = -1, running = false, epoch = 0;
  let storageAvailable = true, hasSnapshot = false;
  const panel = document.createElement('div');
  panel.className = 'picks-sync';
  panel.innerHTML = '<strong>Isah’s shared picks</strong><p data-sync-status role="status" aria-live="polite">Open your private access link once to connect. Until then, your stars stay in this browser.</p><details data-sync-setup><summary>Connect shared picks</summary><label>Private access code <input type="password" autocomplete="off" data-sync-code></label><button type="button" data-sync-connect>Connect</button></details><button type="button" data-sync-disconnect hidden>Disconnect</button><div data-sync-other></div>';
  document.querySelector('#picks .section-heading').after(panel);
  const status = panel.querySelector('[data-sync-status]');
  const setup = panel.querySelector('[data-sync-setup]');
  const disconnect = panel.querySelector('[data-sync-disconnect]');
  const other = panel.querySelector('[data-sync-other]');
  const introduction = document.querySelector('#picks .section-heading > p');
  const originalIntroduction = introduction?.innerHTML;
  const say = message => { status.textContent = message; };
  function readAccess() {
    try { return JSON.parse(localStorage.getItem(ACCESS) || 'null'); } catch { return null; }
  }
  function persistAccess() {
    try {
      const prior = JSON.parse(localStorage.getItem(MIGRATED + scope) || '{}');
      session.migrated = {...prior, ...session.migrated};
      localStorage.setItem(MIGRATED + scope, JSON.stringify(session.migrated));
      localStorage.setItem(ACCESS, JSON.stringify({token: session.token, role: session.role}));
    } catch { storageAvailable = false; }
  }
  function pending() {
    const all = new Map(memory);
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key.startsWith(OPS)) continue;
        try {
          const operation = JSON.parse(localStorage.getItem(key));
          if (operation?.scope === scope && entries.has(operation.id) && typeof operation.starred === 'boolean' && typeof operation.operationId === 'string') all.set(operation.operationId, operation);
        } catch { /* Ignore corrupt local entries, without changing other data. */ }
      }
    } catch { storageAvailable = false; }
    return [...all.values()].filter(operation => operation.scope === scope).sort((a, b) => a.queuedAt - b.queuedAt || a.operationId.localeCompare(b.operationId));
  }
  function enqueue(id, starred) {
    const operation = { id, starred, operationId: crypto.randomUUID(), scope, queuedAt: Date.now() };
    memory.set(operation.operationId, operation);
    try { localStorage.setItem(OPS + operation.operationId, JSON.stringify(operation)); } catch { storageAvailable = false; }
  }
  function acknowledge(operation) {
    memory.delete(operation.operationId);
    try { localStorage.removeItem(OPS + operation.operationId); } catch { storageAvailable = false; }
  }
  function paint() {
    const all = new Set(remote);
    for (const operation of pending()) {
      if (operation.starred) all.add(operation.id); else all.delete(operation.id);
    }
    local.set([...all].filter(id => id.startsWith(board + ':')).map(id => id.slice(board.length + 1)));
    local.readonly(session?.role !== 'editor');
    other.replaceChildren();
    const elsewhere = [...all].map(id => entries.get(id)).filter(item => item && item.board !== board);
    if (elsewhere.length) {
      const heading = document.createElement('h3');
      heading.textContent = `Also starred in other sets (${elsewhere.length})`;
      const ul = document.createElement('ul');
      for (const item of elsewhere) {
        const li = document.createElement('li'), link = document.createElement('a');
        link.href = item.url;
        link.textContent = `${item.label} · ${item.name}`;
        li.append(link); ul.append(li);
      }
      other.append(heading, ul);
    }
    panel.dataset.total = String(all.size);
  }
  async function request(method = 'GET', operation = null) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    const token = session.token;
    try {
      const response = await fetch(API, {
        method, cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(operation ? { 'Content-Type': 'application/json' } : {}) },
        ...(operation ? { body: JSON.stringify({ id: operation.id, starred: operation.starred, operationId: operation.operationId }) } : {})
      });
      if (!response.ok) {
        const failure = new Error('Shared picks unavailable'); failure.status = response.status; throw failure;
      }
      const value = await response.json();
      if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.picks) || !value.picks.every(id => typeof id === 'string') || !['editor', 'viewer'].includes(value.role)) throw new Error('Invalid shared response');
      return value;
    } finally { clearTimeout(timer); }
  }
  function accept(value) {
    if (value.revision >= revision) {
      remote = new Set(value.picks); revision = value.revision; hasSnapshot = true;
      try { localStorage.setItem(CACHE + scope, JSON.stringify({picks: [...remote], revision})); } catch { storageAvailable = false; }
    }
    session.role = value.role;
  }
  async function refresh() {
    if (!session || running) return;
    const turn = epoch;
    running = true;
    try {
      const value = await request();
      if (turn !== epoch) return;
      accept(value);
      // Another tab may have enrolled and then removed a star while this request was waiting.
      try { session.migrated = {...session.migrated, ...JSON.parse(localStorage.getItem(MIGRATED + scope) || '{}')}; } catch { /* Keep the current markers if storage is unavailable. */ }
      if (session.role === 'editor' && !session.migrated[board]) {
        // Merge this browser's existing stars once; never replace a remote list with a local snapshot.
        for (const id of session.localAtConnect) {
          const wire = `${board}:${id}`;
          if (entries.has(wire) && !remote.has(wire) && !pending().some(operation => operation.id === wire)) enqueue(wire, true);
        }
        session.migrated[board] = true;
      }
      persistAccess(); paint();
      if (introduction) introduction.textContent = session.role === 'editor'
        ? 'Your stars sync automatically to Isah’s shared shortlist. Ivan can see the updates in his viewing page. Picks from other design sets also appear below.'
        : 'Isah’s stars update here automatically. Picks from other design sets also appear below. This viewing page is read-only.';
      if (session.role === 'editor') {
        for (const operation of pending()) {
          const saved = await request('PUT', operation);
          if (turn !== epoch) return;
          acknowledge(operation); accept(saved); paint();
        }
      }
      setup.hidden = true; disconnect.hidden = false;
      say(`${session.role === 'editor' ? 'Connected as Isah · edits sync automatically' : 'Viewing Isah’s picks · read-only · updates automatically'}${pending().length ? ` · ${pending().length} changes waiting` : ' · Synced'}${storageAvailable ? '' : ' · Browser storage is unavailable; keep this page open'}`);
    } catch (failure) {
      if (turn !== epoch) return;
      if (failure.status === 401 || failure.status === 403) {
        session.role = null; local.readonly(true); setup.hidden = false; setup.open = true;
        say('This access link is unavailable. Reconnect with your private access code. Your queued stars are kept.');
      } else {
        local.readonly(session.role !== 'editor');
        say(`Offline — ${pending().length ? `${pending().length} changes waiting to sync` : hasSnapshot ? 'showing the last loaded picks' : 'shared picks have not loaded yet'}. Retrying automatically.${storageAvailable ? '' : ' Keep this page open to preserve unsaved changes.'}`);
      }
    } finally {
      running = false;
      // A click can arrive while the last request is completing.
      if (turn !== epoch && session) void refresh();
    }
  }
  async function connect(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { say('Use the private access link or its complete access code.'); return; }
    const prior = readAccess();
    const turn = ++epoch; revision = -1; remote = new Set(); hasSnapshot = false;
    session = { token, role: prior?.token === token ? prior.role : null, migrated: {}, localAtConnect: local.get() };
    local.managed(true); local.readonly(true);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    if (turn !== epoch) return;
    scope = [...new Uint8Array(digest)].slice(0,16).map(value => value.toString(16).padStart(2, '0')).join('');
    try {
      session.migrated = JSON.parse(localStorage.getItem(MIGRATED + scope) || '{}');
      const cached = JSON.parse(localStorage.getItem(CACHE + scope) || 'null');
      if (cached && Number.isSafeInteger(cached.revision) && Array.isArray(cached.picks)) {
        remote = new Set(cached.picks.filter(id => typeof id === 'string')); revision = cached.revision; hasSnapshot = true;
      }
    } catch { /* A corrupt cache cannot replace server data. */ }
    if (hasSnapshot || pending().length) paint();
    persistAccess(); say('Connecting to Isah’s shared picks…');
    await refresh();
  }
  window.addEventListener('unit408:picks-change', event => {
    if (session?.role !== 'editor') return;
    for (const change of event.detail) {
      const id = `${board}:${change.id}`;
      if (entries.has(id)) enqueue(id, change.starred);
    }
    paint(); say(`${pending().length} changes waiting to sync${storageAvailable ? '…' : ' — keep this page open; browser storage is unavailable'}`);
    void refresh();
  });
  panel.querySelector('[data-sync-connect]').addEventListener('click', () => {
    const input = panel.querySelector('[data-sync-code]'), token = input.value.trim(); input.value = ''; void connect(token);
  });
  function stopConnection(removeAccess = true) {
    epoch++; session = null; scope = ''; remote.clear();
    if (removeAccess) { try { localStorage.removeItem(ACCESS); } catch { /* No persistent access to remove. */ } }
    local.managed(false); local.restore(); local.readonly(false);
    if (introduction) introduction.innerHTML = originalIntroduction;
    other.replaceChildren(); setup.hidden = false; disconnect.hidden = true;
    say('Disconnected. Your original browser stars are restored. Reopen your private link to reconnect.');
  }
  disconnect.addEventListener('click', () => stopConnection());
  window.addEventListener('storage', event => {
    if (event.key === ACCESS) {
      const saved = readAccess();
      if (saved?.token && saved.token !== session?.token) void connect(saved.token);
      else if (!saved?.token && session) stopConnection(false);
    } else if (session && event.key?.startsWith(OPS)) { paint(); void refresh(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('online', () => void refresh());
  setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
  function importAccess() {
    const supplied = /^#sync=([^&]*)$/.exec(location.hash);
    if (!supplied) return false;
    history.replaceState(null, '', location.pathname + location.search + '#picks');
    void connect(supplied[1]);
    return true;
  }
  window.addEventListener('hashchange', importAccess);
  if (!importAccess()) {
    const saved = readAccess(); if (saved?.token) void connect(saved.token);
  }
})();
