'use strict';
(() => {
  const dialog = document.querySelector('#image-dialog');
  const links = [...document.querySelectorAll('[data-lightbox]')];
  let index = 0, opener;
  function show(next) {
    index = (next + links.length) % links.length;
    const link = links[index], image = document.querySelector('#image-full');
    image.src = link.href;
    image.alt = link.querySelector('img')?.alt || link.dataset.caption;
    document.querySelector('#image-caption').textContent = link.dataset.caption || image.alt;
    document.querySelector('#image-position').textContent = `${index + 1} / ${links.length}`;
    document.querySelector('#image-original').href = link.href;
  }
  links.forEach((link, i) => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !dialog?.showModal) return;
    event.preventDefault(); opener = link; show(i); dialog.showModal();
  }));
  document.querySelector('#image-close')?.addEventListener('click', () => dialog.close());
  document.querySelector('#image-prev')?.addEventListener('click', () => show(index - 1));
  document.querySelector('#image-next')?.addEventListener('click', () => show(index + 1));
  dialog?.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') {event.preventDefault(); show(index - 1);}
    if (event.key === 'ArrowRight') {event.preventDefault(); show(index + 1);}
  });
  dialog?.addEventListener('click', event => {if (event.target === dialog) dialog.close();});
  dialog?.addEventListener('close', () => opener?.focus());
  document.querySelectorAll('[data-filter]').forEach(input => input.addEventListener('input', () => {
    const table = document.getElementById(input.dataset.filter), query = input.value.trim().toLocaleLowerCase();
    const rows = [...table.querySelectorAll('tbody tr')];
    let count = 0;
    rows.forEach(row => {row.hidden = !row.dataset.search.includes(query); if (!row.hidden) count++;});
    document.querySelector(`[data-filter-count="${input.dataset.filter}"]`).textContent = `${count} of ${rows.length} scheduled items`;
  }));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        document.querySelectorAll('[data-scheme-nav]').forEach(link => {
          if (link.dataset.schemeNav === entry.target.dataset.scheme) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      }
    }, {rootMargin:'-15% 0px -65% 0px'});
    document.querySelectorAll('[data-scheme]').forEach(section => observer.observe(section));
  }
})();

