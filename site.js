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
