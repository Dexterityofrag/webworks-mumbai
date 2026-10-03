/* Guest-facing QR menu: browse, filter, sort, cart, UPI or counter pay, live order status, waiter calls. */
(function () {
  const { C, $, $$, inr, esc, store, qrSvg, vegDot, items } = WW;
  const qs = new URLSearchParams(location.search);
  let table = qs.get('t') || '4';
  const cart = new Map();
  const st = { q: '', veg: false, sort: 'rec', mine: null };
  const gst = C.gst ?? 5;

  /* ---------- header bits ---------- */
  $('#tableNo').textContent = $('#barTbl').textContent = table;
  const sel = $('#tableSel');
  for (let i = 1; i <= C.tables; i++) sel.add(new Option('Table ' + i, i, false, String(i) === table));
  sel.onchange = () => { table = sel.value; $('#tableNo').textContent = $('#barTbl').textContent = table; history.replaceState(null, '', '?t=' + table); renderTrack(); };

  const sortSel = $('#sort');
  if (C.features?.protein) sortSel.add(new Option('Protein: high to low', 'pro'));
  sortSel.onchange = () => { st.sort = sortSel.value; render(); };
  $('#q').oninput = e => { st.q = e.target.value.trim().toLowerCase(); render(); };
  $('#veg').onchange = e => { st.veg = e.target.checked; render(); };

  /* category chips */
  const chips = $('#chips');
  chips.innerHTML = C.sections.map((s, i) => `<a href="#s${i}" class="chip">${esc(s.name)}</a>`).join('');

  /* ---------- menu ---------- */
  const sorters = {
    rec: (a, b) => (b.tag ? 1 : 0) - (a.tag ? 1 : 0) || a.order - b.order,
    lo: (a, b) => a.p - b.p, hi: (a, b) => b.p - a.p,
    az: (a, b) => a.n.localeCompare(b.n), pro: (a, b) => b.pro - a.pro,
  };
  function itemHTML(it) {
    const q = cart.get(it.id) || 0;
    return `<article class="item${q ? ' in' : ''}" data-id="${it.id}">
      <div class="it-main">
        <h4>${vegDot(it.veg)}<span>${esc(it.n)}</span>${it.tag ? `<em class="tag">${esc(it.tag)}</em>` : ''}</h4>
        ${it.d ? `<p>${esc(it.d)}</p>` : ''}
        ${it.pro ? `<small class="pro">${it.pro} g protein</small>` : ''}
      </div>
      <span class="lead"></span>
      <div class="it-side"><b class="price">${inr(it.p)}</b>
        ${q ? `<div class="step"><button data-a="-" aria-label="Remove one">−</button><span>${q}</span><button data-a="+" aria-label="Add one">+</button></div>`
            : `<button class="add" data-a="+">Add</button>`}
      </div></article>`;
  }
  function render() {
    let list = items.filter(it => (!st.veg || it.veg) && (!st.q || (it.n + ' ' + it.d).toLowerCase().includes(st.q)));
    const flat = st.sort !== 'rec' || st.q;
    list = list.slice().sort(sorters[st.sort]);
    const out = flat
      ? `<section class="sec"><header class="sec-h"><h3>${st.q ? 'Results for “' + esc(st.q) + '”' : esc(sortSel.selectedOptions[0].text)}</h3><span>${list.length} items</span></header>${list.map(itemHTML).join('') || '<p class="empty">Nothing matches. Try another word.</p>'}</section>`
      : C.sections.map((s, i) => {
          const its = list.filter(x => x.sec === i);
          return its.length ? `<section class="sec" id="s${i}"><header class="sec-h"><h3>${esc(s.name)}</h3>${s.note ? `<span>${esc(s.note)}</span>` : ''}</header>${its.map(itemHTML).join('')}</section>` : '';
        }).join('');
    $('#menu').innerHTML = out;
    chips.style.display = flat ? 'none' : '';
    renderBar();
  }
  $('#menu').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const id = b.closest('.item').dataset.id, q = (cart.get(id) || 0) + (b.dataset.a === '+' ? 1 : -1);
    q > 0 ? cart.set(id, q) : cart.delete(id);
    const el = b.closest('.item'); el.outerHTML = itemHTML(items.find(x => x.id === id));
    renderBar(); bump();
  });

  /* ---------- cart ---------- */
  const lines = () => [...cart].map(([id, q]) => ({ ...items.find(x => x.id === id), q }));
  const totals = () => { const sub = lines().reduce((s, l) => s + l.p * l.q, 0), tax = Math.round(sub * gst / 100); return { sub, tax, total: sub + tax }; };
  function renderBar() {
    const n = [...cart.values()].reduce((a, b) => a + b, 0), bar = $('#bar');
    bar.classList.toggle('show', n > 0);
    $('#barN').textContent = n + (n === 1 ? ' item' : ' items');
    $('#barT').textContent = inr(totals().sub);
  }
  function bump() { const b = $('#bar'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }

  const sheet = $('#sheet');
  const openSheet = html => { $('#sheetBody').innerHTML = html; sheet.classList.add('open'); document.body.classList.add('lock'); };
  const closeSheet = () => { sheet.classList.remove('open'); document.body.classList.remove('lock'); };
  sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });

  function cartView() {
    const t = totals();
    openSheet(`<header class="sh-h"><h3>Your order · Table ${esc(table)}</h3><button data-close aria-label="Close">✕</button></header>
      <ul class="lines">${lines().map(l => `<li>${vegDot(l.veg)}<span>${esc(l.n)}</span><div class="step sm" data-id="${l.id}"><button data-c="-">−</button><span>${l.q}</span><button data-c="+">+</button></div><b>${inr(l.p * l.q)}</b></li>`).join('')}</ul>
      <textarea id="note" rows="2" placeholder="Anything for the kitchen? Less spicy, no onion, extra hot…"></textarea>
      <dl class="tot"><dt>Subtotal</dt><dd>${inr(t.sub)}</dd><dt>GST ${gst}%</dt><dd>${inr(t.tax)}</dd><dt class="g">To pay</dt><dd class="g">${inr(t.total)}</dd></dl>
      <div class="pay">
        <button class="btn pri" id="payUpi">Pay ${inr(t.total)} with UPI</button>
        <button class="btn ghost" id="payLater">Place order, pay at the end</button>
      </div>
      <p class="fine">UPI goes straight to ${esc(C.name)}'s bank account. No gateway fee, no commission.</p>`);
    $('#sheetBody .lines').onclick = e => {
      const b = e.target.closest('button[data-c]'); if (!b) return;
      const id = b.parentElement.dataset.id, q = (cart.get(id) || 0) + (b.dataset.c === '+' ? 1 : -1);
      q > 0 ? cart.set(id, q) : cart.delete(id);
      render(); cart.size ? cartView() : closeSheet();
    };
    $('#payUpi').onclick = () => upiView();
    $('#payLater').onclick = () => place('counter', false);
  }
  $('#bar').onclick = cartView;

  function upiLink(amount, no) {
    const p = new URLSearchParams({ pa: C.upi, pn: C.name, am: amount.toFixed(2), cu: 'INR', tn: `Table ${table} order ${no}` });
    return 'upi://pay?' + p.toString();
  }
  function upiView() {
    const t = totals(), note = $('#note')?.value || '', no = store.read().seq + 1, link = upiLink(t.total, no);
    st.note = note;
    openSheet(`<header class="sh-h"><h3>Pay ${inr(t.total)}</h3><button data-close aria-label="Close">✕</button></header>
      <p class="muted">On a phone this button opens GPay, PhonePe, Paytm or any UPI app with the amount and table already filled in.</p>
      <div class="apps"><span>GPay</span><span>PhonePe</span><span>Paytm</span><span>BHIM</span></div>
      <div class="upiqr">${qrSvg(link, 5)}<small>Or scan from another phone</small></div>
      ${C.demo ? `<div class="demo-note">Preview mode: the UPI ID here is a placeholder, so no real payment happens. Tap below to see what the kitchen sees after a paid order.</div>
        <button class="btn pri" id="paid">Simulate successful payment</button>`
      : `<a class="btn pri" href="${link}" id="openUpi">Open UPI app</a><button class="btn ghost" id="paid">I have paid</button>`}`);
    $('#paid').onclick = () => place('upi', true);
  }

  function place(pay, paid) {
    const t = totals(), note = $('#note')?.value || st.note || '';
    const d = store.update(d => {
      d.seq += 1;
      d.orders.push({ id: Date.now().toString(36), no: d.seq, table, items: lines().map(l => ({ n: l.n, q: l.q, p: l.p, veg: l.veg })), note, ...t, pay, paid, status: 'new', ts: Date.now() });
    });
    st.mine = d.orders[d.orders.length - 1].id;
    try { sessionStorage.setItem('mine:' + C.slug, st.mine); } catch (e) {}
    cart.clear(); render(); closeSheet(); renderTrack(); toast(`Order #${d.seq} sent to the kitchen`);
  }

  /* ---------- live status + waiter calls ---------- */
  try { st.mine = sessionStorage.getItem('mine:' + C.slug); } catch (e) {}
  const steps = [['new', 'Received'], ['prep', 'Preparing'], ['ready', 'On its way'], ['served', 'Served']];
  function renderTrack() {
    const o = store.read().orders.find(o => o.id === st.mine), el = $('#track');
    if (!o) { el.hidden = true; return; }
    const k = steps.findIndex(s => s[0] === o.status);
    el.hidden = false;
    el.innerHTML = `<div class="tr-h"><b>Order #${o.no} · Table ${esc(o.table)}</b><span class="${o.paid ? 'ok' : 'due'}">${o.paid ? 'Paid by UPI' : 'Pay at the end'}</span></div>
      <ol class="steps">${steps.map((s, i) => `<li class="${i <= k ? 'on' : ''}">${s[1]}</li>`).join('')}</ol>`;
  }
  store.sub(renderTrack);

  function call(type) {
    store.update(d => d.calls.push({ table, type, ts: Date.now() }));
    toast(type === 'bill' ? 'Bill requested. Someone is on the way.' : 'A server has been called to Table ' + table);
  }
  $('#callWaiter').onclick = () => call('waiter');
  $('#callBill').onclick = () => call('bill');

  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

  /* sticky chip highlight */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) $$('.chip').forEach(c => c.classList.toggle('on', c.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  const watch = () => $$('.sec[id]').forEach(s => io.observe(s));
  const r0 = render; render = function () { r0(); watch(); };

  render(); renderTrack();
})();
