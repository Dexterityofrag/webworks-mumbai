/* Guest QR menu, Bengaluru style table flow:
   first scan at a table starts a session with a 4 digit code, the rest of the table scans the same QR
   and joins with that code, everyone adds to one live table cart, any member sends a round to the kitchen,
   and the table bill (all rounds) is paid in full, split equally, or "my items only". */
(function () {
  const { C, $, $$, inr, esc, store, qrSvg, vegDot, items } = WW;
  const qs = new URLSearchParams(location.search);
  let table = qs.get('t') || '4';
  const st = { q: '', veg: false, sort: 'rec' };
  const gst = C.gst ?? 5;
  const byId = id => items.find(x => x.id === id);

  /* ---------- who am I (per tab = per phone) ---------- */
  const MK = 'ww-me:' + C.slug;
  let me = null;
  try { me = JSON.parse(sessionStorage.getItem(MK)); } catch (e) {}
  const saveMe = m => { me = m; try { sessionStorage.setItem(MK, JSON.stringify(m)); } catch (e) {} };

  const S = () => (store.read().sessions || {})[table];
  const member = () => { const s = S(); return !!(s && me && me.table === table && me.code === s.code); };
  const newCode = () => String(1000 + Math.floor(Math.random() * 9000));
  const tableOrders = (d, s) => d.orders.filter(o => o.table === table && o.code === s.code);
  const bill = (d = store.read(), s = (d.sessions || {})[table]) => {
    if (!s) return { total: 0, paid: 0, due: 0, rounds: 0 };
    const os = tableOrders(d, s), total = os.reduce((a, o) => a + o.total, 0), paid = (s.payments || []).reduce((a, p) => a + p.amt, 0);
    return { total, paid, due: Math.max(0, total - paid), rounds: os.length, os };
  };

  /* ---------- table selector (demo ribbon) ---------- */
  const sel = $('#tableSel');
  for (let i = 1; i <= C.tables; i++) sel.add(new Option('Table ' + i, i, false, String(i) === table));
  sel.onchange = () => { table = sel.value; history.replaceState(null, '', '?t=' + table); refresh(); };

  const sortSel = $('#sort');
  if (C.features?.protein) sortSel.add(new Option('Protein: high to low', 'pro'));
  sortSel.onchange = () => { st.sort = sortSel.value; render(); };
  $('#q').oninput = e => { st.q = e.target.value.trim().toLowerCase(); render(); };
  $('#veg').onchange = e => { st.veg = e.target.checked; render(); };
  const chips = $('#chips');
  chips.innerHTML = C.sections.map((s, i) => `<a href="#s${i}" class="chip">${esc(s.name)}</a>`).join('');

  /* ---------- menu ---------- */
  const sorters = {
    rec: (a, b) => (b.tag ? 1 : 0) - (a.tag ? 1 : 0) || a.order - b.order,
    lo: (a, b) => a.p - b.p, hi: (a, b) => b.p - a.p, az: (a, b) => a.n.localeCompare(b.n), pro: (a, b) => b.pro - a.pro,
  };
  const cartOf = () => (member() && S().cart) || {};
  function itemHTML(it) {
    const line = cartOf()[it.id], q = line ? line.q : 0;
    return `<article class="item${q ? ' in' : ''}" data-id="${it.id}">
      <div class="it-main">
        <h4>${vegDot(it.veg)}<span>${esc(it.n)}</span>${it.tag ? `<em class="tag">${esc(it.tag)}</em>` : ''}</h4>
        ${it.d ? `<p>${esc(it.d)}</p>` : ''}
        ${it.pro ? `<small class="pro">${it.pro} g protein</small>` : ''}
        ${q ? `<small class="by">Added by ${esc(line.by.join(', '))}</small>` : ''}
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
    $('#menu').innerHTML = flat
      ? `<section class="sec"><header class="sec-h"><h3>${st.q ? 'Results for “' + esc(st.q) + '”' : esc(sortSel.selectedOptions[0].text)}</h3><span>${list.length} items</span></header>${list.map(itemHTML).join('') || '<p class="empty">Nothing matches. Try another word.</p>'}</section>`
      : C.sections.map((s, i) => {
          const its = list.filter(x => x.sec === i);
          return its.length ? `<section class="sec" id="s${i}"><header class="sec-h"><h3>${esc(s.name)}</h3>${s.note ? `<span>${esc(s.note)}</span>` : ''}</header>${its.map(itemHTML).join('')}</section>` : '';
        }).join('');
    chips.style.display = flat ? 'none' : '';
    $$('.sec[id]').forEach(s => io.observe(s));
    renderBar();
  }
  $('#menu').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    if (!member()) return gate(true);
    const id = b.closest('.item').dataset.id, d = b.dataset.a === '+' ? 1 : -1;
    store.update(x => {
      const c = x.sessions[table].cart;
      const l = c[id] || (c[id] = { q: 0, by: [] });
      l.q += d;
      if (d > 0 && !l.by.includes(me.name)) l.by.push(me.name);
      if (l.q <= 0) delete c[id];
    });
    bump();
  });

  /* ---------- table cart bar ---------- */
  const lines = () => Object.entries(cartOf()).map(([id, l]) => ({ ...byId(id), q: l.q, by: l.by }));
  const totals = ls => { const sub = ls.reduce((s, l) => s + l.p * l.q, 0), tax = Math.round(sub * gst / 100); return { sub, tax, total: sub + tax }; };
  function renderBar() {
    const ls = lines(), n = ls.reduce((a, l) => a + l.q, 0), bar = $('#bar');
    bar.classList.toggle('show', n > 0);
    $('#barN').textContent = n + (n === 1 ? ' item' : ' items');
    const who = [...new Set(ls.flatMap(l => l.by))].map(x => x === me?.name ? 'you' : x);
    $('#barBy').textContent = 'Added by ' + who.join(', ');
    $('#barT').textContent = inr(totals(ls).sub);
  }
  function bump() { const b = $('#bar'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }

  /* ---------- sheet ---------- */
  const sheet = $('#sheet');
  const openSheet = html => { $('#sheetBody').innerHTML = html; sheet.classList.add('open'); document.body.classList.add('lock'); };
  const closeSheet = () => { sheet.classList.remove('open'); document.body.classList.remove('lock'); };
  sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });

  /* ---------- start / join ---------- */
  const nameField = ph => `<label class="fld"><span>Your name</span><input id="nm" maxlength="16" placeholder="${ph}" autocomplete="given-name"></label>`;
  function gate(fromAdd) {
    const s = S();
    if (!s) {
      openSheet(`<header class="sh-h"><h3>Start Table ${esc(table)}</h3><button data-close aria-label="Close">✕</button></header>
        <p class="muted">${fromAdd ? 'Before you add anything: ' : ''}you're the first one here. Start the table and you'll get a 4 digit code to share, so everyone at your table orders into one cart and one bill.</p>
        ${nameField('e.g. Riya')}
        <button class="btn pri" id="startT">Start table &amp; get code</button>`);
      $('#startT').onclick = () => {
        const name = ($('#nm').value.trim() || 'Guest 1'), code = newCode();
        saveMe({ table, code, name });
        store.update(d => { d.sessions = d.sessions || {}; d.sessions[table] = { code, ts: Date.now(), people: [name], cart: {}, payments: [] }; });
        codeView(true);
      };
    } else {
      openSheet(`<header class="sh-h"><h3>Join Table ${esc(table)}</h3><button data-close aria-label="Close">✕</button></header>
        <p class="muted">Someone at your table has already started. Ask them for the 4 digit table code.</p>
        <div class="otp" id="otp">${'<input inputmode="numeric" maxlength="1" aria-label="digit">'.repeat(4)}</div>
        <p class="err" id="err" hidden>That code doesn't match Table ${esc(table)}. Check with your table, or call a server.</p>
        ${nameField('e.g. Aman')}
        <button class="btn pri" id="joinT">Join the table</button>
        ${C.demo ? `<p class="fine">Preview tip: the code is shown in the tab where the table was started, and on the kitchen screen.</p>` : ''}`);
      const ins = $$('#otp input');
      ins.forEach((el, i) => {
        el.oninput = () => { el.value = el.value.replace(/\D/g, ''); if (el.value && ins[i + 1]) ins[i + 1].focus(); };
        el.onkeydown = e => { if (e.key === 'Backspace' && !el.value && ins[i - 1]) ins[i - 1].focus(); };
        el.onpaste = e => { const v = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4); if (v.length === 4) { e.preventDefault(); ins.forEach((x, k) => x.value = v[k]); } };
      });
      ins[0].focus();
      $('#joinT').onclick = () => {
        const code = ins.map(x => x.value).join(''), s2 = S();
        if (!s2 || code !== s2.code) { $('#err').hidden = false; $('#otp').classList.remove('shake'); void $('#otp').offsetWidth; $('#otp').classList.add('shake'); return; }
        let name = $('#nm').value.trim() || 'Guest ' + (s2.people.length + 1);
        if (s2.people.includes(name)) name += ' ' + (s2.people.length + 1);
        saveMe({ table, code, name });
        store.update(d => d.sessions[table].people.push(name));
        closeSheet(); toast(`You joined Table ${table}. Add away!`);
      };
    }
  }
  function codeView(fresh) {
    const s = S(), link = location.href.split('?')[0] + '?t=' + table;
    const msg = `Join our table at ${C.name}: scan the QR on Table ${table} (or open ${link}) and enter code ${s.code}`;
    openSheet(`<header class="sh-h"><h3>${fresh ? 'Table started' : 'Your table code'}</h3><button data-close aria-label="Close">✕</button></header>
      <p class="muted">Share this with everyone at Table ${esc(table)}. They scan the same QR and enter the code to add to your table's cart.</p>
      <div class="bigcode">${s.code.split('').map(c => `<span>${c}</span>`).join('')}</div>
      <div class="pay"><a class="btn pri" target="_blank" href="https://wa.me/?text=${encodeURIComponent(msg)}">Share on WhatsApp</a>
      <button class="btn ghost" id="copyC">Copy code</button></div>
      <button class="btn ghost" data-close style="margin-top:8px;border:0">Start ordering</button>`);
    $('#copyC').onclick = () => { navigator.clipboard?.writeText(s.code); toast('Code copied'); };
  }

  /* ---------- cart → kitchen ---------- */
  function cartView() {
    const ls = lines(), t = totals(ls), b = bill();
    openSheet(`<header class="sh-h"><h3>Table ${esc(table)} cart</h3><button data-close aria-label="Close">✕</button></header>
      <p class="muted">Everyone at your table sees this cart live. Anyone can send it to the kitchen.</p>
      <ul class="lines">${ls.map(l => `<li>${vegDot(l.veg)}<span>${esc(l.n)}<small class="by">${esc(l.by.join(', '))}</small></span><div class="step sm" data-id="${l.id}"><button data-c="-">−</button><span>${l.q}</span><button data-c="+">+</button></div><b>${inr(l.p * l.q)}</b></li>`).join('')}</ul>
      <textarea id="note" rows="2" placeholder="Anything for the kitchen? Less spicy, no onion, extra hot…"></textarea>
      <dl class="tot"><dt>This round</dt><dd>${inr(t.sub)}</dd><dt>GST ${gst}%</dt><dd>${inr(t.tax)}</dd><dt class="g">Round total</dt><dd class="g">${inr(t.total)}</dd></dl>
      <div class="pay"><button class="btn pri" id="send">Send round ${b.rounds + 1} to the kitchen</button></div>
      <p class="fine">${b.rounds ? `Table bill so far: ${inr(b.total)} across ${b.rounds} round${b.rounds > 1 ? 's' : ''}. ` : ''}Pay once at the end, together or split.</p>`);
    $('#sheetBody .lines').onclick = e => {
      const btn = e.target.closest('button[data-c]'); if (!btn) return;
      const id = btn.parentElement.dataset.id, d = btn.dataset.c === '+' ? 1 : -1;
      store.update(x => { const c = x.sessions[table].cart, l = c[id]; l.q += d; if (d > 0 && !l.by.includes(me.name)) l.by.push(me.name); if (l.q <= 0) delete c[id]; });
      lines().length ? cartView() : closeSheet();
    };
    $('#send').onclick = () => {
      const note = $('#note').value;
      store.update(d => {
        const s = d.sessions[table], ls2 = Object.entries(s.cart).map(([id, l]) => ({ ...byId(id), q: l.q, by: l.by })), tt = totals(ls2);
        d.seq += 1;
        d.orders.push({ id: Date.now().toString(36), no: d.seq, table, code: s.code, round: tableOrders(d, s).length + 1,
          items: ls2.map(l => ({ n: l.n, q: l.q, p: l.p, veg: l.veg, by: l.by })), by: [...new Set(ls2.flatMap(l => l.by))], note, ...tt, status: 'new', ts: Date.now() });
        s.cart = {};
      });
      closeSheet(); toast('Round sent to the kitchen');
    };
  }
  $('#bar').onclick = () => (member() ? cartView() : gate(true));

  /* ---------- pay the table bill ---------- */
  function payView() {
    const d = store.read(), s = d.sessions[table], b = bill(d, s), n = s.people.length;
    const mine = Math.round(b.os.reduce((a, o) => a + o.items.reduce((x, i) => x + (i.by?.includes(me.name) ? i.p * i.q / i.by.length : 0), 0) * (1 + gst / 100), 0));
    const opts = [['full', 'Whole table', b.due], ['split', `Split equally (${n} ${n > 1 ? 'people' : 'person'})`, Math.ceil(b.due / n)], ['mine', 'Only what I added', Math.min(mine, b.due)]];
    openSheet(`<header class="sh-h"><h3>Table ${esc(table)} bill</h3><button data-close aria-label="Close">✕</button></header>
      <dl class="tot"><dt>${b.rounds} round${b.rounds > 1 ? 's' : ''}, incl. GST</dt><dd>${inr(b.total)}</dd><dt>Already paid</dt><dd>${inr(b.paid)}</dd><dt class="g">Still due</dt><dd class="g">${inr(b.due)}</dd></dl>
      <div class="opts">${opts.map(([k, l, a], i) => `<label class="opt"><input type="radio" name="po" value="${a}" ${i ? '' : 'checked'}><span>${l}</span><b>${inr(a)}</b></label>`).join('')}</div>
      <div class="pay"><button class="btn pri" id="goUpi">Pay with UPI</button><button class="btn ghost" id="atCounter">Pay by cash or card instead</button></div>`);
    $('#goUpi').onclick = () => upiView(+$('input[name=po]:checked').value);
    $('#atCounter').onclick = () => { closeSheet(); call('bill'); };
  }
  function upiView(amount) {
    const link = 'upi://pay?' + new URLSearchParams({ pa: C.upi, pn: C.name, am: amount.toFixed(2), cu: 'INR', tn: `Table ${table} ${me.name}` });
    openSheet(`<header class="sh-h"><h3>Pay ${inr(amount)}</h3><button data-close aria-label="Close">✕</button></header>
      <p class="muted">On a phone this opens GPay, PhonePe, Paytm or any UPI app with the amount and table already filled in.</p>
      <div class="apps"><span>GPay</span><span>PhonePe</span><span>Paytm</span><span>BHIM</span></div>
      <div class="upiqr">${qrSvg(link, 5)}<small>Or scan from another phone</small></div>
      ${C.demo ? `<div class="demo-note">Preview mode: the UPI ID is a placeholder, so no real payment happens.</div><button class="btn pri" id="paid">Simulate successful payment</button>`
               : `<a class="btn pri" href="${link}">Open UPI app</a><button class="btn ghost" id="paid">I have paid</button>`}`);
    $('#paid').onclick = () => {
      store.update(d => d.sessions[table].payments.push({ by: me.name, amt: amount, ts: Date.now() }));
      closeSheet(); toast(`Paid ${inr(amount)}. Thank you, ${me.name}!`);
    };
  }

  /* ---------- table panel in the hero ---------- */
  const steps = [['new', 'Received'], ['prep', 'Preparing'], ['ready', 'On its way'], ['served', 'Served']];
  function renderTable() {
    const d = store.read(), s = (d.sessions || {})[table], gateEl = $('#gate'), tr = $('#track');
    $('#tableNo').textContent = table;
    if (!member()) {
      $('#codePill').innerHTML = '';
      tr.hidden = true;
      gateEl.innerHTML = s
        ? `<div class="gate"><b>Table ${esc(table)} is already ordering</b><span>${s.people.length} ${s.people.length > 1 ? 'people have' : 'person has'} joined. Enter their 4 digit code to add to the same cart.</span><button class="btn pri" id="gateBtn">Join with code</button></div>`
        : `<div class="gate"><b>First one at Table ${esc(table)}?</b><span>Start the table to get a 4 digit code for your friends. One cart, one bill, split however you like.</span><button class="btn pri" id="gateBtn">Start table</button></div>`;
      $('#gateBtn').onclick = () => gate(false);
      return;
    }
    gateEl.innerHTML = '';
    $('#codePill').innerHTML = ` · code <button id="showCode">${s.code}</button>`;
    $('#showCode').onclick = () => codeView(false);
    const b = bill(d, s), last = b.os[b.os.length - 1];
    const k = last ? steps.findIndex(x => x[0] === last.status) : -1;
    tr.hidden = false;
    tr.innerHTML = `<div class="tr-h"><b>${s.people.map(p => `<i class="pp">${esc(p === me.name ? p + ' (you)' : p)}</i>`).join('')}</b></div>
      ${last ? `<div class="tr-h" style="margin-top:12px"><span>Round ${last.round} · #${last.no}</span><span class="${b.due ? 'due' : 'ok'}">${b.due ? inr(b.due) + ' due' : 'Bill settled'}</span></div>
        <ol class="steps">${steps.map((x, i) => `<li class="${i <= k ? 'on' : ''}">${x[1]}</li>`).join('')}</ol>
        ${b.due ? `<button class="btn pri sm" id="payBill">Pay the table bill</button>` : ''}`
      : `<p class="fine" style="text-align:left">Nothing sent to the kitchen yet. Add dishes; everyone's picks land in one table cart.</p>`}`;
    $('#payBill') && ($('#payBill').onclick = payView);
  }

  function call(type) {
    store.update(d => d.calls.push({ table, type, ts: Date.now() }));
    toast(type === 'bill' ? 'Bill requested. Someone is on the way.' : 'A server has been called to Table ' + table);
  }
  $('#callWaiter').onclick = () => call('waiter');
  $('#callBill').onclick = () => call('bill');

  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) $$('.chip').forEach(c => c.classList.toggle('on', c.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });

  /* live sync: re-render when the table's session changes (other phones adding, kitchen updating status) */
  let sig = '';
  function refresh() {
    const d = store.read(), s = (d.sessions || {})[table];
    if (me && me.table === table && !s) { saveMe(null); toast('This table was closed by the staff'); }
    const n = JSON.stringify([table, member(), s && s.cart]);
    if (n !== sig) { sig = n; render(); }
    renderTable();
  }
  store.sub(refresh);
  refresh();
})();
