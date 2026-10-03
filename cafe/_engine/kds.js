/* Staff screen: open tables (code, people, bill), live rounds by table, sortable and filterable,
   waiter/bill calls, day summary. */
(function () {
  const { C, $, inr, esc, store, ago, vegDot, items } = WW;
  const st = { sort: 'old', table: 'all' };
  const cols = [['new', 'New'], ['prep', 'Preparing'], ['ready', 'Ready to serve']];
  const next = { new: ['prep', 'Accept'], prep: ['ready', 'Mark ready'], ready: ['served', 'Served'] };
  const gst = C.gst ?? 5;

  const tSel = $('#ft');
  for (let i = 1; i <= C.tables; i++) tSel.add(new Option('Table ' + i, String(i)));
  tSel.onchange = () => { st.table = tSel.value; render(); };
  $('#fs').onchange = e => { st.sort = e.target.value; render(); };
  $('#reset').onclick = () => { if (confirm('Clear all demo tables and orders?')) { store.reset(); seed(); } };

  const tbill = (d, t, s) => {
    const os = d.orders.filter(o => o.table === t && o.code === s.code), total = os.reduce((a, o) => a + o.total, 0);
    const paid = (s.payments || []).reduce((a, p) => a + p.amt, 0);
    return { total, paid, due: Math.max(0, total - paid), rounds: os.length };
  };

  /* seed a believable rush so the screen is never empty on first open */
  function seed() {
    const d = store.read(); if (d.orders.length) return;
    const pick = (k, by) => { const it = items[(k * 7 + 3) % items.length]; return { n: it.n, q: 1 + (k % 2), p: it.p, veg: it.veg, by }; };
    const sessions = {}, orders = [];
    let no = 0;
    const tableS = (t, code, people, rounds, paidAll) => {
      sessions[t] = { code, ts: Date.now() - 40 * 60000, people, cart: {}, payments: [] };
      rounds.forEach(([ks, status, mins, note], r) => {
        const its = ks.map((k, i) => pick(k, [people[i % people.length]])), sub = its.reduce((s, i) => s + i.p * i.q, 0), tax = Math.round(sub * gst / 100);
        orders.push({ id: 'seed' + (++no), no, table: t, code, round: r + 1, items: its, by: [...new Set(its.flatMap(i => i.by))], note: note || '', sub, tax, total: sub + tax, status, ts: Date.now() - mins * 60000 });
      });
      if (paidAll) sessions[t].payments.push({ by: people[0], amt: orders.filter(o => o.table === t).reduce((a, o) => a + o.total, 0), ts: Date.now() });
    };
    tableS('2', '4821', ['Riya', 'Aman'], [[[0, 5], 'served', 34], [[9], 'ready', 12]], false);
    tableS('7', '1937', ['Kabir', 'Zoya', 'Neel'], [[[1, 2, 3], 'prep', 9, 'One without sugar']], false);
    tableS('5', '6604', ['Sana'], [[[4], 'prep', 6]], true);
    tableS('9', '2750', ['Dev', 'Ira'], [[[6, 8], 'new', 1]], false);
    store.write({ seq: no, sessions, orders, calls: [{ table: '2', type: 'bill', ts: Date.now() - 60000 }] });
  }

  let lastSeen = 0;
  function chime() {
    try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(.15, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .6); o.start(); o.stop(a.currentTime + .6); } catch (e) {}
  }

  function card(o, d) {
    const nx = next[o.status], s = (d.sessions || {})[o.table], b = s && s.code === o.code ? tbill(d, o.table, s) : null;
    return `<article class="ord ${b && b.due ? 'unpaid' : ''}" data-id="${o.id}">
      <header><span class="tno">T${esc(o.table)}</span><b>#${o.no}</b><small class="rnd">Round ${o.round || 1}</small><time>${ago(o.ts)}</time></header>
      <ul>${o.items.map(i => `<li>${vegDot(i.veg)}<span>${i.q} × ${esc(i.n)}</span>${i.by ? `<em>${esc(i.by.join(', '))}</em>` : ''}</li>`).join('')}</ul>
      ${o.note ? `<p class="onote">“${esc(o.note)}”</p>` : ''}
      <footer><span class="pay ${b && b.due ? 'due' : 'ok'}">${b ? (b.due ? 'Table owes ' + inr(b.due) : 'Table settled') : 'Closed'}</span>
        ${nx ? `<button class="go" data-act="${nx[0]}">${nx[1]}</button>` : ''}</footer></article>`;
  }

  function render() {
    const d = store.read(), ses = d.sessions || {};
    const newest = Math.max(0, ...d.orders.map(o => o.ts));
    if (lastSeen && newest > lastSeen) chime();
    lastSeen = newest;

    $('#tables').innerHTML = Object.keys(ses).length
      ? Object.entries(ses).sort((a, b) => a[0] - b[0]).map(([t, s]) => {
          const b = tbill(d, t, s), inCart = Object.values(s.cart || {}).reduce((a, l) => a + l.q, 0);
          return `<div class="tcard" data-t="${t}"><div class="th"><span class="tno">T${esc(t)}</span><span class="code">${s.code}</span></div>
            <p>${s.people.map(esc).join(', ')}</p>
            <p class="tb">${b.rounds} round${b.rounds === 1 ? '' : 's'} · ${inr(b.total)}${inCart ? ` · ${inCart} in cart` : ''}</p>
            <p class="${b.due ? 'due' : 'ok'}"><b>${b.due ? inr(b.due) + ' due' : b.total ? 'Paid' : 'Browsing'}</b></p>
            <div class="ta">${b.due ? `<button class="mini" data-t-act="paid">Cash / card paid</button>` : ''}<button class="mini" data-t-act="close">Close table</button></div></div>`;
        }).join('')
      : '<span class="quiet">No tables open. A table opens when the first guest scans and starts it.</span>';

    let os = d.orders.filter(o => o.status !== 'served' && (st.table === 'all' || o.table === st.table));
    os.sort(st.sort === 'old' ? (a, b) => a.ts - b.ts : st.sort === 'new' ? (a, b) => b.ts - a.ts : (a, b) => a.table - b.table || a.ts - b.ts);
    $('#board').innerHTML = cols.map(([k, label]) => {
      const list = os.filter(o => o.status === k);
      return `<section class="col"><h2>${label}<span>${list.length}</span></h2>${list.map(o => card(o, d)).join('') || '<p class="none">Nothing here</p>'}</section>`;
    }).join('');

    const calls = d.calls.slice(-6).reverse();
    $('#calls').innerHTML = calls.length
      ? calls.map((c, i) => `<button class="call ${c.type}" data-i="${d.calls.length - 1 - i}"><b>T${esc(c.table)}</b> ${c.type === 'bill' ? 'wants the bill' : 'is calling a server'} · ${ago(c.ts)} <u>Done</u></button>`).join('')
      : '<span class="quiet">No table calls right now</span>';

    const rev = d.orders.reduce((s, o) => s + o.total, 0);
    const due = Object.entries(ses).reduce((a, [t, s]) => a + tbill(d, t, s).due, 0);
    $('#stats').innerHTML = [['Rounds today', d.orders.length], ['Sales', inr(rev)], ['Avg round', inr(d.orders.length ? rev / d.orders.length : 0)], ['Unpaid', inr(due)], ['Tables open', Object.keys(ses).length + ' / ' + C.tables]]
      .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  }

  $('#board').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.closest('.ord').dataset.id;
    store.update(d => { d.orders.find(o => o.id === id).status = b.dataset.act; });
  });
  $('#tables').addEventListener('click', e => {
    const b = e.target.closest('button[data-t-act]'); if (!b) return;
    const t = b.closest('.tcard').dataset.t;
    store.update(d => {
      const s = d.sessions[t], bl = tbill(d, t, s);
      if (b.dataset.tAct === 'paid') s.payments.push({ by: 'Counter', amt: bl.due, ts: Date.now() });
      else if (!bl.due || confirm(`Table ${t} still owes ${inr(bl.due)}. Close anyway?`)) delete d.sessions[t];
    });
  });
  $('#calls').addEventListener('click', e => {
    const b = e.target.closest('.call'); if (!b) return;
    store.update(d => d.calls.splice(+b.dataset.i, 1));
  });

  seed(); store.sub(render); render();
  setInterval(render, 30000);
})();
