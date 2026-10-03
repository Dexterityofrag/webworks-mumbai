/* Cafe QR engine: shared store, theme motifs, helpers. Config arrives as window.CAFE. */
(function () {
  const C = window.CAFE;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Order store. Demo: localStorage + BroadcastChannel (syncs tabs on one device).
     Live: swap read/write for a Supabase table; the rest of the engine is unchanged. */
  function Store(slug) {
    const K = 'ww-cafe:' + slug, subs = [];
    const blank = () => ({ orders: [], calls: [], seq: 0, sessions: {} });
    let mem = blank();
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel(K) : null;
    const read = () => { try { return JSON.parse(localStorage.getItem(K)) || mem; } catch (e) { return mem; } };
    const emit = d => subs.forEach(f => f(d));
    const write = d => { mem = d; try { localStorage.setItem(K, JSON.stringify(d)); } catch (e) {} bc && bc.postMessage(1); emit(d); };
    bc && (bc.onmessage = () => emit(read()));
    addEventListener('storage', e => e.key === K && emit(read()));
    return { read, write, sub: f => subs.push(f), update(fn) { const d = read(); fn(d); write(d); return d; }, reset() { write(blank()); } };
  }

  /* Motifs: small SVG tiles coloured from the theme, used as a CSS background. */
  function motif(name, c) {
    const a = c.motifA || c.accent, b = c.motifB || c.accent2 || a, bg = c.motifBg || c.bg, ink = c.motifInk || c.ink;
    const t = {
      azulejo: [56, `<rect width="56" height="56" fill="${bg}"/><path d="M28 6c5 8 5 14 0 22-5-8-5-14 0-22zM28 50c5-8 5-14 0-22-5 8-5 14 0 22zM6 28c8-5 14-5 22 0-8 5-14 5-22 0zM50 28c-8-5-14-5-22 0 8 5 14 5 22 0z" fill="${a}"/><circle cx="28" cy="28" r="4" fill="${b}"/><path d="M0 0h10L0 10zM56 0H46l10 10zM0 56h10L0 46zM56 56H46l10-10z" fill="${a}"/><rect width="56" height="56" fill="none" stroke="${a}" stroke-opacity=".35"/>`],
      checker: [24, `<rect width="24" height="24" fill="${bg}"/><rect width="12" height="12" fill="${ink}"/><rect x="12" y="12" width="12" height="12" fill="${ink}"/>`],
      quilt: [28, `<rect width="28" height="28" fill="${a}"/><path d="M0 14L14 0l14 14-14 14z" fill="none" stroke="${b}" stroke-opacity=".55" stroke-width="1.2"/><circle cx="14" cy="0" r="1.6" fill="${b}"/><circle cx="14" cy="28" r="1.6" fill="${b}"/><circle cx="0" cy="14" r="1.6" fill="${b}"/><circle cx="28" cy="14" r="1.6" fill="${b}"/>`],
      grid: [36, `<rect width="36" height="36" fill="${bg}"/><path d="M0 .5h36M.5 0v36" stroke="${a}" stroke-opacity=".5"/>`],
      tile: [40, `<rect width="40" height="40" fill="${bg}"/><rect x="1" y="1" width="18" height="38" rx="1" fill="${a}"/><rect x="21" y="1" width="18" height="38" rx="1" fill="${a}" fill-opacity=".82"/>`],
      flowers: [64, `<rect width="64" height="64" fill="${bg}"/><g fill="${a}"><circle cx="16" cy="12" r="4"/><circle cx="22" cy="17" r="4"/><circle cx="20" cy="24" r="4"/><circle cx="12" cy="24" r="4"/><circle cx="10" cy="17" r="4"/></g><circle cx="16" cy="19" r="3" fill="${b}"/><g fill="${b}" fill-opacity=".9"><circle cx="48" cy="44" r="3"/><circle cx="52" cy="48" r="3"/><circle cx="50" cy="53" r="3"/><circle cx="45" cy="53" r="3"/><circle cx="43" cy="48" r="3"/></g><circle cx="47.5" cy="49.5" r="2" fill="${a}"/>`],
      glow: [90, `<rect width="90" height="90" fill="${bg}"/><defs><radialGradient id="g"><stop offset="0" stop-color="${a}" stop-opacity=".9"/><stop offset=".25" stop-color="${a}" stop-opacity=".25"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient></defs><circle cx="20" cy="22" r="16" fill="url(#g)"/><circle cx="66" cy="60" r="12" fill="url(#g)"/><circle cx="72" cy="14" r="7" fill="url(#g)"/>`],
      waves: [60, `<rect width="60" height="20" fill="${bg}"/><path d="M0 10q7.5-8 15 0t15 0 15 0 15 0" fill="none" stroke="${a}" stroke-width="2"/>`, 20],
    }[name];
    if (!t) return 'none';
    const [w, body, h = w] = t;
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)}")`;
  }

  function applyTheme() {
    const c = C.theme.c;
    document.documentElement.style.setProperty('--motif', motif(C.theme.motif, c));
    if (C.theme.motif2) document.documentElement.style.setProperty('--motif2', motif(C.theme.motif2, c));
  }

  function qrSvg(text, cell = 4) {
    if (!window.qrcode) return '';
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
  }

  const vegDot = v => `<i class="vd ${v ? 'veg' : 'nv'}" title="${v ? 'Vegetarian' : 'Non-vegetarian'}"></i>`;
  const ago = ts => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ago'; };

  /* Flatten compact menu rows [name, price, veg, desc, tag, protein] into objects with stable ids. */
  /* Per-table QR token: the printed QR carries ?t=<table>&k=<token>, so editing the URL to another
     table number doesn't work. Same FNV-1a hash as build.py. Live version: token checked server side. */
  const tok = t => { let h = 0x811c9dc5; for (const ch of C.slug + ':' + t + ':' + (C.salt || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36).slice(0, 6); };
  const tableUrl = (base, t) => base + '?t=' + t + '&k=' + tok(t);

  const items = [];
  C.sections.forEach((s, si) => s.items.forEach((r, ii) => items.push({
    id: si + '-' + ii, sec: si, n: r[0], p: r[1], veg: !!r[2], d: r[3] || '', tag: r[4] || '', pro: r[5] || 0, order: items.length,
  })));

  window.WW = { C, $, $$, inr, esc, store: Store(C.slug), applyTheme, qrSvg, vegDot, ago, items, tok, tableUrl };
  applyTheme();
})();
