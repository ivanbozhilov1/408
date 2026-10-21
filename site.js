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
  const KEY = 'unit408-picks-v1';
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
  let picked = load();
  const importHash = () => {
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
    const items = [...picked].map(info);
    counts.forEach(count => {count.textContent = String(items.length);});
    rows.forEach((row, id) => {
      const on = picked.has(id), button = row.querySelector('[data-pick]');
      row.classList.toggle('is-picked', on);
      if (button) {button.setAttribute('aria-pressed', String(on)); button.firstElementChild.textContent = on ? '★' : '☆';}
    });
    const filled = groups.map(group => {
      const own = items.filter(item => item.group === group.id);
      return {...group, items: own, sum: own.reduce((total, item) => total + (item.line ?? 0), 0), open: own.filter(item => item.line === null).length};
    }).filter(group => group.items.length);
    if (!filled.length) {list.innerHTML = '<p class="picks-empty">No starred pieces yet.</p>'; text.value = ''; return;}
    list.innerHTML = filled.map(group => `<div class="picks-group"><h3>${escape(group.label)}${escape(group.title)}<span>${group.items.length} ${group.items.length === 1 ? 'piece' : 'pieces'} · ${peso(group.sum)}${group.open ? ` + ${group.open} quote` : ''}</span></h3><ul>${group.items.map(item => `<li><button type="button" class="pick" data-pick="${escape(item.id)}" aria-label="Remove ${escape(item.name)} from picks"><span aria-hidden="true">★</span></button><div><span class="role">${escape(item.role)}</span><a class="piece-name" href="#row-${escape(item.id)}">${escape(item.name)}</a><span class="item-meta">${escape(item.meta)}${item.variant ? ` · ${escape(item.variant)}` : ''}</span></div><span class="numeric">${item.line === null ? 'Quote required' : peso(item.line)}</span></li>`).join('')}</ul></div>`).join('');
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
    if (!button) return;
    const id = button.dataset.pick;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    save(); render(); setStatus('');
  });
  document.querySelectorAll('[data-picks-copy]').forEach(button => button.addEventListener('click', async () => {
    if (!picked.size) {setStatus('Star a piece first.'); return;}
    const asLink = button.dataset.picksCopy === 'link', value = asLink ? link() : text.value;
    if (await copy(value)) setStatus(asLink ? 'Link copied. Paste it in a message; it opens with the same stars.' : 'List copied. Paste it in a message.');
    else {text.closest('details').open = true; text.focus(); text.select(); setStatus('The browser blocked copying. Select the text below and copy it.');}
  }));
  document.querySelector('[data-picks-clear]')?.addEventListener('click', () => {
    if (!picked.size || !confirm('Remove all starred pieces?')) return;
    picked.clear(); save(); render(); setStatus('All stars removed.');
  });
  render();
  const reveal = () => document.getElementById('picks')?.scrollIntoView({block: 'start'});
  if (shared) reveal();
  window.addEventListener('hashchange', () => {if (importHash()) {render(); reveal();}});
})();
