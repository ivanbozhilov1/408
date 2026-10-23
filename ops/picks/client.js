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
  const rules = window.Unit408Preferences;
  const memory = new Map();
  let session = null, scope = '', remote = new Set(), revision = -1, running = false, epoch = 0;
  let excluded = new Map(), preferenceSchema = 1, exporting = false;
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
  const exclusionsPanel = document.createElement('div');
  exclusionsPanel.dataset.exclusions = '';
  const exportButton = document.createElement('button');
  exportButton.type = 'button'; exportButton.dataset.regeneration = '';
  exportButton.textContent = 'Prepare regeneration brief'; exportButton.disabled = true;
  const generationOptions = document.createElement('label'), unusedOnly = document.createElement('input');
  unusedOnly.type = 'checkbox'; unusedOnly.dataset.unusedOnly = '';
  generationOptions.append(unusedOnly, document.createTextNode(' Unused items only for the next design'));
  panel.append(exclusionsPanel, generationOptions, exportButton);
  const dialog = document.createElement('dialog');
  dialog.className = 'exclusion-dialog';
  dialog.innerHTML = '<form method="dialog"><h2 data-exclusion-title></h2><p>The same product and its family will be excluded across all sets. Also avoid any checked characteristic in this furniture category.</p><div data-exclusion-traits></div><label>Anything else to avoid?<textarea data-exclusion-note maxlength="500" rows="3" placeholder="For example: avoid chunky frames; prefer slim legs."></textarea></label><p>Written notes and visual resemblance must also be checked when creating the next design. Existing images stay unchanged.</p><button type="button" data-exclusion-save>Exclude item and similar pieces</button> <button value="cancel">Cancel</button></form>';
  document.body.append(dialog);
  let editingId = null;
  function effective() {
    const picks = new Set(remote), exclusions = new Map(excluded);
    for (const operation of pending()) {
      if (operation.decision === 'excluded') { picks.delete(operation.id); exclusions.set(operation.id, {id: operation.id, ...operation.exclusion}); }
      else if (operation.decision) {
        if (operation.restoreRevision !== undefined) exclusions.delete(operation.id);
        if (operation.decision === 'preferred' && !exclusions.has(operation.id)) picks.add(operation.id); else picks.delete(operation.id);
      } else if (operation.starred && !exclusions.has(operation.id)) picks.add(operation.id);
      else picks.delete(operation.id);
    }
    return {picks, exclusions};
  }
  function exclusionMatches(item, exclusions) {
    return [...exclusions.values()].flatMap(exclusion => {
      const match = rules.match(item, exclusion, CATALOG);
      return match.blocked ? match.reasons : [];
    });
  }
  function openExclusion(id) {
    if (session?.role !== 'editor' || preferenceSchema !== 2) return;
    editingId = id;
    const item = entries.get(id), current = effective().exclusions.get(id);
    dialog.querySelector('[data-exclusion-title]').textContent = `Exclude ${item.name}`;
    const choices = dialog.querySelector('[data-exclusion-traits]'); choices.replaceChildren();
    const traits = [...new Set([...rules.profile(item).traits, ...(current?.traits || [])])];
    const selected = new Set(current?.traits ?? rules.defaultTraits(item));
    for (const trait of traits) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = trait; input.checked = selected.has(trait);
      label.append(input, document.createTextNode(' ' + trait.replace(':', ': '))); choices.append(label);
    }
    if (!traits.length) choices.textContent = 'No reliable visual characteristics are listed for this item. Describe what you dislike below; the next design will require a manual similarity review.';
    dialog.querySelector('[data-exclusion-note]').value = current?.note || '';
    dialog.showModal();
  }
  dialog.querySelector('[data-exclusion-save]').addEventListener('click', () => {
    if (!editingId || session?.role !== 'editor' || preferenceSchema !== 2) return;
    const traits = [...dialog.querySelectorAll('input:checked')].map(input => input.value);
    if (traits.length > 16) { say('Choose up to 16 characteristics.'); return; }
    enqueue(editingId, 'excluded', {traits, note: dialog.querySelector('[data-exclusion-note]').value.trim()});
    dialog.close(); paint(); void refresh();
  });
  for (const row of document.querySelectorAll('tr[data-item-id]')) {
    const id = `${board}:${row.dataset.itemId}`;
    if (!entries.has(id)) continue;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'exclude-item'; button.dataset.exclude = id;
    button.textContent = 'Exclude'; button.disabled = true;
    button.title = 'Connect shared picks to save exclusions';
    button.addEventListener('click', () => openExclusion(id));
    const state = document.createElement('small'); state.dataset.exclusionState = '';
    (row.querySelector('[data-pick]')?.parentElement || row.lastElementChild).append(button, state);
  }
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
          if (operation?.scope === scope && entries.has(operation.id) && (typeof operation.starred === 'boolean' || ['preferred', 'neutral', 'excluded'].includes(operation.decision)) && typeof operation.operationId === 'string') all.set(operation.operationId, operation);
        } catch { /* Ignore corrupt local entries, without changing other data. */ }
      }
    } catch { storageAvailable = false; }
    return [...all.values()].filter(operation => operation.scope === scope).sort((a, b) => a.queuedAt - b.queuedAt || a.operationId.localeCompare(b.operationId));
  }
  function enqueue(id, decision, exclusion, restoreRevision) {
    const operation = { id, ...(typeof decision === 'boolean' ? {starred: decision} : {decision}), ...(exclusion ? {exclusion} : {}), ...(restoreRevision !== undefined ? {restoreRevision} : {}), operationId: crypto.randomUUID(), scope, queuedAt: Date.now() };
    memory.set(operation.operationId, operation);
    try { localStorage.setItem(OPS + operation.operationId, JSON.stringify(operation)); } catch { storageAvailable = false; }
  }
  function acknowledge(operation) {
    memory.delete(operation.operationId);
    try { localStorage.removeItem(OPS + operation.operationId); } catch { storageAvailable = false; }
  }
  function paint() {
    const {picks: all, exclusions} = effective();
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
    panel.dataset.excludedTotal = String(exclusions.size);
    exclusionsPanel.replaceChildren();
    if (exclusions.size) {
      const heading = document.createElement('h3'); heading.textContent = `Excluded (${exclusions.size})`;
      const list = document.createElement('ul');
      for (const exclusion of exclusions.values()) {
        const li = document.createElement('li'), item = entries.get(exclusion.id);
        const label = document.createElement('span');
        label.textContent = `${item?.name || exclusion.id} — same product and family${exclusion.traits.length ? '; avoid ' + exclusion.traits.join(', ') : '; visual similarity needs review'}${exclusion.note ? '. ' + exclusion.note : ''} `;
        li.append(label);
        if (item && session?.role === 'editor') {
          const edit = document.createElement('button'), restore = document.createElement('button');
          edit.type = restore.type = 'button'; edit.textContent = 'Edit'; restore.textContent = 'Restore';
          restore.dataset.restore = exclusion.id;
          edit.addEventListener('click', () => openExclusion(exclusion.id));
          restore.addEventListener('click', () => { enqueue(exclusion.id, 'neutral', undefined, revision); paint(); void refresh(); });
          li.append(edit, restore);
        }
        list.append(li);
      }
      exclusionsPanel.append(heading, list);
    }
    for (const button of document.querySelectorAll('[data-exclude]')) {
      const item = entries.get(button.dataset.exclude), row = button.closest('tr');
      const reasons = exclusionMatches(item, exclusions);
      button.disabled = session?.role !== 'editor' || preferenceSchema !== 2;
      button.textContent = exclusions.has(item.id) ? 'Edit exclusion' : 'Exclude';
      button.title = button.disabled ? 'Connect with editing access to save exclusions' : 'Exclude this product, its family and selected characteristics';
      row.querySelector('[data-exclusion-state]').textContent = reasons.length ? 'Excluded from next design: ' + [...new Set(reasons)].join('; ') : '';
      row.classList.toggle('item-excluded', reasons.length > 0);
      const star = row.querySelector('[data-pick]');
      if (star && reasons.length) star.disabled = true;
    }
    exportButton.disabled = !session || !hasSnapshot || preferenceSchema !== 2 || pending().length > 0 || running || exporting;
  }
  async function request(method = 'GET', operation = null) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    const token = session.token;
    try {
      const response = await fetch(API, {
        method, cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(operation ? { 'Content-Type': 'application/json' } : {}) },
        ...(operation ? { body: JSON.stringify({ id: operation.id, ...(operation.decision ? {decision: operation.decision, ...(operation.exclusion ? {exclusion: operation.exclusion} : {}), ...(operation.restoreRevision !== undefined ? {restoreRevision: operation.restoreRevision} : {})} : {starred: operation.starred}), operationId: operation.operationId }) } : {})
      });
      if (!response.ok) {
        const failure = new Error('Shared picks unavailable'); failure.status = response.status; throw failure;
      }
      const value = await response.json();
      if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.picks) || !value.picks.every(id => typeof id === 'string') || !['editor', 'viewer'].includes(value.role)) throw new Error('Invalid shared response');
      if (value.preferenceSchema === 2 && (!Array.isArray(value.exclusions) || !value.exclusions.every(item => typeof item.id === 'string' && Array.isArray(item.traits) && item.traits.every(trait => typeof trait === 'string') && typeof item.note === 'string'))) throw new Error('Invalid exclusions response');
      return value;
    } finally { clearTimeout(timer); }
  }
  function accept(value) {
    pullCache();
    if (value.revision >= revision) {
      remote = new Set(value.picks); revision = value.revision; hasSnapshot = true;
      preferenceSchema = value.preferenceSchema || 1;
      excluded = new Map((value.exclusions || []).map(item => [item.id, item]));
      try { localStorage.setItem(CACHE + scope, JSON.stringify({picks: [...remote], exclusions: [...excluded.values()], preferenceSchema, revision})); } catch { storageAvailable = false; }
    }
    session.role = value.role;
  }
  function pullCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE + scope) || 'null');
      if (cached?.preferenceSchema === 2 && Number.isSafeInteger(cached.revision) && cached.revision >= revision
          && Array.isArray(cached.picks) && cached.picks.every(id => typeof id === 'string')
          && Array.isArray(cached.exclusions) && cached.exclusions.every(item => typeof item.id === 'string' && Array.isArray(item.traits) && item.traits.every(trait => typeof trait === 'string') && typeof item.note === 'string')) {
        remote = new Set(cached.picks); excluded = new Map(cached.exclusions.map(item => [item.id, item]));
        revision = cached.revision; preferenceSchema = 2; hasSnapshot = true;
      }
    } catch { /* Cache is optional; only validated same-scope snapshots are used. */ }
  }
  async function refresh() {
    if (!session || running) return;
    const turn = epoch;
    let conflictNotice = '';
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
          if (entries.has(wire) && !remote.has(wire) && !exclusionMatches(entries.get(wire), excluded).length && !pending().some(operation => operation.id === wire)) enqueue(wire, true);
        }
        session.migrated[board] = true;
      }
      persistAccess(); paint();
      if (introduction) introduction.textContent = session.role === 'editor'
        ? 'Your stars sync automatically to Isah’s shared shortlist. Ivan can see the updates in his viewing page. Picks from other design sets also appear below.'
        : 'Isah’s stars update here automatically. Picks from other design sets also appear below. This viewing page is read-only.';
      if (session.role === 'editor') {
        for (const operation of pending()) {
          // Recheck queued positives against confirmed exclusions. A future
          // queued restore must not authorize an earlier preferred choice.
          pullCache();
          const positive = operation.decision ? operation.decision === 'preferred' : operation.starred === true;
          if (positive && exclusionMatches(entries.get(operation.id), excluded).length) {
            acknowledge(operation);
            conflictNotice = ' · An older preferred choice was not applied because it now matches an exclusion. The saved exclusion was kept.';
            paint(); continue;
          }
          let saved;
          try { saved = await request('PUT', operation); }
          catch (failure) {
            if (turn !== epoch) return;
            if (failure.status !== 409) throw failure;
            // A legacy retry cannot restore an excluded product; discard the conflicting operation.
            const current = await request();
            if (turn !== epoch) return;
            acknowledge(operation); accept(current); paint();
            conflictNotice = ' · An older change was not applied; the saved decision was kept. Retry Restore if needed.';
            continue;
          }
          if (turn !== epoch) return;
          acknowledge(operation); accept(saved); paint();
        }
      }
      setup.hidden = true; disconnect.hidden = false;
      say(`${session.role === 'editor' ? 'Connected as Isah · edits sync automatically' : 'Viewing Isah’s picks · read-only · updates automatically'}${pending().length ? ` · ${pending().length} changes waiting` : ' · Synced'}${storageAvailable ? '' : ' · Browser storage is unavailable; keep this page open'}${conflictNotice}`);
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
      if (session) paint();
      // A click can arrive while the last request is completing.
      if (turn !== epoch && session) void refresh();
    }
  }
  async function connect(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { say('Use the private access link or its complete access code.'); return; }
    const prior = readAccess();
    const turn = ++epoch; revision = -1; remote = new Set(); excluded = new Map(); preferenceSchema = 1; hasSnapshot = false;
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
        if (cached.preferenceSchema === 2 && Array.isArray(cached.exclusions)) {
          excluded = new Map(cached.exclusions.filter(item => typeof item.id === 'string' && Array.isArray(item.traits) && typeof item.note === 'string').map(item => [item.id, item])); preferenceSchema = 2;
        }
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
      if (entries.has(id)) {
        if (change.starred && exclusionMatches(entries.get(id), effective().exclusions).length) { paint(); say('Restore the matching exclusion before preferring this item.'); continue; }
        enqueue(id, preferenceSchema === 2 ? (change.starred ? 'preferred' : 'neutral') : change.starred);
      }
    }
    paint(); say(`${pending().length} changes waiting to sync${storageAvailable ? '…' : ' — keep this page open; browser storage is unavailable'}`);
    void refresh();
  });
  panel.querySelector('[data-sync-connect]').addEventListener('click', () => {
    const input = panel.querySelector('[data-sync-code]'), token = input.value.trim(); input.value = ''; void connect(token);
  });
  function stopConnection(removeAccess = true) {
    epoch++; session = null; scope = ''; remote.clear(); excluded.clear(); preferenceSchema = 1;
    dialog.close(); exportButton.disabled = true; exclusionsPanel.replaceChildren();
    if (removeAccess) { try { localStorage.removeItem(ACCESS); } catch { /* No persistent access to remove. */ } }
    local.managed(false); local.restore(); local.readonly(false);
    if (introduction) introduction.innerHTML = originalIntroduction;
    other.replaceChildren(); setup.hidden = false; disconnect.hidden = true;
    document.querySelectorAll('[data-exclude]').forEach(button => {button.disabled = true; button.textContent = 'Exclude'; button.closest('tr').classList.remove('item-excluded');});
    document.querySelectorAll('[data-exclusion-state]').forEach(node => {node.textContent = '';});
    say('Disconnected. Your original browser stars are restored. Reopen your private link to reconnect.');
  }
  disconnect.addEventListener('click', () => stopConnection());
  exportButton.addEventListener('click', async () => {
    if (!session || running || exporting || pending().length || preferenceSchema !== 2) return;
    const turn = epoch;
    exporting = true;
    exportButton.setAttribute('aria-busy', 'true');
    exportButton.disabled = true;
    try {
      const generation = {unusedItemsOnly: unusedOnly.checked};
      if (generation.unusedItemsOnly) {
        const response = await fetch(board === 'def' ? 'collection-data.json' : '../collection-data.json', {cache: 'no-store'});
        if (!response.ok || !window.Unit408Usage) throw new Error('Saved design usage is unavailable. Reload before preparing an unused-only brief.');
        generation.usage = window.Unit408Usage.build((await response.json()).designs).snapshot;
      }
      const snapshot = await request();
      if (turn !== epoch || pending().length) throw new Error('Wait for all changes to sync before exporting.');
      if (snapshot.preferenceSchema !== 2) throw new Error('The shared service needs its exclusions update before export.');
      accept(snapshot);
      if (snapshot.revision < revision) throw new Error('Preferences changed during download. Prepare a fresh brief.');
      paint();
      const brief = rules.compile(snapshot, CATALOG, generation);
      if (brief.conflicts.length || brief.unresolved.length) throw new Error([...brief.conflicts, ...brief.unresolved].join(' '));
      const blob = new Blob([JSON.stringify(brief, null, 2) + '\n'], {type: 'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `unit408-regeneration-r${brief.revision}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('Regeneration brief downloaded with your preferred items and exclusions. Use it for the next design; existing images have not changed.');
    } catch (failure) { say(`Cannot prepare brief: ${failure.message}`); }
    finally { exporting = false; exportButton.setAttribute('aria-busy', 'false'); if (turn === epoch) paint(); }
  });
  window.addEventListener('storage', event => {
    if (event.key === ACCESS) {
      const saved = readAccess();
      if (saved?.token && saved.token !== session?.token) void connect(saved.token);
      else if (!saved?.token && session) stopConnection(false);
    } else if (session && event.key === CACHE + scope) { pullCache(); paint(); }
    else if (session && event.key?.startsWith(OPS)) { pullCache(); paint(); void refresh(); }
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