// Starred pieces ("picks"): a star on every schedule row, a list grouped by direction, saved in this browser
// (localStorage) and shareable as a link ending in #picks=ID,ID. Opening such a link replaces the picks on that device.
(() => {
  const KEY = 'unit408-picks-jkl-v1';
  const rows = new Map([...document.querySelectorAll('tr[data-item-id]')].map(row => [row.dataset.itemId, row]));
  const list = document.querySelector('[data-picks-list]'), text = document.querySelector('[data-picks-text]');
  const status = document.querySelector('[data-picks-status]'), counts = document.querySelectorAll('[data-picks-count]');
  if (!rows.size || !list || !text) return;
  const groups = [...document.querySelectorAll('section[data-scheme]')].map(section => ({
    id: section.dataset.scheme, title: section.querySelector('h2')?.textContent.trim() || section.dataset.scheme, label: `Direction ${section.dataset.scheme} · `
  })).concat([{id: 'common', title: document.getElementById('common-title')?.textContent.trim() || 'Common essentials', label: ''}]);
  const escape = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const peso = cents => '₱' + (cents / 100).toLocaleString('en-PH', {minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2});
  const load = () => {
    try {const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); return new Set(Array.isArray(saved) ? saved.filter(id => rows.has(id)) : []);}
    catch {return new Set();}
  };
  const save = () => {try {localStorage.setItem(KEY, JSON.stringify([...picked]));} catch {/* storage blocked: picks last for this page view only */}};
  const setStatus = message => {status.textContent = message;};
  const link = () => location.href.replace(/#.*$/, '') + '#picks=' + [...picked].join(',');
  const info = id => {
    const row = rows.get(id), pick = selector => row.querySelector(selector)?.textContent.trim() || '';
    return {
      id, name: pick('.piece-name') || id, meta: pick('.item-meta'), variant: pick('.variant'), role: pick('.role'),
      quantity: row.querySelector('.qty')?.firstChild?.textContent.trim() || '',
      line: row.dataset.line === '' ? null : Number(row.dataset.line),
      group: row.closest('section[data-scheme]')?.dataset.scheme || 'common'
    };
  };
  let picked = load(), readOnly = false, externallyManaged = false;
  const importHash = () => {
    if (externallyManaged) return false;
    const shared = /^#picks=(.+)$/.exec(location.hash);
    if (!shared) return false;
    const ids = decodeURIComponent(shared[1]).split(',').filter(id => rows.has(id));
    history.replaceState(null, '', location.pathname + location.search + '#picks');
    if (!ids.length) return false;
    const previous = picked.size;
    picked = new Set(ids); save();
    setStatus(`${ids.length} starred ${ids.length === 1 ? 'piece' : 'pieces'} loaded from the link${previous ? ` (replaced ${previous} saved here before)` : ''}.`);
    return true;
  };
  const shared = importHash();
  const plain = filled => {
    const lines = [document.title, ''];
    for (const group of filled) {
      lines.push(`${group.label}${group.title} (${group.items.length})`);
      for (const item of group.items) lines.push(`• ${item.name}${item.variant ? ` · ${item.variant}` : ''} · ${item.meta} · ${item.line === null ? 'quote required' : peso(item.line)}${item.quantity && item.quantity !== '1' ? ` · qty ${item.quantity}` : ''}`);
      lines.push(`  Subtotal ${peso(group.sum)}${group.open ? ` + ${group.open} quote${group.open === 1 ? '' : 's'} required` : ''}`, '');
    }
    lines.push(`Link: ${link()}`);
    return lines.join('\n');
  };
  function render() {
    document.querySelector("[data-picks-clear]").disabled = readOnly;
    const items = [...picked].map(info);
    counts.forEach(count => {count.textContent = String(items.length);});
    rows.forEach((row, id) => {
      const on = picked.has(id), button = row.querySelector('[data-pick]');
      row.classList.toggle('is-picked', on);
      if (button) {button.disabled = readOnly; button.setAttribute('aria-pressed', String(on)); button.firstElementChild.textContent = on ? '★' : '☆';}
    });
    const filled = groups.map(group => {
      const own = items.filter(item => item.group === group.id);
      return {...group, items: own, sum: own.reduce((total, item) => total + (item.line ?? 0), 0), open: own.filter(item => item.line === null).length};
    }).filter(group => group.items.length);
    if (!filled.length) {list.innerHTML = '<p class="picks-empty">No starred pieces yet.</p>'; text.value = ''; return;}
    list.innerHTML = filled.map(group => `<div class="picks-group"><h3>${escape(group.label)}${escape(group.title)}<span>${group.items.length} ${group.items.length === 1 ? 'piece' : 'pieces'} · ${peso(group.sum)}${group.open ? ` + ${group.open} quote` : ''}</span></h3><ul>${group.items.map(item => `<li><button type="button" class="pick" data-pick="${escape(item.id)}" aria-label="Remove ${escape(item.name)} from picks"><span aria-hidden="true">★</span></button><div><span class="role">${escape(item.role)}</span><a class="piece-name" href="#row-${escape(item.id)}">${escape(item.name)}</a><span class="item-meta">${escape(item.meta)}${item.variant ? ` · ${escape(item.variant)}` : ''}</span></div><span class="numeric">${item.line === null ? 'Quote required' : peso(item.line)}</span></li>`).join('')}</ul></div>`).join('');
    list.querySelectorAll("[data-pick]").forEach(button => {button.disabled = readOnly;});
    text.value = plain(filled);
  }
  const copy = async value => {
    try {await navigator.clipboard.writeText(value); return true;} catch {/* fall through to the selection method */}
    const area = document.createElement('textarea');
    area.value = value; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select();
    let ok = false;
    try {ok = document.execCommand('copy');} catch {ok = false;}
    area.remove();
    return ok;
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-pick]');
    if (!button || readOnly) return;
    const id = button.dataset.pick;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    save(); render(); setStatus('');
    window.dispatchEvent(new CustomEvent('unit408:picks-change', {detail: [{id, starred: picked.has(id)}]}));
  });
  document.querySelectorAll('[data-picks-copy]').forEach(button => button.addEventListener('click', async () => {
    if (!picked.size) {setStatus('Star a piece first.'); return;}
    const asLink = button.dataset.picksCopy === 'link', value = asLink ? link() : text.value;
    if (await copy(value)) setStatus(asLink ? 'Link copied. Paste it in a message; it opens with the same stars.' : 'List copied. Paste it in a message.');
    else {text.closest('details').open = true; text.focus(); text.select(); setStatus('The browser blocked copying. Select the text below and copy it.');}
  }));
  document.querySelector('[data-picks-clear]')?.addEventListener('click', () => {
    if (readOnly || !picked.size || !confirm('Remove all starred pieces?')) return;
    const removed = [...picked];
    picked.clear(); save(); render(); setStatus('All stars removed.');
    window.dispatchEvent(new CustomEvent('unit408:picks-change', {detail: removed.map(id => ({id, starred:false}))}));
  });
  render();
  window.unit408Picks = {get: () => [...picked], set: ids => {picked = new Set(ids.filter(id => rows.has(id))); render();}, readonly: value => {readOnly = value; render();}, managed: value => {externallyManaged = value;}, restore: () => {picked = load(); render();}};
  const reveal = () => document.getElementById('picks')?.scrollIntoView({block: 'start'});
  if (shared) reveal();
  window.addEventListener('hashchange', () => {if (importHash()) {render(); reveal();}});
})();

