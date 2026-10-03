/* Staff screen: live orders by table, sortable and filterable, waiter/bill calls, day summary. */
(function () {
  const { C, $, inr, esc, store, ago, vegDot, items } = WW;
  const st = { sort: 'old', table: 'all' };
  const cols = [['new', 'New'], ['prep', 'Preparing'], ['ready', 'Ready to serve']];
  const next = { new: ['prep', 'Accept'], prep: ['ready', 'Mark ready'], ready: ['served', 'Served'] };

  const tSel = $('#ft');
  for (let i = 1; i <= C.tables; i++) tSel.add(new Option('Table ' + i, String(i)));
  tSel.onchange = () => { st.table = tSel.value; render(); };
  $('#fs').onchange = e => { st.sort = e.target.value; render(); };
  $('#reset').onclick = () => { if (confirm('Clear all demo orders?')) { store.reset(); seed(); } };

  /* seed a believable rush so the screen is never empty on first open */
  function seed() {
    const d = store.read(); if (d.orders.length) return;
    const pick = (k) => { const it = items[(k * 7 + 3) % items.length]; return { n: it.n, q: 1 + (k % 2), p: it.p, veg: it.veg }; };
    const mk = (no, table, ks, status, pay, mins, note = '') => {
      const its = ks.map(pick), sub = its.reduce((s, i) => s + i.p * i.q, 0), tax = Math.round(sub * (C.gst ?? 5) / 100);
      return { id: 'seed' + no, no, table: String(table), items: its, note, sub, tax, total: sub + tax, pay, paid: pay === 'upi', status, ts: Date.now() - mins * 60000 };
    };
    store.write({
      seq: 4, calls: [{ table: '9', type: 'bill', ts: Date.now() - 60000 }],
      orders: [mk(1, 2, [0, 5], 'ready', 'upi', 14), mk(2, 7, [1, 2, 3], 'prep', 'counter', 9, 'One without sugar'), mk(3, 5, [4], 'prep', 'upi', 6), mk(4, 11, [6, 8], 'new', 'upi', 1)],
    });
  }

  let lastSeen = 0;
  function chime() {
    try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(.15, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .6); o.start(); o.stop(a.currentTime + .6); } catch (e) {}
  }

  function card(o) {
    const nx = next[o.status];
    return `<article class="ord ${o.paid ? '' : 'unpaid'}" data-id="${o.id}">
      <header><span class="tno">T${esc(o.table)}</span><b>#${o.no}</b><time>${ago(o.ts)}</time></header>
      <ul>${o.items.map(i => `<li>${vegDot(i.veg)}<span>${i.q} × ${esc(i.n)}</span></li>`).join('')}</ul>
      ${o.note ? `<p class="onote">“${esc(o.note)}”</p>` : ''}
      <footer><span class="pay ${o.paid ? 'ok' : 'due'}">${o.paid ? 'UPI paid' : 'Collect ' + inr(o.total)}</span>
        ${!o.paid ? `<button class="mini" data-act="paid">Paid</button>` : ''}
        ${nx ? `<button class="go" data-act="${nx[0]}">${nx[1]}</button>` : ''}</footer></article>`;
  }

  function render() {
    const d = store.read();
    const newest = Math.max(0, ...d.orders.map(o => o.ts));
    if (lastSeen && newest > lastSeen) chime();
    lastSeen = newest;

    let os = d.orders.filter(o => o.status !== 'served' && (st.table === 'all' || o.table === st.table));
    os.sort(st.sort === 'old' ? (a, b) => a.ts - b.ts : st.sort === 'new' ? (a, b) => b.ts - a.ts : (a, b) => a.table - b.table || a.ts - b.ts);
    $('#board').innerHTML = cols.map(([k, label]) => {
      const list = os.filter(o => o.status === k);
      return `<section class="col"><h2>${label}<span>${list.length}</span></h2>${list.map(card).join('') || '<p class="none">Nothing here</p>'}</section>`;
    }).join('');

    const calls = d.calls.slice(-6).reverse();
    $('#calls').innerHTML = calls.length
      ? calls.map((c, i) => `<button class="call ${c.type}" data-i="${d.calls.length - 1 - i}"><b>T${esc(c.table)}</b> ${c.type === 'bill' ? 'wants the bill' : 'is calling a server'} · ${ago(c.ts)} <u>Done</u></button>`).join('')
      : '<span class="quiet">No table calls right now</span>';

    const today = d.orders, rev = today.reduce((s, o) => s + o.total, 0), due = today.filter(o => !o.paid).reduce((s, o) => s + o.total, 0);
    const busy = new Set(os.map(o => o.table)).size;
    $('#stats').innerHTML = [['Orders today', today.length], ['Sales', inr(rev)], ['Avg bill', inr(today.length ? rev / today.length : 0)], ['Unpaid', inr(due)], ['Tables active', busy + ' / ' + C.tables]]
      .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  }

  $('#board').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.closest('.ord').dataset.id, act = b.dataset.act;
    store.update(d => { const o = d.orders.find(o => o.id === id); if (act === 'paid') o.paid = true; else o.status = act; });
  });
  $('#calls').addEventListener('click', e => {
    const b = e.target.closest('.call'); if (!b) return;
    store.update(d => d.calls.splice(+b.dataset.i, 1));
  });

  seed(); store.sub(render); render();
  setInterval(render, 30000);
})();
