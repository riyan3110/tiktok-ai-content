(() => {
  'use strict';
  const esc = value => { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; };
  const attr = value => esc(value).replace(/"/g, '&quot;');
  const card = item => {
    const image = item.image ? `<img src="${attr(item.image)}" alt="" loading="lazy">` : '';
    let source = 'Sumber berita'; try { source = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
    return `<button class="neo-news-card" type="button" data-news-url="${attr(item.url)}">${image}<span class="neo-news-copy"><b>${esc(item.title)}</b><small>${esc(source)}</small><em>Salin URL</em></span></button>`;
  };
  async function load(track) {
    try {
      const response = await fetch('/api/live-news', { headers: { Accept: 'application/json' } });
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      track.innerHTML = items.length ? items.map(card).join('') : '<div class="neo-news-empty">Berita live belum tersedia.</div>';
    } catch { track.innerHTML = '<div class="neo-news-empty">Berita live gagal dimuat.</div>'; }
  }
  async function copy(url, toast) {
    try { await navigator.clipboard.writeText(url); toast.textContent = 'URL berita tersalin'; } catch { toast.textContent = url; }
    toast.classList.add('show'); clearTimeout(copy.timer); copy.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }
  window.LiveNewsDashboard = { load, copy };
})();
