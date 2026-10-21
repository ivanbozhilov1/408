/* Combined-gallery adapter for the existing Unit 408 picks v2 protocol.
 * Adapted from tools/unit408_picks/client.js. Wire IDs, storage keys, token
 * scope, idempotent operations and exclusion restoration retain that contract.
 * No access credentials are shipped in this file.
 */
(function (root) {
  'use strict';
  const API = 'https://seo.cebugrandrealty.com:8443/api/picks';
  const ACCESS = 'unit408-shared-access-v1', OPS = 'unit408-shared-op-v1:';
  const CACHE = 'unit408-shared-cache-v1:', MIGRATED = 'unit408-shared-migrated-v1:';
  const BOARD = 'combined-collection-v1';
  const validExclusions = values => Array.isArray(values) && values.every(x => x && typeof x.id === 'string' && Array.isArray(x.traits) && x.traits.every(t => typeof t === 'string') && typeof x.note === 'string');
  const validSnapshot = value => value && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.picks) && value.picks.every(id => typeof id === 'string') && (value.preferenceSchema !== 2 || validExclusions(value.exclusions));

  function createClient(options) {
    const {catalog, rules, storage, crypto, fetch, local, changed = () => {}} = options;
    const entries = new Map(catalog.map(item => [item.id, item]));
    const localIds = new Map(catalog.map(item => [item.localId, item.id]));
    const memory = new Map();
    let session = null, scope = '', revision = -1, remote = new Set(), excluded = new Map();
    let preferenceSchema = 1, hasSnapshot = false, storageAvailable = true, epoch = 0;
    let running = null, restoring = false, phase = 'local', notice = '';
    const read = key => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
    const write = (key, value) => { try { storage.setItem(key, JSON.stringify(value)); } catch { storageAvailable = false; } };
    const remove = key => { try { storage.removeItem(key); } catch { storageAvailable = false; } };
    function pending() {
      const all = new Map(memory);
      try {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (!key?.startsWith(OPS)) continue;
          const operation = read(key);
          if (operation?.scope === scope && entries.has(operation.id) && typeof operation.operationId === 'string' && Number.isFinite(operation.queuedAt)
              && (typeof operation.starred === 'boolean' || ['preferred', 'neutral', 'excluded'].includes(operation.decision))
              && (operation.decision !== 'excluded' || validExclusions([{id: operation.id, ...operation.exclusion}]))) all.set(operation.operationId, operation);
        }
      } catch { storageAvailable = false; }
      return [...all.values()].filter(op => op.scope === scope).sort((a, b) => a.queuedAt - b.queuedAt || a.operationId.localeCompare(b.operationId));
    }
    function effective() {
      const picks = new Set(remote), exclusions = new Map(excluded);
      for (const op of pending()) {
        if (op.decision === 'excluded') { picks.delete(op.id); exclusions.set(op.id, {id: op.id, ...op.exclusion}); }
        else {
          if (op.restoreRevision !== undefined) exclusions.delete(op.id);
          if ((op.decision === 'preferred' || op.starred === true) && !exclusions.has(op.id)) picks.add(op.id);
          else picks.delete(op.id);
        }
      }
      return {picks, exclusions};
    }
    function matches(id, exclusions = effective().exclusions) {
      const item = entries.get(id);
      if (!item) return ['This item is absent from the shared catalogue.'];
      return [...new Set([...exclusions.values()].flatMap(rule => {
        const result = rules.match(item, rule, catalog);
        return result.blocked ? result.reasons : [];
      }))];
    }
    function state() {
      const current = effective(), queued = pending();
      return {managed: !!session, role: session?.role || null, readonly: !!session && (session.role !== 'editor' || !hasSnapshot),
        phase, notice, revision, preferenceSchema, storageAvailable, hasSnapshot, pending: queued.length,
        busy: !!running || restoring, synced: !!session && phase === 'online' && !queued.length,
        picks: [...current.picks], exclusions: [...current.exclusions.values()],
        items: catalog.map(item => ({localId: item.localId, id: item.id,
          decision: current.exclusions.has(item.id) ? 'excluded' : current.picks.has(item.id) ? 'preferred' : 'neutral',
          reasons: matches(item.id, current.exclusions), pending: queued.some(op => op.id === item.id)}))};
    }
    const notify = () => changed(state());
    function persistAccess() {
      if (!session) return;
      session.migrated = {...(read(MIGRATED + scope) || {}), ...session.migrated};
      write(MIGRATED + scope, session.migrated);
      write(ACCESS, {token: session.token, role: session.role});
    }
    function pullCache() {
      const cached = read(CACHE + scope);
      if (validSnapshot(cached) && cached.preferenceSchema === 2 && cached.revision >= revision) {
        remote = new Set(cached.picks); excluded = new Map(cached.exclusions.map(x => [x.id, x]));
        revision = cached.revision; preferenceSchema = 2; hasSnapshot = true;
      }
    }
    function accept(value) {
      pullCache();
      if (value.revision >= revision) {
        revision = value.revision; remote = new Set(value.picks); hasSnapshot = true;
        preferenceSchema = value.preferenceSchema || 1;
        excluded = new Map((value.exclusions || []).map(x => [x.id, x]));
        write(CACHE + scope, {revision, picks: [...remote], exclusions: [...excluded.values()], preferenceSchema});
      }
      session.role = value.role;
    }
    async function request(method = 'GET', operation) {
      const token = session.token, controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const body = operation && {id: operation.id, ...(operation.decision ? {decision: operation.decision,
          ...(operation.exclusion ? {exclusion: operation.exclusion} : {}),
          ...(operation.restoreRevision !== undefined ? {restoreRevision: operation.restoreRevision} : {})} : {starred: operation.starred}), operationId: operation.operationId};
        const response = await fetch(API, {method, cache: 'no-store', credentials: 'omit', signal: controller.signal,
          headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {})},
          ...(body ? {body: JSON.stringify(body)} : {})});
        if (!response.ok) { const error = new Error('Shared choices unavailable'); error.status = response.status; throw error; }
        const value = await response.json();
        if (!validSnapshot(value) || !['editor', 'viewer'].includes(value.role)) throw new Error('Invalid shared response');
        return value;
      } finally { clearTimeout(timer); }
    }
    function enqueue(id, decision, exclusion, restoreRevision) {
      const op = {id, decision, ...(exclusion ? {exclusion} : {}), ...(restoreRevision !== undefined ? {restoreRevision} : {}),
        operationId: crypto.randomUUID(), scope, queuedAt: Math.max(Date.now(), ...pending().map(item => item.queuedAt + 1))};
      memory.set(op.operationId, op); write(OPS + op.operationId, op);
    }
    function acknowledge(op) { memory.delete(op.operationId); remove(OPS + op.operationId); }
    async function drain(turn) {
      try {
        const value = await request();
        if (turn !== epoch) return;
        accept(value); notice = '';
        session.migrated = {...session.migrated, ...(read(MIGRATED + scope) || {})};
        if (session.role === 'editor' && !session.migrated[BOARD]) {
          // Add this browser's choices once. Legacy board markers prevent reviving
          // choices already enrolled, then cleared, in the original Fable gallery.
          for (const localId of session.localAtConnect) {
            const id = localIds.get(localId), item = entries.get(id);
            if (item && !session.migrated[item.board] && !remote.has(id) && !matches(id, excluded).length && !pending().some(op => op.id === id)) enqueue(id, 'preferred');
          }
          session.migrated[BOARD] = true;
        }
        persistAccess(); notify();
        if (session.role === 'editor') {
          for (const op of pending()) {
            // The service guards exact IDs only. An offline choice (including an
            // imported or legacy star) must also respect newly saved family and
            // category-trait exclusions before it is sent again.
            pullCache();
            const positive = op.decision ? op.decision === 'preferred' : op.starred === true;
            if (positive && matches(op.id, excluded).length) {
              acknowledge(op);
              notice = 'An older preferred choice was not applied because it now matches an exclusion. The saved exclusion was kept.';
              notify(); continue;
            }
            let saved;
            try { saved = await request('PUT', op); }
            catch (failure) {
              if (turn !== epoch) return;
              if (failure.status !== 409) throw failure;
              const current = await request();
              if (turn !== epoch) return;
              acknowledge(op); accept(current);
              notice = 'An older change was not applied. The saved decision was kept; retry Restore if needed.';
              notify(); continue;
            }
            if (turn !== epoch) return;
            acknowledge(op); accept(saved); notify();
          }
        }
        phase = 'online';
      } catch (failure) {
        if (turn !== epoch) return;
        if (failure.status === 401 || failure.status === 403) {
          session.role = null; phase = 'access'; notice = 'Reconnect with your private access code. Queued changes are kept.';
        } else { phase = 'offline'; notice = 'Retrying automatically when connected.'; }
      }
    }
    function refresh() {
      if (!session) return Promise.resolve();
      if (running) return running;
      const turn = epoch;
      running = drain(turn).finally(() => {
        running = null; notify();
        if (turn !== epoch && session) void refresh();
      });
      return running;
    }
    async function connect(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) { notice = 'Use the complete private access code.'; notify(); return; }
      const prior = read(ACCESS), turn = ++epoch;
      revision = -1; remote.clear(); excluded.clear(); preferenceSchema = 1; hasSnapshot = false; scope = '';
      session = {token, role: prior?.token === token ? prior.role : null, migrated: {}, localAtConnect: local.get()};
      phase = 'connecting'; notice = ''; notify();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      if (turn !== epoch) return;
      scope = [...new Uint8Array(digest)].slice(0, 16).map(v => v.toString(16).padStart(2, '0')).join('');
      session.migrated = read(MIGRATED + scope) || {}; pullCache(); persistAccess(); notify();
      await refresh();
    }
    function decide(localId, decision, exclusion) {
      pullCache();
      const id = localIds.get(localId);
      if (!id || !session || session.role !== 'editor' || !hasSnapshot || restoring) return false;
      if (!['preferred', 'neutral', 'excluded'].includes(decision)) return false;
      if (decision === 'excluded' && (preferenceSchema !== 2 || !validExclusions([{id, ...exclusion}]) || exclusion.traits.length > 16 || exclusion.note.length > 500)) return false;
      if (decision === 'preferred' && matches(id).length) { notice = 'Restore the matching exclusion before preferring this item.'; notify(); return false; }
      // A plain neutral operation must never restore an exclusion.
      if (decision === 'neutral' && effective().exclusions.has(id)) { notice = 'Use Restore to clear this exclusion.'; notify(); return false; }
      enqueue(id, decision, exclusion); notice = ''; notify(); void refresh(); return true;
    }
    async function restore(localId) {
      const id = localIds.get(localId);
      if (!id || session?.role !== 'editor' || preferenceSchema !== 2 || restoring) return false;
      await refresh();
      if (session?.role !== 'editor' || pending().length || phase !== 'online') { notice = 'Reconnect and wait for pending changes before restoring.'; notify(); return false; }
      const turn = epoch; restoring = true; notify();
      try {
        const fresh = await request();
        if (turn !== epoch) return false;
        accept(fresh);
        if (fresh.revision !== revision || session.role !== 'editor') throw new Error('Choices changed. Refresh and try Restore again.');
        if (!excluded.has(id)) return true;
        enqueue(id, 'neutral', undefined, fresh.revision); notice = '';
      } catch { notice = 'Could not confirm the current choices. Refresh and try Restore again.'; return false; }
      finally { restoring = false; notify(); }
      await refresh(); return !excluded.has(id);
    }
    function disconnect(removeAccess = true) {
      epoch++; session = null; scope = ''; revision = -1; remote.clear(); excluded.clear(); preferenceSchema = 1; hasSnapshot = false;
      phase = 'local'; notice = 'Disconnected. Your original browser choices are restored.';
      if (removeAccess) remove(ACCESS);
      local.restore(); notify();
    }
    function storageChanged(key) {
      if (key === ACCESS) {
        const saved = read(ACCESS);
        if (saved?.token && saved.token !== session?.token) return connect(saved.token);
        if (!saved?.token && session) disconnect(false);
      } else if (session && (key === CACHE + scope || key?.startsWith(OPS))) { pullCache(); notify(); if (key.startsWith(OPS)) void refresh(); }
    }
    async function exportBrief() {
      if (!session || pending().length) throw new Error('Wait for changes to sync before exporting shared choices.');
      await refresh();
      if (phase !== 'online' || pending().length || preferenceSchema !== 2) throw new Error('Reconnect and sync shared choices before exporting.');
      const turn = epoch, snapshot = await request();
      if (turn !== epoch || pending().length) throw new Error('Choices changed. Prepare a fresh export.');
      accept(snapshot); notify();
      if (snapshot.revision !== revision) throw new Error('Choices changed. Prepare a fresh export.');
      const brief = rules.compile(snapshot, catalog);
      if (brief.conflicts.length || brief.unresolved.length) throw new Error([...brief.conflicts, ...brief.unresolved].join(' '));
      return brief;
    }
    return {connect, refresh, decide, restore, disconnect, state, storageChanged, exportBrief,
      savedAccess: () => read(ACCESS), entry: localId => entries.get(localIds.get(localId))};
  }

  let suppliedToken = null, activeClient = null;
  function consumeAccess() {
    if (!root.location || !root.history) return false;
    const match = /^#sync=([^&]*)$/.exec(root.location.hash);
    if (!match) return false;
    // Remove private access before collection data loads or any export can run.
    root.history.replaceState(null, '', root.location.pathname + root.location.search + '#picks');
    suppliedToken = match[1];
    if (activeClient) { const token = suppliedToken; suppliedToken = null; void activeClient.connect(token); }
    return true;
  }
  consumeAccess();
  root.addEventListener?.('hashchange', consumeAccess);

  async function start(adapter) {
    const panel = document.createElement('div'); panel.className = 'picks-sync';
    panel.innerHTML = '<strong>Shared furniture choices</strong><p data-sync-status role="status" aria-live="polite">Local choices stay in this browser. Connect once with your existing private access link.</p><details data-sync-setup><summary>Connect shared choices</summary><label>Private access code<input type="password" autocomplete="off" data-sync-code></label><button type="button" data-sync-connect>Connect</button></details><div class="sync-actions"><button type="button" data-sync-refresh hidden>Refresh</button><button type="button" data-sync-disconnect hidden>Disconnect</button><button type="button" data-sync-export hidden>Export shared choices</button></div><div data-sync-exclusions></div>';
    document.querySelector('#picks .section-head').after(panel);
    const status = panel.querySelector('[data-sync-status]');
    let savedAccess = null;
    try { if (!adapter.testMode) savedAccess = JSON.parse(root.localStorage.getItem(ACCESS) || 'null'); } catch { /* Storage may be disabled. */ }
    if (suppliedToken || savedAccess?.token) adapter.update({managed: true, readonly: true, items: [], picks: [], exclusions: [], pending: 0, phase: 'connecting'});
    let catalog, client;
    try {
      const response = await fetch('collection-catalog.json', {cache: 'no-store'});
      if (!response.ok) throw new Error('Shared catalogue unavailable');
      const value = await response.json(); catalog = value.items;
      if (value.schema !== 1 || !Array.isArray(catalog) || catalog.some(x => !x.id || !x.localId) || new Set(catalog.map(x => x.id)).size !== catalog.length || new Set(catalog.map(x => x.localId)).size !== catalog.length || !root.Unit408Preferences) throw new Error('Shared catalogue or preference rules unavailable');
    } catch {
      status.textContent = 'Shared choices could not load. Reload to reconnect; existing local choices remain saved.';
      panel.querySelector('[data-sync-connect]').disabled = true;
      adapter.update({managed: !!suppliedToken || !!savedAccess?.token, readonly: true, items: [], pending: 0, phase: 'unavailable'});
      return null;
    }
    const rules = root.Unit408Preferences, entries = new Map(catalog.map(x => [x.id, x]));
    const dialog = document.createElement('dialog'); dialog.className = 'exclusion-dialog';
    dialog.innerHTML = '<form method="dialog"><h2 data-exclusion-title></h2><p>Exclude this product. Recorded family matches and checked characteristics in the same furniture category are also avoided. Missing metadata or visual resemblance requires review before the next design.</p><div data-exclusion-traits></div><label>Anything else to avoid?<textarea data-exclusion-note maxlength="500" rows="3"></textarea></label><p data-exclusion-feedback role="status"></p><button type="button" data-exclusion-save>Save exclusion</button> <button value="cancel">Cancel</button></form>';
    document.body.append(dialog); let editing = null;
    function openExclusion(localId) {
      const state = client.state(), item = client.entry(localId);
      if (!item || state.readonly || !state.managed || state.preferenceSchema !== 2) return;
      editing = localId;
      const current = state.exclusions.find(x => x.id === item.id);
      dialog.querySelector('[data-exclusion-title]').textContent = `Exclude ${item.name}`;
      const choices = dialog.querySelector('[data-exclusion-traits]'); choices.replaceChildren();
      const traits = [...new Set([...rules.profile(item).traits, ...(current?.traits || [])])], selected = new Set(current?.traits ?? rules.defaultTraits(item));
      for (const trait of traits) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.value = trait; input.checked = selected.has(trait);
        label.append(input, document.createTextNode(' ' + trait.replace(':', ': '))); choices.append(label);
      }
      if (!traits.length) choices.textContent = 'No reliable characteristics recorded. Describe what to avoid; a manual similarity review is required.';
      dialog.querySelector('[data-exclusion-note]').value = current?.note || '';
      dialog.querySelector('[data-exclusion-feedback]').textContent = ''; dialog.showModal();
    }
    dialog.querySelector('[data-exclusion-save]').addEventListener('click', () => {
      const exclusion = {traits: [...dialog.querySelectorAll('input:checked')].map(x => x.value), note: dialog.querySelector('[data-exclusion-note]').value.trim()};
      if (exclusion.traits.length > 16) { dialog.querySelector('[data-exclusion-feedback]').textContent = 'Choose up to 16 characteristics.'; return; }
      if (client.decide(editing, 'excluded', exclusion)) dialog.close();
      else dialog.querySelector('[data-exclusion-feedback]').textContent = 'This exclusion cannot be saved with the current access. Refresh or reconnect.';
    });
    function paint(state) {
      adapter.update(state);
      const managed = state.managed;
      panel.querySelector('[data-sync-setup]').hidden = managed && state.phase !== 'access';
      panel.querySelector('[data-sync-disconnect]').hidden = !managed;
      panel.querySelector('[data-sync-refresh]').hidden = !managed;
      const exportButton = panel.querySelector('[data-sync-export]'); exportButton.hidden = !managed;
      exportButton.disabled = !state.synced || state.busy || state.preferenceSchema !== 2;
      if (!managed) status.textContent = state.notice || 'Local choices stay in this browser. Connect once with your existing private access link.';
      else {
        const access = state.role === 'editor' ? 'Editing shared choices' : state.role === 'viewer' ? 'Viewing shared choices · read-only' : 'Connecting to shared choices';
        const progress = state.phase === 'offline' ? (state.hasSnapshot ? 'Offline · showing last loaded choices' : 'Offline · shared choices have not loaded')
          : state.phase === 'access' ? 'Access unavailable' : state.pending ? `${state.pending} changes waiting for confirmation` : state.synced ? `Synced · revision ${state.revision}` : 'Loading shared choices';
        status.textContent = `${access} · ${progress}${state.notice ? '. ' + state.notice : ''}${state.storageAvailable ? '' : '. Browser storage unavailable; keep this page open to preserve pending changes.'}`;
      }
      panel.dataset.total = String(state.picks.length); panel.dataset.excludedTotal = String(state.exclusions.length);
      const exclusions = panel.querySelector('[data-sync-exclusions]'); exclusions.replaceChildren();
      if (state.exclusions.length) {
        const heading = document.createElement('h3'); heading.textContent = `Excluded (${state.exclusions.length})`; exclusions.append(heading);
        const list = document.createElement('ul');
        for (const rule of state.exclusions) {
          const item = entries.get(rule.id), li = document.createElement('li'), text = document.createElement('span');
          text.textContent = `${item?.label || ''} · ${item?.name || rule.id}${rule.traits.length ? ' · avoid ' + rule.traits.join(', ') : ' · similarity requires review'}${rule.note ? ' · ' + rule.note : ''}`;
          li.append(text);
          if (item) {
            const edit = document.createElement('button'), restore = document.createElement('button'); edit.type = restore.type = 'button';
            edit.textContent = 'Edit exclusion'; restore.textContent = 'Restore to neutral';
            edit.disabled = state.readonly; restore.disabled = state.readonly || state.pending > 0 || state.busy;
            edit.addEventListener('click', () => openExclusion(item.localId)); restore.addEventListener('click', () => void client.restore(item.localId));
            li.append(edit, restore);
          }
          list.append(li);
        }
        exclusions.append(list);
      }
    }
    const storage = adapter.testMode ? root.sessionStorage : root.localStorage;
    client = createClient({catalog, rules, storage, crypto: root.crypto, fetch: root.fetch.bind(root), local: adapter, changed: paint});
    activeClient = client;
    panel.querySelector('[data-sync-connect]').addEventListener('click', () => {
      const input = panel.querySelector('[data-sync-code]'), token = input.value.trim(); input.value = ''; void client.connect(token);
    });
    panel.querySelector('[data-sync-disconnect]').addEventListener('click', () => { dialog.close(); client.disconnect(); });
    panel.querySelector('[data-sync-refresh]').addEventListener('click', () => void client.refresh());
    panel.querySelector('[data-sync-export]').addEventListener('click', async () => {
      try {
        const brief = await client.exportBrief(), blob = new Blob([JSON.stringify(brief, null, 2) + '\n'], {type: 'application/json'});
        const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `unit408-shared-choices-r${brief.revision}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { status.textContent = error.message; }
    });
    root.addEventListener('storage', event => client.storageChanged(event.key));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void client.refresh(); });
    root.addEventListener('online', () => void client.refresh());
    setInterval(() => { if (!document.hidden) void client.refresh(); }, 5000);
    const token = suppliedToken; suppliedToken = null;
    if (token) await client.connect(token);
    else if (!adapter.testMode && client.savedAccess()?.token) await client.connect(client.savedAccess().token);
    else paint(client.state());
    return {...client, openExclusion};
  }
  root.unit408CollectionSync = Object.freeze({start, createClient});
})(globalThis);