// BEGIN UNIT408 SHARED PICKS
// Scoped shared shortlist access. This file contains no access credentials.
(() => {
  'use strict';
  const API = "https://seo.cebugrandrealty.com:8443/api/picks";
  const CATALOG = [{"id": "ghi:G-BED", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Our Home Gavino Bedframe — White / King 72 x 78 in", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-BED"}, {"id": "ghi:G-NIGHTSTAND", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "GRÅFJÄLLET Nightstand", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-NIGHTSTAND"}, {"id": "ghi:G-LAMP", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Tripod HM9", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-LAMP"}, {"id": "ghi:G-CHAIR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Kartell Clap Armchair", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-CHAIR"}, {"id": "ghi:G-CONSOLE", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "FJÄLLBO TV unit", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-CONSOLE"}, {"id": "ghi:G-MIRROR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "A58000434 Floor Mirror", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-MIRROR"}, {"id": "ghi:G-RUG", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "TANNISBY Rug, flatwoven", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-RUG"}, {"id": "ghi:G-CEILING", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "HEKTAR Pendant lamp", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-CEILING"}, {"id": "ghi:G-BEDSPREAD", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Super Soft White Duvet Cover", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-BEDSPREAD"}, {"id": "ghi:G-PILLOWCASES", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Super Soft Cloud Gray Pillowcases", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-PILLOWCASES"}, {"id": "ghi:G-CUSHION", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Chunky Woven Wool Fringe 23\"x23\" Storm Grey Throw Pillow Cover", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-CUSHION"}, {"id": "ghi:G-ART", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Brushed Black 20x30 Wall Picture Frame", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-ART"}, {"id": "ghi:G-PLANT", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Faux Potted Agave", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-PLANT"}, {"id": "ghi:G-DECOR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "A52000353 Sculpture", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-G-DECOR"}, {"id": "ghi:H-BED", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Our Home Francis Libiran Frances Bedframe — Grey / King 72 x 78 in", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-BED"}, {"id": "ghi:H-NIGHTSTAND", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Venice Bedside Table", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-NIGHTSTAND"}, {"id": "ghi:H-LAMP", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Journey SHY1", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-LAMP"}, {"id": "ghi:H-CHAIR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Heather Arm Chair with Backpillow", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-CHAIR"}, {"id": "ghi:H-CONSOLE", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Youset TV Bench", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-CONSOLE"}, {"id": "ghi:H-MIRROR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Perfect Pieces Emilia", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-MIRROR"}, {"id": "ghi:H-RUG", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "ÄLSKEGRAS Rug, low pile", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-RUG"}, {"id": "ghi:H-CEILING", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "SIMRISHAMN Pendant lamp, 3-armed", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-CEILING"}, {"id": "ghi:H-BEDSPREAD", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Parker Organic Percale Duvet Cover - Queen", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-BEDSPREAD"}, {"id": "ghi:H-PILLOWCASES", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Parker Organic Percale Sham", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-PILLOWCASES"}, {"id": "ghi:H-CUSHION", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Telas Gessato Cushion Cover", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-CUSHION"}, {"id": "ghi:H-ART", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "A58000373 Wall Art", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-ART"}, {"id": "ghi:H-PLANT", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Artificial Pampas Grass Bunch", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-PLANT"}, {"id": "ghi:H-PLANTER", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "A52000297 Vase", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-PLANTER"}, {"id": "ghi:H-DECOR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "A52000453 Vase", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-H-DECOR"}, {"id": "ghi:I-BED", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Our Home Griffin II Bedframe — Walnut/Gray / King 72 x 78 in", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-BED"}, {"id": "ghi:I-NIGHTSTAND", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "KULLEN 2-drawer chest", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-NIGHTSTAND"}, {"id": "ghi:I-LAMP", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "HÖGVIND Table lamp", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-LAMP"}, {"id": "ghi:I-CHAIR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Kelly Swivel Arm Chair", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-CHAIR"}, {"id": "ghi:I-CONSOLE", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Sigma Senor I Tv Stand", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-CONSOLE"}, {"id": "ghi:I-MIRROR", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Sabrina Floor Mirror", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-MIRROR"}, {"id": "ghi:I-RUG", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "RÅVAROR Rug, flatwoven", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-RUG"}, {"id": "ghi:I-CEILING", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "HÖGVIND Pendant lamp with 3 lamps", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-CEILING"}, {"id": "ghi:I-BEDSPREAD", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "QUILT COVER NGRIP MJ03 PLAIN GY Q", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-BEDSPREAD"}, {"id": "ghi:I-PILLOWCASES", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "NFIT FITTED PILLOWCASE NCOOL GY 26NC-01", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-PILLOWCASES"}, {"id": "ghi:I-CUSHION", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Pintig Pillow Covers - Maroon", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-CUSHION"}, {"id": "ghi:I-ART", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "A58000378 Wall Art", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-ART"}, {"id": "ghi:I-PLANT", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Faux Large Dark Red Eucalyptus Branch 72\"", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-PLANT"}, {"id": "ghi:I-PLANTER", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "A52000268 Vase", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-I-PLANTER"}, {"id": "ghi:DUVET-INSERT", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Comforter & Duvet Insert White", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-DUVET-INSERT"}, {"id": "ghi:SYS-TV75", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "75-inch Crystal UHD TV UA75U8520HGXXP", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-SYS-TV75"}, {"id": "ghi:SYS-AC", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "TCL 1.5 HP split inverter TAC-13CSD/KEI2", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-SYS-AC"}, {"id": "ghi:SYS-MOUNT", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "True Vision extra-large TV wall mount TV73-69F, 60–120 in, 120 kg, VESA 400×300 listed", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-SYS-MOUNT"}, {"id": "ghi:CUR-BASE", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Master bedroom drapes + sheers,2 tracks,inverted pleats", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-CUR-BASE"}, {"id": "ghi:CUR-BOARD", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Finished valance/pelmet:1 of6 quoted areas", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-CUR-BOARD"}, {"id": "ghi:CUR-STICKS", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Four curtain pull sticks:1 of6 quoted areas", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-CUR-STICKS"}, {"id": "ghi:SHARED-FLAT-SHEET", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "DVALA flat sheet, white", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-SHARED-FLAT-SHEET"}, {"id": "ghi:SHARED-SLEEPING-PILLOWS", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "LAPPTATEL pillow, side/back sleeper", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-SHARED-SLEEPING-PILLOWS"}, {"id": "ghi:SHARED-RUG-UNDERLAY", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "STOPP FILT anti-slip rug underlay", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-SHARED-RUG-UNDERLAY"}, {"id": "ghi:SHARED-CUSHION-INSERT", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "INNER cushion insert, white", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-SHARED-CUSHION-INSERT"}, {"id": "ghi:LAMP-BULBS-E27", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "SOLHETTA E27 opal LED bulb 470 lm, 2-piece pack", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-LAMP-BULBS-E27"}, {"id": "ghi:CEIL-BULBS-E14", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "SOLHETTA E14 opal LED bulb 250 lm, 2-piece pack", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-CEIL-BULBS-E14"}, {"id": "ghi:REQUIRED-MATTRESS50", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Made-to-order mattress, finished 50 mm × 1828.8 × 1981.2 mm", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-REQUIRED-MATTRESS50"}, {"id": "ghi:REQUIRED-FLAT-DECK", "board": "ghi", "label": "three bedroom directions (G, H, I)", "name": "Continuous flat bed support and any frame adaptation", "url": "/bedroom-design-options/ghi/?shared-picks=1#row-REQUIRED-FLAT-DECK"}, {"id": "def:D-BED", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Figaro Bedframe Queen — King 72 x 78 in", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-BED"}, {"id": "def:D-NIGHTSTAND", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Falcon II Nite Table", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-NIGHTSTAND"}, {"id": "def:D-LAMP", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Chadrich Paper Table Lamp", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-LAMP"}, {"id": "def:D-CHAIR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Agatha Armchair", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-CHAIR"}, {"id": "def:D-CONSOLE", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "MX3 TV CABINET", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-CONSOLE"}, {"id": "def:D-MIRROR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "IKORNNES Floor mirror", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-MIRROR"}, {"id": "def:D-RUG", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "BLÅLJUS Rug, flatwoven", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-RUG"}, {"id": "def:D-CEILING", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Paper Shade Donut", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-CEILING"}, {"id": "def:D-BEDSPREAD", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Yucatan Terracotta Stripe Full/Queen Quilt", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-BEDSPREAD"}, {"id": "def:D-PILLOWCASES", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Jude Cotton Linen Standard Pillowcases, Set of 2 by Jake Arnold", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-PILLOWCASES"}, {"id": "def:D-CUSHION", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Faux Shearling 20\"x20\" Clay Taupe Throw Pillow Cover", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-CUSHION"}, {"id": "def:D-ART", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "A58000224 Wall Art", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-ART"}, {"id": "def:D-PLANT", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Olive-stem composition: Haute Cannelée Tall Terracotta Vase 19\"", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-PLANT"}, {"id": "def:D-STEMS", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Extra-Large Faux Olive Stem 72\"", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-STEMS"}, {"id": "def:D-DECOR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Flourish Terracotta Vase with Handle", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-DECOR"}, {"id": "def:D-TRAY", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Round Acacia Sleek Bowl 5x12", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-TRAY"}, {"id": "def:E-BED", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Our Home Francis Libiran Fieche Bedframe — Grey / King 72 x 78 in", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-BED"}, {"id": "def:E-NIGHTSTAND", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Nina Bedside Table", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-NIGHTSTAND"}, {"id": "def:E-LAMP", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Flourish Huesca Lamp", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-LAMP"}, {"id": "def:E-CHAIR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "SALTSJÖBADEN Rocking and swivel armchair", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-CHAIR"}, {"id": "def:E-CONSOLE", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Charlotte TV Bench", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-CONSOLE"}, {"id": "def:E-MIRROR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Heim Oslo Round Mirror Gold 60cm", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-MIRROR"}, {"id": "def:E-RUG", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "TVERSTED Rug, low pile", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-RUG"}, {"id": "def:E-CEILING", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Matin Flush Lamp", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-CEILING"}, {"id": "def:E-BEDSPREAD", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Favorite Washed Organic Cotton Sand Beige Eyelash Full/Queen Duvet Cover", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-BEDSPREAD"}, {"id": "def:E-PILLOWCASES", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Belamy Standard White Pleated Sham", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-PILLOWCASES"}, {"id": "def:E-CUSHION", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Windowpane Grid Pillow Cover Camel", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-CUSHION"}, {"id": "def:E-ART", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "A58000375 Wall Art", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-ART"}, {"id": "def:E-PLANT", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Heim Fiddle Tree Artificial Potted Plant 150cm", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-PLANT"}, {"id": "def:E-PLANTER", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Willis 13.5\" x 15.75\" Medium White Ceramic Planter", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-PLANTER"}, {"id": "def:E-DECOR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Alura Low-Wide Cream White Porcelain Vase", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-DECOR"}, {"id": "def:E-TRAY", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Tuscan Small Beige Marble Square Tray", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-E-TRAY"}, {"id": "def:F-BED", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Our Home Dylan Bedrame — Black / Wengue / King 72 x 78 in", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-BED"}, {"id": "def:F-NIGHTSTAND", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Wren 2-Drawer Nightstand – Wenge", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-NIGHTSTAND"}, {"id": "def:F-LAMP", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Umber Glass Table Lamp", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-LAMP"}, {"id": "def:F-CHAIR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "LANDSKRONA Armchair", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-CHAIR"}, {"id": "def:F-CONSOLE", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Lindy TV Stand", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-CONSOLE"}, {"id": "def:F-MIRROR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Heim Lavi Full Body Mirror Bronze 60x150cm", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-MIRROR"}, {"id": "def:F-RUG", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Palermo Flatweave Black Area Rug 6'x9'", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-RUG"}, {"id": "def:F-CEILING", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "AKTERSPRING Pendant lamp", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-CEILING"}, {"id": "def:F-BEDSPREAD", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "European Flax ®-Certified Linen Burnt Green Full/Queen Size Duvet Cover", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-BEDSPREAD"}, {"id": "def:F-PILLOWCASES", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Uratex Eco Deluxe Pillowcase", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-PILLOWCASES"}, {"id": "def:F-CUSHION", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "VALLKRASSING Cushion cover", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-CUSHION"}, {"id": "def:F-ART", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "A58000326 Wall Art", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-ART"}, {"id": "def:F-PLANT", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "A54200037 Greenery", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-PLANT"}, {"id": "def:F-DECOR", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Tall Amber Brown Glass Vase 21.5\"", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-DECOR"}, {"id": "def:F-CANDLE", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Barteau Small Brass Taper Candle Holder 7\"", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-F-CANDLE"}, {"id": "def:DUVET-INSERT", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Comforter & Duvet Insert White", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-DUVET-INSERT"}, {"id": "def:SYS-TV75", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "75-inch Crystal UHD TV UA75U8520HGXXP", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-SYS-TV75"}, {"id": "def:SYS-AC", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "TCL 1.5 HP split inverter TAC-13CSD/KEI2", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-SYS-AC"}, {"id": "def:SYS-MOUNT", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "True Vision extra-large TV wall mount TV73-69F, 60–120 in, 120 kg, VESA 400×300 listed", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-SYS-MOUNT"}, {"id": "def:CUR-BASE", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Master bedroom drapes + sheers,2 tracks,inverted pleats", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-CUR-BASE"}, {"id": "def:CUR-BOARD", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Finished valance/pelmet:1 of6 quoted areas", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-CUR-BOARD"}, {"id": "def:CUR-STICKS", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Four curtain pull sticks:1 of6 quoted areas", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-CUR-STICKS"}, {"id": "def:SHARED-FLAT-SHEET", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "DVALA flat sheet, white", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-SHARED-FLAT-SHEET"}, {"id": "def:SHARED-SLEEPING-PILLOWS", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "LAPPTATEL pillow, side/back sleeper", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-SHARED-SLEEPING-PILLOWS"}, {"id": "def:SHARED-RUG-UNDERLAY", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "STOPP FILT anti-slip rug underlay", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-SHARED-RUG-UNDERLAY"}, {"id": "def:SHARED-CUSHION-INSERT", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "INNER cushion insert, white", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-SHARED-CUSHION-INSERT"}, {"id": "def:LAMP-BULBS-E27", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "SOLHETTA E27 opal LED bulb 470 lm, 2-piece pack", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-LAMP-BULBS-E27"}, {"id": "def:CEIL-BULBS-E14", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "SOLHETTA E14 opal LED bulb 250 lm, 2-piece pack", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-CEIL-BULBS-E14"}, {"id": "def:REQUIRED-MATTRESS50", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Made-to-order mattress, finished 50 mm × 1828.8 × 1981.2 mm", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-REQUIRED-MATTRESS50"}, {"id": "def:REQUIRED-FLAT-DECK", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Continuous flat bed support and any frame adaptation", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-REQUIRED-FLAT-DECK"}, {"id": "def:D-CEIL-CORD", "board": "def", "label": "three further bedroom directions (D, E, F)", "name": "Pendant cord set for the HAY Donut shade", "url": "/bedroom-design-options/fable-def.html?shared-picks=1#row-D-CEIL-CORD"}, {"id": "jkl:J-BED", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Our Home Gibson Bedframe — Gray / King 72 x 78 in", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-BED"}, {"id": "jkl:J-NIGHTSTAND", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "861 Night Table", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-NIGHTSTAND"}, {"id": "jkl:J-LAMP", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Kolya Ceramic Table Lamp", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-LAMP"}, {"id": "jkl:J-CHAIR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "FAGERBACKEN Armchair", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-CHAIR"}, {"id": "jkl:J-CONSOLE", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Amber 150 cm TV Stand with 2 Doors", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-CONSOLE"}, {"id": "jkl:J-MIRROR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "STAND MIRROR 40150WW 002FE", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-MIRROR"}, {"id": "jkl:J-RUG", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "VÄXELFEL Rug, low pile", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-RUG"}, {"id": "jkl:J-CEILING", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "KÄRRNOCKA Ceiling lamp", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-CEILING"}, {"id": "jkl:J-VALANCE-LED", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Alphalux Linear Led Striplight 9.5w Warm White", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-VALANCE-LED"}, {"id": "jkl:J-BEDSPREAD", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Vesper Quilt Set Full/Queen White", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-BEDSPREAD"}, {"id": "jkl:J-PILLOWCASES", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Heirloom Scallop Quilted Sham White", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-PILLOWCASES"}, {"id": "jkl:J-CUSHION", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Malka Chenille Throw Pillowcase", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-CUSHION"}, {"id": "jkl:J-THROW", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A51000261 Throw", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-THROW"}, {"id": "jkl:J-ART", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Jahn Photo Frame 13x18 cm", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-ART"}, {"id": "jkl:J-DECOR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "at home Dishan Decorative Vase", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-DECOR"}, {"id": "jkl:J-PLANT", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A52000293 Vase", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-PLANT"}, {"id": "jkl:J-STEMS", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Faux Purple Chrysanthemum Stem 26\" by Abigail Ahern", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-J-STEMS"}, {"id": "jkl:K-BED", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Our Home Geo Bedrame — King 72 x 78 in / Box", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-BED"}, {"id": "jkl:K-NIGHTSTAND", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "TONSTAD Nightstand", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-NIGHTSTAND"}, {"id": "jkl:K-LAMP", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Deidra Metal Table Lamp", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-LAMP"}, {"id": "jkl:K-CHAIR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Terni armchair", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-CHAIR"}, {"id": "jkl:K-CONSOLE", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Sierra Media Stand", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-CONSOLE"}, {"id": "jkl:K-MIRROR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A58000418 Accent Mirror", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-MIRROR"}, {"id": "jkl:K-RUG", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Bodrum Hand-Knotted Grey Area Rug 6'x9'", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-RUG"}, {"id": "jkl:K-CEILING", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Blown SW3 & SW4", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-CEILING"}, {"id": "jkl:K-BEDSPREAD", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Q5001821K King Coverlet Set", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-BEDSPREAD"}, {"id": "jkl:K-PILLOWCASES", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "PB Classic 400TC Organic Cotton Percale Sheet Set", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-PILLOWCASES"}, {"id": "jkl:K-CUSHION", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Organic Cotton Basketweave 20\"x20\" Ink Black Throw Pillow Cover", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-CUSHION"}, {"id": "jkl:K-THROW", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A51000258 Throw", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-THROW"}, {"id": "jkl:K-ART", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A58000392 Wall Art", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-ART"}, {"id": "jkl:K-DECOR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Alder Glass Hurricane Candle Holder 10\"", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-DECOR"}, {"id": "jkl:K-PLANT", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A52000402 Vase", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-PLANT"}, {"id": "jkl:K-STEMS", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Faux Crystalized Branch 3.5'", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-K-STEMS"}, {"id": "jkl:L-BED", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Our Home Fidel Bedframe — King 72 x 78 in", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-BED"}, {"id": "jkl:L-NIGHTSTAND", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "IKEA PS 2026 Nightstand", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-NIGHTSTAND"}, {"id": "jkl:L-LAMP", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Alphalux Table Lamp E27", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-LAMP"}, {"id": "jkl:L-CHAIR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "ULRIKSBERG Armchair", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-CHAIR"}, {"id": "jkl:L-CONSOLE", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "HEMNES TV unit", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-CONSOLE"}, {"id": "jkl:L-MIRROR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "KOMPISHÄNG Floor mirror", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-MIRROR"}, {"id": "jkl:L-RUG", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "TIOKRONA Rug, flatwoven", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-RUG"}, {"id": "jkl:L-CEILING", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "NARRKOLV Pendant lamp", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-CEILING"}, {"id": "jkl:L-BEDSPREAD", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Faux Linen Natural Color Comforter", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-BEDSPREAD"}, {"id": "jkl:L-PILLOWCASES", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Faux Linen Natural Color 4pc Sheet Set", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-PILLOWCASES"}, {"id": "jkl:L-CUSHION", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "23'' Bubble Wool Mer Red Piece", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-CUSHION"}, {"id": "jkl:L-THROW", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Casual Textured Fringe 70\"x55\" Arctic Ivory Throw Blanket", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-THROW"}, {"id": "jkl:L-ART", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Mo's Crib Large Woven Wall Art", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-ART"}, {"id": "jkl:L-DECOR", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A52000153 Vase", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-DECOR"}, {"id": "jkl:L-BASKET", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Beane Basket by Jake Arnold", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-BASKET"}, {"id": "jkl:L-PLANT", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "A52000514 Vase", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-PLANT"}, {"id": "jkl:L-STEMS", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Faux Burgundy Peony Bunch", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-L-STEMS"}, {"id": "jkl:SYS-TV75", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "75-inch Crystal UHD TV UA75U8520HGXXP", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-SYS-TV75"}, {"id": "jkl:SYS-AC", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "TCL 1.5 HP split inverter TAC-13CSD/KEI2", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-SYS-AC"}, {"id": "jkl:SYS-MOUNT", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "True Vision extra-large TV wall mount TV73-69F, 60–120 in, 120 kg, VESA 400×300 listed", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-SYS-MOUNT"}, {"id": "jkl:CUR-BASE", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Master bedroom drapes + sheers,2 tracks,inverted pleats", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-CUR-BASE"}, {"id": "jkl:CUR-BOARD", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Finished valance/pelmet:1 of6 quoted areas", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-CUR-BOARD"}, {"id": "jkl:CUR-STICKS", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Four curtain pull sticks:1 of6 quoted areas", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-CUR-STICKS"}, {"id": "jkl:SHARED-FLAT-SHEET", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "DVALA flat sheet, white", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-SHARED-FLAT-SHEET"}, {"id": "jkl:SHARED-SLEEPING-PILLOWS", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "LAPPTATEL pillow, side/back sleeper", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-SHARED-SLEEPING-PILLOWS"}, {"id": "jkl:SHARED-RUG-UNDERLAY", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "STOPP FILT anti-slip rug underlay", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-SHARED-RUG-UNDERLAY"}, {"id": "jkl:SHARED-CUSHION-INSERT", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "INNER cushion insert, white", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-SHARED-CUSHION-INSERT"}, {"id": "jkl:LAMP-BULBS-E27", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "SOLHETTA E27 opal LED bulb 470 lm, 2-piece pack", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-LAMP-BULBS-E27"}, {"id": "jkl:LAMP-BULBS-E14", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "SOLHETTA E14 opal LED bulb 250 lm, 2-piece pack", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-LAMP-BULBS-E14"}, {"id": "jkl:REQUIRED-MATTRESS50", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Made-to-order mattress, finished 50 mm × 1828.8 × 1981.2 mm", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-REQUIRED-MATTRESS50"}, {"id": "jkl:REQUIRED-FLAT-DECK", "board": "jkl", "label": "three bedroom directions (J, K, L)", "name": "Continuous flat bed support and any frame adaptation", "url": "/bedroom-design-options/jkl/?shared-picks=1#row-REQUIRED-FLAT-DECK"}, {"id": "mno:M-BED", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Our Home Gervaise Bedframe — Light Brown/Walnut / King 72 x 78 in", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-BED"}, {"id": "mno:M-NIGHTSTAND", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Our Home Gervaise attached bedside drawer units (pair, part of M-BED)", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-NIGHTSTAND"}, {"id": "mno:M-LAMP", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Ebony Stone Jug Table Lamp", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-LAMP"}, {"id": "mno:M-CHAIR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Kartell Q/Wood Armchair", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-CHAIR"}, {"id": "mno:M-CONSOLE", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Our Home Farkins Tv Stand With Open Cabinet", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-CONSOLE"}, {"id": "mno:M-MIRROR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Muriel Floor Mirror", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-MIRROR"}, {"id": "mno:M-RUG", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Avignon Wool Flatweave Taupe Area Rug 6'x9'", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-RUG"}, {"id": "mno:M-CEILING", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Mega Bulb SR2", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-CEILING"}, {"id": "mno:M-BEDSPREAD", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "QUILT COVER NGRIP NHOTEL3 WH Q", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-BEDSPREAD"}, {"id": "mno:M-PILLOWCASES", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Aire Crinkle Organic Cotton Linen Blend Cotton Cream Standard Pillow Sham", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-PILLOWCASES"}, {"id": "mno:M-CUSHION", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Telas De Mercato Dapney", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-CUSHION"}, {"id": "mno:M-ART", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "A58000314 Wall Art", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-ART"}, {"id": "mno:M-PLANT", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Faux 3.5' Fiddle Leaf Fig Tree", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-PLANT"}, {"id": "mno:M-DECOR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "A52000122 Vase", "url": "/bedroom-design-options/mno/?shared-picks=1#row-M-DECOR"}, {"id": "mno:N-BED", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Our Home Francis Libiran Fulton Bedframe — Light Brown / King 72 x 78 in", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-BED"}, {"id": "mno:N-NIGHTSTAND", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Imogen Night Stand", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-NIGHTSTAND"}, {"id": "mno:N-LAMP", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "KUDDLAVA Table lamp", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-LAMP"}, {"id": "mno:N-CHAIR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "AGEN Armchair", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-CHAIR"}, {"id": "mno:N-CONSOLE", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "FRYKSÅS TV unit", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-CONSOLE"}, {"id": "mno:N-MIRROR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Heim Bontoc Rectangular Mirror Light Brown/Walnut 30x120cm", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-MIRROR"}, {"id": "mno:N-RUG", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "TELEGRAFLINJE Rug, flatwoven", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-RUG"}, {"id": "mno:N-CEILING", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "MISTERHULT Pendant lamp", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-CEILING"}, {"id": "mno:N-BEDSPREAD", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Uratex Premium Touch Duvet Cover", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-BEDSPREAD"}, {"id": "mno:N-PILLOWCASES", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Uratex Premium Touch Pillowcase", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-PILLOWCASES"}, {"id": "mno:N-CUSHION", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "FJUNKLOCKA Cushion cover", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-CUSHION"}, {"id": "mno:N-ART", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "A58000459 Wall Art", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-ART"}, {"id": "mno:N-PLANT", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Palm-stem composition: A52000503 chocolate cylinder vase", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-PLANT"}, {"id": "mno:N-STEMS", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Faux Green Palm Leaf Stem 66\"", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-STEMS"}, {"id": "mno:N-TRAY", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "A52000463 Tray", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-TRAY"}, {"id": "mno:N-DECOR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "A52000457 Vase", "url": "/bedroom-design-options/mno/?shared-picks=1#row-N-DECOR"}, {"id": "mno:O-BED", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "SLATTUM upholstered bed frame — Vissle dark gray, 180x200 cm", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-BED"}, {"id": "mno:O-NIGHTSTAND", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "GT01 Night Table – Dark Gray", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-NIGHTSTAND"}, {"id": "mno:O-LAMP", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Pantop Table Lamp", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-LAMP"}, {"id": "mno:O-CHAIR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "LILLEHEM Armchair", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-CHAIR"}, {"id": "mno:O-CONSOLE", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "WEST SIDEBOARD", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-CONSOLE"}, {"id": "mno:O-MIRROR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Aosta Black Wall Mirror 25\"x40\"", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-MIRROR"}, {"id": "mno:O-RUG", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Safi Diamond Moroccan Dark Grey Area Rug 6'x9'", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-RUG"}, {"id": "mno:O-CEILING", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Flowerpot VP1", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-CEILING"}, {"id": "mno:O-BEDSPREAD", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Uratex Wink Duvet Cover", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-BEDSPREAD"}, {"id": "mno:O-PILLOWCASES", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Cozysoft Organic Jersey Charcoal Grey Queen Sheet Set", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-PILLOWCASES"}, {"id": "mno:O-CUSHION", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "KORALLBUSKE Cushion cover", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-CUSHION"}, {"id": "mno:O-ART", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "A58000255 Wall Art", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-ART"}, {"id": "mno:O-PLANT", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "60CM MONSTERA IN CEMENT POT HA47139GN", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-PLANT"}, {"id": "mno:O-DECOR", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "A52000253 Candle Holder", "url": "/bedroom-design-options/mno/?shared-picks=1#row-O-DECOR"}, {"id": "mno:DUVET-INSERT", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Comforter & Duvet Insert White", "url": "/bedroom-design-options/mno/?shared-picks=1#row-DUVET-INSERT"}, {"id": "mno:SYS-TV75", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "75-inch Crystal UHD TV UA75U8520HGXXP", "url": "/bedroom-design-options/mno/?shared-picks=1#row-SYS-TV75"}, {"id": "mno:SYS-AC", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "TCL 1.5 HP split inverter TAC-13CSD/KEI2", "url": "/bedroom-design-options/mno/?shared-picks=1#row-SYS-AC"}, {"id": "mno:SYS-MOUNT", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "True Vision extra-large TV wall mount TV73-69F, 60–120 in, 120 kg, VESA 400×300 listed", "url": "/bedroom-design-options/mno/?shared-picks=1#row-SYS-MOUNT"}, {"id": "mno:CUR-BASE", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Master bedroom drapes + sheers,2 tracks,inverted pleats", "url": "/bedroom-design-options/mno/?shared-picks=1#row-CUR-BASE"}, {"id": "mno:CUR-BOARD", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Finished valance/pelmet:1 of6 quoted areas", "url": "/bedroom-design-options/mno/?shared-picks=1#row-CUR-BOARD"}, {"id": "mno:CUR-STICKS", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Four curtain pull sticks:1 of6 quoted areas", "url": "/bedroom-design-options/mno/?shared-picks=1#row-CUR-STICKS"}, {"id": "mno:SHARED-FLAT-SHEET", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "DVALA flat sheet, white", "url": "/bedroom-design-options/mno/?shared-picks=1#row-SHARED-FLAT-SHEET"}, {"id": "mno:SHARED-SLEEPING-PILLOWS", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "LAPPTATEL pillow, side/back sleeper", "url": "/bedroom-design-options/mno/?shared-picks=1#row-SHARED-SLEEPING-PILLOWS"}, {"id": "mno:SHARED-RUG-UNDERLAY", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "STOPP FILT anti-slip rug underlay", "url": "/bedroom-design-options/mno/?shared-picks=1#row-SHARED-RUG-UNDERLAY"}, {"id": "mno:SHARED-CUSHION-INSERT", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "INNER cushion insert, white", "url": "/bedroom-design-options/mno/?shared-picks=1#row-SHARED-CUSHION-INSERT"}, {"id": "mno:LAMP-BULBS-E27", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "SOLHETTA E27 opal LED bulb 470 lm, 2-piece pack", "url": "/bedroom-design-options/mno/?shared-picks=1#row-LAMP-BULBS-E27"}, {"id": "mno:REQUIRED-MATTRESS50", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Made-to-order mattress, finished 50 mm × 1828.8 × 1981.2 mm", "url": "/bedroom-design-options/mno/?shared-picks=1#row-REQUIRED-MATTRESS50"}, {"id": "mno:REQUIRED-FLAT-DECK", "board": "mno", "label": "three bedroom directions (M, N, O)", "name": "Continuous flat bed support and any frame adaptation", "url": "/bedroom-design-options/mno/?shared-picks=1#row-REQUIRED-FLAT-DECK"}];
  const board = "jkl";
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
// END UNIT408 SHARED PICKS
