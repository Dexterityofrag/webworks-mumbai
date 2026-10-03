/* Guest QR menu with a locked table session.
   Rules (all enforced here; the live version mirrors them in the backend):
   - The QR carries ?t=<table>&k=<token>. No valid token, no ordering (stops "edit the URL to table 5").
   - First scanner starts the table and is the host. Only the host ever sees the 4 digit code.
   - Anyone else scanning an active table must enter the code. 5 wrong codes in 10 min locks joining
     for that table and alerts staff (stops guessing 0000 to 9999).
   - Start is atomic: if a session appeared meanwhile, the second person is sent to "join" instead.
   - Host can remove a member and change the code; staff can close or re-code a table.
   - A table frees itself for the next group when the bill is settled and idle 20 min, or idle 3 h. */
(function () {
  const { C, $, $$, inr, esc, store, qrSvg, vegDot, items, tok, tableUrl } = WW;
  const qs = new URLSearchParams(location.search);
  let table = qs.get('t') || '';
  let key = qs.get('k') || '';
  const st = { q: '', veg: false, sort: 'rec' };
  const gst = C.gst ?? 5;
  const byId = id => items.find(x => x.id === id);
  const MAX_FAILS = 5, FAIL_WINDOW = 10 * 60000, IDLE = 3 * 3600000, SETTLED_IDLE = 20 * 60000;
  const rid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- who am I (per tab = per phone) ---------- */
  const MK = 'ww-me:' + C.slug;
  let me = null;
  try { me = JSON.parse(sessionStorage.getItem(MK)); } catch (e) {}
  const saveMe = m => { me = m; try { m ? sessionStorage.setItem(MK, JSON.stringify(m)) : sessionStorage.removeItem(MK); } catch (e) {} };

  const validTable = () => table && +table >= 1 && +table <= C.tables && key === tok(table);
  const tableOrders = (d, t, s) => d.orders.filter(o => o.table === t && o.sid === s.sid);
  const bill = (d, t, s) => {
    if (!s) return { total: 0, paid: 0, due: 0, rounds: 0, os: [] };
    const os = tableOrders(d, t, s), total = os.reduce((a, o) => a + o.total, 0), paid = (s.payments || []).reduce((a, p) => a + p.amt, 0);
    return { total, paid, due: Math.max(0, total - paid), rounds: os.length, os };
  };
  /* a session that no longer blocks a new group */
  const stale = (d, t, s) => {
    const idle = Date.now() - (s.last || s.ts), b = bill(d, t, s), cartEmpty = !Object.keys(s.cart || {}).length;
    return idle > IDLE || (b.rounds > 0 && b.due === 0 && cartEmpty && idle > SETTLED_IDLE);
  };
  const live = (d = store.read()) => { const s = (d.sessions || {})[table]; return s && !stale(d, table, s) ? s : null; };
  const isMember = (s = (store.read().sessions || {})[table]) => !!(s && me && me.table === table && me.sid === s.sid && s.people.some(p => p.id === me.id));
  const isHost = s => isMember(s) && s.hostId === me.id;
  const touch = s => { s.last = Date.now(); };
  const newCode = old => { let c; do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (c === old); return c; };
  const recentFails = s => (s.fails || []).filter(ts => Date.now() - ts < FAIL_WINDOW);

  /* ---------- table selector (demo ribbon only; real guests never see it) ---------- */
  const sel = $('#tableSel');
  sel.add(new Option('Pick table', ''));
  for (let i = 1; i <= C.tables; i++) sel.add(new Option('Table ' + i, i, false, String(i) === table));
  sel.onchange = () => { if (!sel.value) return; table = sel.value; key = tok(table); history.replaceState(null, '', tableUrl('', table)); sig = ''; refresh(); };

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
  const cartOf = () => { const s = (store.read().sessions || {})[table]; return (isMember(s) && s.cart) || {}; };
  function itemHTML(it, cart) {
    const line = cart[it.id], q = line ? line.q : 0;
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
    const cart = cartOf();
    let list = items.filter(it => (!st.veg || it.veg) && (!st.q || (it.n + ' ' + it.d).toLowerCase().includes(st.q)));
    const flat = st.sort !== 'rec' || st.q;
    list = list.slice().sort(sorters[st.sort]);
    $('#menu').innerHTML = flat
      ? `<section class="sec"><header class="sec-h"><h3>${st.q ? 'Results for “' + esc(st.q) + '”' : esc(sortSel.selectedOptions[0].text)}</h3><span>${list.length} items</span></header>${list.map(it => itemHTML(it, cart)).join('') || '<p class="empty">Nothing matches. Try another word.</p>'}</section>`
      : C.sections.map((s, i) => {
          const its = list.filter(x => x.sec === i);
          return its.length ? `<section class="sec" id="s${i}"><header class="sec-h"><h3>${esc(s.name)}</h3>${s.note ? `<span>${esc(s.note)}</span>` : ''}</header>${its.map(it => itemHTML(it, cart)).join('')}</section>` : '';
        }).join('');
    chips.style.display = flat ? 'none' : '';
    $$('.sec[id]').forEach(s => io.observe(s));
    renderBar();
  }
  /* every write to a session goes through here and re-checks membership inside the update */
  function mutate(fn) {
    let ok = false;
    store.update(d => { const s = (d.sessions || {})[table]; if (isMember(s)) { fn(s, d); touch(s); ok = true; } });
    if (!ok) { toast('You are no longer part of this table'); refresh(); }
    return ok;
  }
  $('#menu').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    if (!isMember()) return gate(true);
    const id = b.closest('.item').dataset.id, dq = b.dataset.a === '+' ? 1 : -1;
    mutate(s => {
      const l = s.cart[id] || (s.cart[id] = { q: 0, by: [] });
      l.q += dq;
      if (dq > 0 && !l.by.includes(me.name)) l.by.push(me.name);
      if (l.q <= 0) delete s.cart[id];
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
    $('#barBy').textContent = 'Added by ' + [...new Set(ls.flatMap(l => l.by))].map(x => x === me?.name ? 'you' : x).join(', ');
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
  const uniq = (s, name) => { let n = name, i = 2; while (s.people.some(p => p.name.toLowerCase() === n.toLowerCase())) n = name + ' ' + i++; return n; };

  function gate(fromAdd) {
    if (!validTable()) return;
    const s = live();
    if (!s) {
      openSheet(`<header class="sh-h"><h3>Start Table ${esc(table)}</h3><button data-close aria-label="Close">✕</button></header>
        <p class="muted">${fromAdd ? 'Before you add anything: ' : ''}you're the first one here. Start the table and you'll get a 4 digit code. Only you see it, so share it with the people at your table.</p>
        ${nameField('e.g. Riya')}
        <button class="btn pri" id="startT">Start table &amp; get code</button>`);
      $('#startT').onclick = () => {
        const name = $('#nm').value.trim() || 'Guest 1', id = rid(), sid = rid();
        let won = false;
        store.update(d => {
          d.sessions = d.sessions || {};
          const cur = d.sessions[table];
          if (cur && !stale(d, table, cur)) return;           // someone started it a moment ago
          d.sessions[table] = { sid, code: newCode(), ts: Date.now(), last: Date.now(), hostId: id, people: [{ id, name }], cart: {}, payments: [], fails: [] };
          won = true;
        });
        if (!won) { toast('Someone at this table just started it. Ask them for the code.'); return gate(fromAdd); }
        saveMe({ table, sid, id, name }); refresh(); codeView(true);
      };
      return;
    }
    const locked = recentFails(s).length >= MAX_FAILS;
    const host = s.people.find(p => p.id === s.hostId);
    openSheet(`<header class="sh-h"><h3>Join Table ${esc(table)}</h3><button data-close aria-label="Close">✕</button></header>
      ${locked
        ? `<div class="lockbox"><b>Joining is paused for this table</b><span>Too many wrong codes were tried. A server has been alerted and will help you.</span></div>
           <button class="btn ghost" id="needHelp">Call a server</button>`
        : `<p class="muted">This table is already ordering${host ? ` (started by ${esc(host.name)})` : ''}. Ask them for the 4 digit code.</p>
           <div class="otp" id="otp">${'<input inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="digit">'.repeat(4)}</div>
           <p class="err" id="err" hidden></p>
           ${nameField('e.g. Aman')}
           <button class="btn pri" id="joinT">Join the table</button>
           <p class="fine">Not with this group? You may be at the wrong table. <button class="lnk" id="needHelp">Call a server</button></p>
           ${C.demo ? `<p class="fine">Preview tip: the code is only shown to whoever started the table, and to staff on the kitchen screen.</p>` : ''}`}`);
    $('#needHelp').onclick = () => { closeSheet(); call('waiter'); };
    if (locked) return;
    const ins = $$('#otp input');
    ins.forEach((el, i) => {
      el.oninput = () => { el.value = el.value.replace(/\D/g, '').slice(-1); if (el.value && ins[i + 1]) ins[i + 1].focus(); };
      el.onkeydown = e => { if (e.key === 'Backspace' && !el.value && ins[i - 1]) ins[i - 1].focus(); if (e.key === 'Enter') $('#joinT').click(); };
      el.onpaste = e => { const v = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4); if (v.length === 4) { e.preventDefault(); ins.forEach((x, k) => x.value = v[k]); } };
    });
    ins[0].focus();
    $('#joinT').onclick = () => {
      const code = ins.map(x => x.value).join('');
      if (code.length < 4) return showErr('Enter all 4 digits.');
      const id = rid(); let res = 'gone', name = '', sid = '';
      store.update(d => {
        const cur = (d.sessions || {})[table];
        if (!cur || stale(d, table, cur)) return;
        cur.fails = recentFails(cur);
        if (cur.fails.length >= MAX_FAILS) { res = 'locked'; return; }
        if (code !== cur.code) {
          cur.fails.push(Date.now()); res = 'wrong';
          if (cur.fails.length >= MAX_FAILS) { res = 'locked'; d.calls.push({ table, type: 'security', ts: Date.now() }); }
          return;
        }
        name = uniq(cur, $('#nm').value.trim() || 'Guest ' + (cur.people.length + 1)); sid = cur.sid;
        cur.people.push({ id, name }); touch(cur); res = 'ok';
      });
      if (res === 'ok') { saveMe({ table, sid, id, name }); closeSheet(); refresh(); toast(`You joined Table ${table}. Add away!`); return; }
      if (res === 'gone') { toast('That table just closed. You can start it now.'); return gate(fromAdd); }
      if (res === 'locked') return gate(fromAdd);
      const left = MAX_FAILS - recentFails(live() || { fails: [] }).length;
      ins.forEach(x => x.value = ''); ins[0].focus();
      showErr(`That code doesn't match Table ${table}. ${left} ${left === 1 ? 'try' : 'tries'} left before joining is paused.`);
    };
    function showErr(m) { const e = $('#err'); e.textContent = m; e.hidden = false; const o = $('#otp'); o.classList.remove('shake'); void o.offsetWidth; o.classList.add('shake'); }
  }

  function codeView(fresh) {
    const s = (store.read().sessions || {})[table];
    if (!isHost(s)) return;
    const msg = `Join our table at ${C.name}: scan the QR on Table ${table} and enter code ${s.code}`;
    openSheet(`<header class="sh-h"><h3>${fresh ? 'Table started' : 'Your table code'}</h3><button data-close aria-label="Close">✕</button></header>
      <p class="muted">Only you can see this. Share it with the people at Table ${esc(table)}: they scan the same QR and enter it to join your cart and bill.</p>
      <div class="bigcode">${s.code.split('').map(c => `<span>${c}</span>`).join('')}</div>
      <div class="pay"><a class="btn pri" target="_blank" href="https://wa.me/?text=${encodeURIComponent(msg)}">Share on WhatsApp</a>
      <button class="btn ghost" id="copyC">Copy code</button></div>
      <p class="fine">Code got out to someone who isn't with you? <button class="lnk" id="recode">Change the code</button>. People already at your table stay in.</p>
      <button class="btn ghost" data-close style="margin-top:8px;border:0">Start ordering</button>`);
    $('#copyC').onclick = () => { navigator.clipboard?.writeText(s.code); toast('Code copied'); };
    $('#recode').onclick = () => { mutate(x => { x.code = newCode(x.code); x.fails = []; }); codeView(false); toast('New code made. The old one no longer works.'); };
  }

  /* ---------- cart → kitchen ---------- */
  function cartView() {
    const ls = lines(), t = totals(ls), d = store.read(), b = bill(d, table, d.sessions[table]);
    openSheet(`<header class="sh-h"><h3>Table ${esc(table)} cart</h3><button data-close aria-label="Close">✕</button></header>
      <p class="muted">Everyone at your table sees this cart live. Anyone can send it to the kitchen.</p>
      <ul class="lines">${ls.map(l => `<li>${vegDot(l.veg)}<span>${esc(l.n)}<small class="by">${esc(l.by.join(', '))}</small></span><div class="step sm" data-id="${l.id}"><button data-c="-">−</button><span>${l.q}</span><button data-c="+">+</button></div><b>${inr(l.p * l.q)}</b></li>`).join('')}</ul>
      <textarea id="note" rows="2" placeholder="Anything for the kitchen? Less spicy, no onion, extra hot…"></textarea>
      <dl class="tot"><dt>This round</dt><dd>${inr(t.sub)}</dd><dt>GST ${gst}%</dt><dd>${inr(t.tax)}</dd><dt class="g">Round total</dt><dd class="g">${inr(t.total)}</dd></dl>
      <div class="pay"><button class="btn pri" id="send">Send round ${b.rounds + 1} to the kitchen</button></div>
      <p class="fine">${b.rounds ? `Table bill so far: ${inr(b.total)} across ${b.rounds} round${b.rounds > 1 ? 's' : ''}. ` : ''}Pay once at the end, together or split.</p>`);
    $('#sheetBody .lines').onclick = e => {
      const btn = e.target.closest('button[data-c]'); if (!btn) return;
      const id = btn.parentElement.dataset.id, dq = btn.dataset.c === '+' ? 1 : -1;
      mutate(s => { const l = s.cart[id]; if (!l) return; l.q += dq; if (dq > 0 && !l.by.includes(me.name)) l.by.push(me.name); if (l.q <= 0) delete s.cart[id]; });
      lines().length ? cartView() : closeSheet();
    };
    $('#send').onclick = () => {
      const note = $('#note').value;
      let sent = false;
      mutate((s, d) => {
        const ls2 = Object.entries(s.cart).map(([id, l]) => ({ ...byId(id), q: l.q, by: l.by }));
        if (!ls2.length) return;                              // a tablemate already sent it
        const tt = totals(ls2);
        d.seq += 1;
        d.orders.push({ id: Date.now().toString(36) + rid(), no: d.seq, table, sid: s.sid, round: tableOrders(d, table, s).length + 1,
          items: ls2.map(l => ({ n: l.n, q: l.q, p: l.p, veg: l.veg, by: l.by })), by: [...new Set(ls2.flatMap(l => l.by))], sentBy: me.name, note, ...tt, status: 'new', ts: Date.now() });
        s.cart = {}; sent = true;
      });
      closeSheet(); toast(sent ? 'Round sent to the kitchen' : 'Your tablemate already sent this round');
    };
  }
  $('#bar').onclick = () => (isMember() ? cartView() : gate(true));

  /* ---------- pay the table bill ---------- */
  function payView() {
    const d = store.read(), s = d.sessions[table], b = bill(d, table, s), n = s.people.length;
    const mine = Math.round(b.os.reduce((a, o) => a + o.items.reduce((x, i) => x + (i.by?.includes(me.name) ? i.p * i.q / i.by.length : 0), 0) * (1 + gst / 100), 0));
    const opts = [['Whole table', b.due], [`Split equally (${n} ${n > 1 ? 'people' : 'person'})`, Math.ceil(b.due / n)], ['Only what I added', Math.min(mine, b.due)]].filter(o => o[1] > 0);
    openSheet(`<header class="sh-h"><h3>Table ${esc(table)} bill</h3><button data-close aria-label="Close">✕</button></header>
      <dl class="tot"><dt>${b.rounds} round${b.rounds > 1 ? 's' : ''}, incl. GST</dt><dd>${inr(b.total)}</dd><dt>Already paid</dt><dd>${inr(b.paid)}</dd><dt class="g">Still due</dt><dd class="g">${inr(b.due)}</dd></dl>
      <div class="opts">${opts.map(([l, a], i) => `<label class="opt"><input type="radio" name="po" value="${a}" ${i ? '' : 'checked'}><span>${l}</span><b>${inr(a)}</b></label>`).join('')}</div>
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
      mutate((s, d) => { const due = bill(d, table, s).due; s.payments.push({ by: me.name, amt: Math.min(amount, due), ts: Date.now() }); });
      closeSheet(); toast(`Paid ${inr(amount)}. Thank you, ${me.name}!`);
    };
  }

  /* ---------- table panel in the hero ---------- */
  const steps = [['new', 'Received'], ['prep', 'Preparing'], ['ready', 'On its way'], ['served', 'Served']];
  function renderTable() {
    const d = store.read(), gateEl = $('#gate'), tr = $('#track');
    $('#tableNo').textContent = table || '?';
    $('#codePill').innerHTML = '';
    if (!validTable()) {
      tr.hidden = true;
      gateEl.innerHTML = `<div class="gate"><b>Scan the QR on your table to order</b><span>This link isn't tied to a table, so you can browse the menu but not order. Every table has its own QR code.</span></div>`;
      return;
    }
    const s = (d.sessions || {})[table];
    if (!isMember(s)) {
      tr.hidden = true;
      const ls = live(d);
      gateEl.innerHTML = ls
        ? `<div class="gate"><b>Table ${esc(table)} is already ordering</b><span>Sitting with them? Enter the 4 digit code the person who started the table has.</span><button class="btn pri" id="gateBtn">Join with code</button></div>`
        : `<div class="gate"><b>First one at Table ${esc(table)}?</b><span>Start the table to get a 4 digit code for your friends. One cart, one bill, split however you like.</span><button class="btn pri" id="gateBtn">Start table</button></div>`;
      $('#gateBtn').onclick = () => gate(false);
      return;
    }
    gateEl.innerHTML = '';
    const host = isHost(s);
    $('#codePill').innerHTML = host ? ` · code <button id="showCode">${s.code}</button>` : ' · joined';
    host && ($('#showCode').onclick = () => codeView(false));
    const b = bill(d, table, s), last = b.os[b.os.length - 1];
    const k = last ? steps.findIndex(x => x[0] === last.status) : -1;
    tr.hidden = false;
    tr.innerHTML = `<div class="tr-h"><b>${s.people.map(p => `<i class="pp">${esc(p.name)}${p.id === me.id ? ' (you)' : ''}${p.id === s.hostId ? ' ★' : ''}${host && p.id !== me.id ? `<button class="rm" data-rm="${p.id}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}</i>`).join('')}</b></div>
      ${last ? `<div class="tr-h" style="margin-top:12px"><span>Round ${last.round} · #${last.no}</span><span class="${b.due ? 'due' : 'ok'}">${b.due ? inr(b.due) + ' due' : 'Bill settled'}</span></div>
        <ol class="steps">${steps.map((x, i) => `<li class="${i <= k ? 'on' : ''}">${x[1]}</li>`).join('')}</ol>
        ${b.due ? `<button class="btn pri sm" id="payBill">Pay the table bill</button>` : ''}`
      : `<p class="fine" style="text-align:left">Nothing sent to the kitchen yet. Everyone's picks land in one table cart.</p>`}`;
    $('#payBill') && ($('#payBill').onclick = payView);
    $$('[data-rm]', tr).forEach(btn => btn.onclick = () => {
      const p = s.people.find(x => x.id === btn.dataset.rm);
      if (p && confirm(`Remove ${p.name} from Table ${table}? They won't be able to add to your cart.`)) { mutate(x => { x.people = x.people.filter(y => y.id !== p.id); x.code = newCode(x.code); }); toast(`${p.name} removed. Your code was changed too.`); }
    });
  }

  function call(type) {
    if (!validTable()) return toast('Scan the QR on your table first');
    store.update(d => d.calls.push({ table, type, ts: Date.now() }));
    toast(type === 'bill' ? 'Bill requested. Someone is on the way.' : 'A server has been called to Table ' + table);
  }
  $('#callWaiter').onclick = () => call('waiter');
  $('#callBill').onclick = () => call('bill');

  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2800); }

  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) $$('.chip').forEach(c => c.classList.toggle('on', c.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });

  /* live sync: re-render when this table's session changes (tablemates, kitchen, staff) */
  let sig = '', wasMember = false;
  function refresh() {
    const d = store.read(), s = (d.sessions || {})[table], m = isMember(s);
    if (wasMember && !m) { saveMe(null); toast(s ? 'You were removed from this table' : 'This table was closed by the staff'); }
    wasMember = m;
    const n = JSON.stringify([table, m, m && s.cart]);
    if (n !== sig) { sig = n; render(); }
    renderTable();
  }
  store.sub(refresh);
  refresh();
})();
