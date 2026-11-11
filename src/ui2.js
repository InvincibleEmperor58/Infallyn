/* =====================================================================
   INFALLYN — UI part 2: renderers • router • reminders • settings • boot
   ===================================================================== */
const UIState = { tab: 'shelf', view: 'today', shelfFilter: null };

/* ---------------- router ---------------- */
function go(hash) { try { if (location.hash === hash) routeTo(hash); else location.hash = hash; } catch (e) { routeTo(hash); } }
L.go = go;
function setTab(t) {
  UIState.tab = t;
  qsa('main > section').forEach(s => s.classList.add('hide'));
  const sec = qs('#view-' + t); if (sec) sec.classList.remove('hide');
  qsa('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  const names = { shelf: UIState.shelfFilter ? '/' + UIState.shelfFilter : ({ today: 'Today', inbox: 'Inbox', upcoming: 'Upcoming', anytime: 'Anytime' }[UIState.view] || 'Infallyn'), dose: 'Daily Dose', listen: 'Listening Room', you: 'You' };
  qs('#viewname').textContent = names[t] || 'Infallyn';
}
function routeTo(h) {
  const parts = (h || '#/shelf').replace(/^#\/?/, '').split('/');
  const [tab, sub, arg] = parts;
  if (tab === 'dose') { setTab('dose'); if (sub === 'start') L.startDose(); }
  else if (tab === 'listen') { setTab('listen'); if (arg && sub === 'play') { Player.load(arg, true); } else if (arg) Player.load(arg, false); }
  else if (tab === 'you') setTab('you');
  else if (tab === 'capture') L.openCapture(sub || 'task');
  else if (tab === 'item') { setTab('shelf'); L.openEditor(arg); }
  else { if (sub === 'view' && arg) UIState.view = arg; setTab('shelf'); }
  renderAll();
}
window.addEventListener('hashchange', e => { try { routeTo(location.hash); } catch (err) {} });

/* ---------------- render: shelf ---------------- */
function chip(label, view, count) { return `<button class="chip${UIState.view === view ? ' active' : ''}" onclick="Infallyn.setView('${view}')">${label}<span class="cnt">${count}</span></button>`; }
L.setView = v => { UIState.view = v; UIState.shelfFilter = null; renderShelf(); setTab('shelf'); renderHeader(); };
L.setShelf = s => { UIState.shelfFilter = s; renderShelf(); setTab('shelf'); renderHeader(); };
function endOfToday() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }
function itemsForView() {
  const now = Date.now(), eod = endOfToday();
  const byShelf = i => !UIState.shelfFilter || i.shelf === UIState.shelfFilter;
  let list;
  if (UIState.view === 'today') list = S.items.filter(i => i.type === 'task' && i.status === 'open' && i.due && i.due < eod && byShelf(i));
  else if (UIState.view === 'upcoming') list = S.items.filter(i => i.type === 'task' && i.status === 'open' && i.due && i.due >= eod && byShelf(i));
  else if (UIState.view === 'inbox') list = S.items.filter(i => i.status === 'open' && (i.shelf || 'inbox') === (UIState.shelfFilter || 'inbox'));
  else list = S.items.filter(i => (i.type === 'note' || i.type === 'doc') && byShelf(i));
  if (UIState.view === 'today') {
    const open = list.filter(i => i.status === 'open').sort((a, b) => (b.pinned - a.pinned) || ((a.due < now) === (b.due < now) ? 0 : (a.due < now ? -1 : 1)) || (a.due - b.due) || (b.priority - a.priority));
    const doneToday = S.items.filter(i => i.type === 'task' && i.status === 'done' && i.completedAt && dayKey(i.completedAt) === dayKey(now) && byShelf(i));
    return open.concat(doneToday);
  }
  return list.sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
}
function viewCounts() {
  const now = Date.now(), eod = endOfToday();
  return {
    today: S.items.filter(i => i.type === 'task' && i.status === 'open' && i.due && i.due < eod).length,
    inbox: S.items.filter(i => i.status === 'open' && (i.shelf || 'inbox') === 'inbox').length,
    upcoming: S.items.filter(i => i.type === 'task' && i.status === 'open' && i.due && i.due >= eod).length,
    anytime: S.items.filter(i => i.type !== 'task').length
  };
}
function itemRow(i) {
  const overdue = i.type === 'task' && i.status === 'open' && i.due && i.due < Date.now();
  const dueSoon = !overdue && i.due && i.due - Date.now() < 3 * HOUR;
  const meta = [];
  if (i.type === 'task') {
    if (i.due) meta.push(`<span class="metachip${overdue ? ' overdue' : dueSoon ? ' due-soon' : ''}">${overdue ? '⏰ ' : '◷ '}${esc(fmtRel(i.due))}</span>`);
    if (i.priority >= 3) meta.push('<span class="metachip overdue">urgent</span>');
    else if (i.priority === 2) meta.push('<span class="metachip due-soon">important</span>');
  } else {
    const words = mdToPlain(i.body).split(/\s+/).filter(Boolean).length;
    meta.push(`<span class="metachip">${i.source === 'ocr' ? '✍ scanned' : i.type === 'doc' ? '📄 document' : '¶ note'}${words ? ' · ' + words + ' words' : ''}</span>`);
    if (i.pages && i.pages.length) meta.push(`<span class="metachip">${i.pages.length} pg</span>`);
  }
  i.tags.forEach(t => meta.push(`<span class="metachip">#${esc(t)}</span>`));
  if (!UIState.shelfFilter && i.shelf && i.shelf !== 'inbox') meta.push(`<span class="metachip">/${esc(i.shelf)}</span>`);
  const done = i.status === 'done';
  if (i.type === 'task') {
    return `<div class="itemrow taskrow${done ? ' done' : ''}${overdue ? ' ov' : ''}" onclick="Infallyn.openEditor('${i.id}')">
      <button class="ckbox" aria-label="Complete" onclick="event.stopPropagation();Infallyn.toggleTask('${i.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></button>
      <div class="it-main"><div class="it-title">${esc(i.title)}</div><div class="it-meta">${meta.join('')}</div></div>
      ${i.pinned ? '<span class="it-pin"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 3l7 7-4 1-3 6-2-2-5 5-1-1 5-5-2-2 6-3z"/></svg></span>' : ''}
    </div>`;
  }
  return `<div class="itemrow" onclick="Infallyn.openEditor('${i.id}')">
    <span class="it-ico">${i.type === 'doc' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>'}</span>
    <div class="it-main"><div class="it-title">${esc(i.title || 'Untitled')}</div><div class="it-meta">${meta.join('')}</div></div>
    ${mdToPlain(i.body).trim() ? '<span class="it-audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/></svg></span>' : ''}
    ${i.pinned ? '<span class="it-pin"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 3l7 7-4 1-3 6-2-2-5 5-1-1 5-5-2-2 6-3z"/></svg></span>' : ''}
  </div>`;
}
function renderShelf() {
  const c = viewCounts();
  qs('#views-rail').innerHTML = chip('Today', 'today', c.today) + chip('Inbox', 'inbox', c.inbox) + chip('Upcoming', 'upcoming', c.upcoming) + chip('Anytime', 'anytime', c.anytime);
  const sh = shelves();
  qs('#shelves-rail').innerHTML = `<button class="chip shelfchip${!UIState.shelfFilter ? ' active' : ''}" onclick="Infallyn.setShelf(null)">All shelves</button>` +
    sh.filter(s => s !== 'inbox').map(s => `<button class="chip shelfchip${UIState.shelfFilter === s ? ' active' : ''}" onclick="Infallyn.setShelf('${esc(s)}')">${SHELF_ICONS[s] || '🗄'} ${esc(s)}</button>`).join('') +
    `<button class="chip" onclick="Infallyn.newShelf()">＋</button>`;
  const list = itemsForView();
  const emptyMsg = {
    today: ['🌙', 'Nothing due today', 'The shelf is clear. Add a task, or start tonight\'s Dose early.', 'task'],
    inbox: ['📥', 'The inbox is empty', 'Capture anything — a task, a thought, a page you scanned.', 'task'],
    upcoming: ['🗓', 'Nothing scheduled ahead', 'Tasks with future dates will line up here.', 'task'],
    anytime: ['📚', 'No notes or documents yet', 'Write a note or scan a handwritten page — then listen to it anywhere.', 'note']
  }[UIState.view];
  qs('#itemlist').innerHTML = list.length ? list.map(itemRow).join('') :
    `<div class="empty"><div class="glyph">${emptyMsg[0]}</div><p><b>${emptyMsg[1]}</b><br>${emptyMsg[2]}</p><button class="btn btn-primary btn-sm" onclick="Infallyn.openCapture('${emptyMsg[3]}')">＋ Add</button></div>`;
}
L.newShelf = () => { const name = prompt('Name the new shelf:'); if (name && name.trim()) { S.shelvesOrder.push(name.trim().toLowerCase()); saveState(); L.setShelf(name.trim().toLowerCase()); } };
L.toggleTask = id => {
  const it = itemById(id); if (!it) return;
  if (it.status === 'open') { it.status = 'done'; it.completedAt = Date.now(); try { navigator.vibrate(10); } catch (e) {} }
  else { it.status = 'open'; it.completedAt = null; it.notified = false; }
  saveState(); renderAll();
};
function renderHeader() {
  const { streak } = computeStreak();
  const el = qs('#hdr-streak');
  el.style.display = streak > 0 ? 'inline-flex' : 'none';
  el.innerHTML = `<svg class="flame" viewBox="0 0 24 24"><path d="M12 2c1.2 3.2-1.8 4.6-1.8 7.4a3.9 3.9 0 0 0 7.8.4c1.4 1.1 2 2.6 2 4.1A8 8 0 1 1 4 14c0-4.2 4.2-6.4 8-12z"/></svg>${streak}`;
  const av = qs('#btn-user');
  if (av && Auth.session) {
    av.style.display = 'grid';
    av.textContent = Auth.session.user[0];
    av.style.background = 'hsl(' + Auth.hue(Auth.session.user) + ' 38% 42%)';
  }
}

/* ---------------- render: widgets ---------------- */
function renderWidgets() {
  const q = buildQueue();
  const doneToday = (S.sessions[dayKey()] && S.sessions[dayKey()].reviewed) || 0;
  const total = q.queue.length + Math.min(doneToday, 1) * 0; // ring = done/(done+remaining)
  const denom = q.queue.length + (doneToday > 0 ? Math.min(doneToday, q.queue.length + doneToday) : 0);
  const frac = (q.queue.length === 0 && doneToday > 0) ? 1 : denom ? doneToday / Math.max(doneToday + q.queue.length, 1) : 0;
  const C = 2 * Math.PI * 24;
  qs('#ring-fg').style.strokeDashoffset = C * (1 - clamp(frac, 0, 1));
  if (q.queue.length === 0 && doneToday > 0) qs('#ring-num').textContent = '✓';
  else qs('#ring-num').textContent = q.queue.length || (doneToday ? '✓' : '0');
  qs('#wd-due').textContent = q.queue.length ? q.queue.length + ' due' : (doneToday ? 'Done ✓' : 'Rest night');
  qs('#wd-sub').textContent = q.queue.length ? '≈ ' + fmtDur(q.estSec) + ' · opens ' + S.settings.doseTime : (doneToday ? reviewed + ' reviewed tonight'.replace('{n}', doneToday) : 'Nothing due tonight');
  qs('#wd-sub').textContent = q.queue.length ? '≈ ' + fmtDur(q.estSec) + ' · opens ' + S.settings.doseTime : (doneToday ? doneToday + ' reviewed tonight' : 'Nothing due tonight');
  const nextTask = S.items.filter(i => i.type === 'task' && i.status === 'open' && i.due).sort((a, b) => a.due - b.due)[0];
  qs('#wn-title').textContent = nextTask ? (nextTask.title || 'Task') : 'All clear';
  qs('#wn-sub').textContent = nextTask ? fmtRel(nextTask.due) : 'Nothing scheduled';
  qs('#widget-next').onclick = () => { if (nextTask) L.openEditor(nextTask.id); };
  const dk = dayKey();
  qs('#widget-dose').onclick = () => go(S.sessions[dk] && S.sessions[dk].completed ? '#/dose' : '#/dose/start');
  Player.updateChrome();
}
function reviewed() { return 0; }

/* ---------------- render: dose tab ---------------- */
function renderDose() {
  const el = qs('#view-dose');
  const q = buildQueue();
  const dk = dayKey();
  const doneToday = S.sessions[dk] && S.sessions[dk].completed;
  const { streak } = computeStreak();
  const now = Date.now();
  const hero = q.queue.length
    ? `<div class="bigcard">
        <div class="w-label" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600">Tonight's dose${doneToday ? ' · extra credit' : ''}</div>
        <div class="hero-title mt8">${q.queue.length} card${q.queue.length === 1 ? '' : 's'} · ≈ ${fmtDur(q.estSec)}</div>
        <div class="hero-sub">${q.dueTotal > q.queue.length ? (q.dueTotal - q.queue.length) + ' more roll to tomorrow · ' : ''}opens automatically at ${esc(S.settings.doseTime)}${q.newTotal ? ` · ${Math.min(q.newTotal, S.settings.newCap)} new` : ''}</div>
        <div class="dosestat">
          <div class="stat"><b>${streak}</b><span>night streak</span></div>
          <div class="stat"><b>${q.queue.filter(x => x.kind === 'photo').length}</b><span>photos</span></div>
          <div class="stat"><b>${q.queue.filter(x => x.kind !== 'photo').length}</b><span>notes</span></div>
        </div>
        <button class="btn btn-primary btn-block mt16" onclick="Infallyn.startDose()">🌙 ${doneToday ? 'Another round' : 'Start tonight\'s dose'}</button>
      </div>`
    : `<div class="bigcard">
        <div class="w-label" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600">Tonight's dose</div>
        <div class="hero-title mt8">${doneToday ? 'Shelf closed. Sleep well.' : 'The shelf rests tonight.'}</div>
        <div class="hero-sub">${doneToday ? 'Dose complete — see you tomorrow at ' + esc(S.settings.doseTime) + '.' : 'Nothing is due right now. Add a memory or a note card below.'}</div>
        <button class="btn btn-ghost btn-block mt16" onclick="pickFiles('memory')">📷 Remember a moment</button>
      </div>`;

  // 12-week heatmap
  const counts = {};
  S.reviews.forEach(r => { const k = dayKey(r.at); counts[k] = (counts[k] || 0) + 1; });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 83); start.setDate(start.getDate() - start.getDay());
  let cells = '';
  for (let w = 0; w < 13; w++) for (let d = 0; d < 7; d++) {
    const dd = new Date(start); dd.setDate(dd.getDate() + w * 7 + d);
    if (dd > today) { cells += '<span class="hm" style="background:transparent"></span>'; continue; }
    const k = dayKey(dd), n = counts[k] || 0;
    const bg = n === 0 ? 'var(--surface2)' : n < 3 ? 'color-mix(in srgb,var(--accent) 30%,var(--surface2))' : n < 8 ? 'color-mix(in srgb,var(--accent) 60%,var(--surface2))' : 'var(--accent)';
    cells += `<span class="hm" style="background:${bg}" title="${k}: ${n} reviews"></span>`;
  }
  // forecast 7 days
  let fc = '';
  for (let d = 0; d < 7; d++) {
    const dayStart = new Date(today); dayStart.setDate(dayStart.getDate() + d);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const n = S.cards.filter(cc => !cc.suspended && cc.state !== 'new' && cc.due >= dayStart.getTime() && cc.due < dayEnd.getTime()).length;
    const h = Math.max(4, Math.min(40, n * 7));
    fc += `<div style="flex:1;text-align:center"><div style="height:44px;display:flex;align-items:flex-end"><div style="width:100%;height:${h}px;border-radius:6px;background:${n ? 'var(--accent)' : 'var(--surface2)'}"></div></div><div class="muted" style="font-size:10.5px;margin-top:4px">${d === 0 ? 'Today' : WDAYS[dayStart.getDay()]}</div><div style="font-size:11px;font-weight:700">${n || ''}</div></div>`;
  }
  const totalReviews = S.reviews.length;
  const agains = S.reviews.filter(r => r.rating === 'again').length;
  const retention = totalReviews ? Math.round((1 - agains / totalReviews) * 100) : null;

  const cardsList = [...S.cards].sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 12).map(cc =>
    `<div class="cardmanage">
      ${cc.kind === 'photo' && cc.media ? mediaImg(cc.media, '', 'card') : `<div style="width:46px;height:46px;border-radius:10px;background:var(--surface2);display:grid;place-items:center;flex:none">📝</div>`}
      <div class="cm-t"><div>${esc((cc.caption || 'Untitled').slice(0, 40))}</div><div class="cm-s">${cc.kind === 'photo' ? 'Memory' : 'Note'} · ${cc.suspended ? 'suspended' : (cc.due || 0) <= now ? 'due now' : fmtRel(cc.due)}${cc.state === 'new' ? ' · new' : ''}</div></div>
      <button class="cm-ico${cc.suspended ? ' sus-on' : ''}" title="Suspend" onclick="Infallyn.toggleSuspend('${cc.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4v16M15 4v16"/></svg></button>
      <button class="cm-ico" title="Delete" onclick="Infallyn.deleteCard('${cc.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></svg></button>
    </div>`).join('');

  el.innerHTML = `
    ${hero}
    <div class="sectionlabel">Nights</div>
    <div class="panel">
      <div id="heatmap">${cells}</div>
      <div class="dosestat">
        <div class="stat"><b>${streak}</b><span>streak</span></div>
        <div class="stat"><b>${retention == null ? '–' : retention + '%'}</b><span>retention</span></div>
        <div class="stat"><b>${totalReviews}</b><span>reviews</span></div>
      </div>
      <div class="sectionlabel">Next 7 days</div>
      <div class="row" style="align-items:flex-end">${fc}</div>
    </div>
    <div class="sectionlabel">Memory cards</div>
    <div class="panel">
      <div class="row" style="margin-bottom:8px"><span class="muted small grow">${S.cards.length} cards in the gallery</span>
        <button class="btn btn-ghost btn-sm" onclick="pickFiles('memory')">📷 Add memory</button></div>
      ${cardsList || '<p class="muted small">No cards yet — use “Remember tonight” on any note, or add a photo memory.</p>'}
    </div>
    <div class="sectionlabel">Dose settings</div>
    <div class="panel settingsgroup">
      <div class="setrow"><div class="sr-main"><div class="sr-t">Dose time</div><div class="sr-s">When tonight's invitation arrives</div></div>
        <div class="sr-ctl"><input type="time" class="input" id="set-dosetime" value="${esc(S.settings.doseTime)}" style="width:110px"></div></div>
      <div class="setrow"><div class="sr-main"><div class="sr-t">Cards per night</div><div class="sr-s">Keep it small enough to never miss</div></div>
        <div class="sr-ctl"><b id="cap-val">${S.settings.doseCap}</b><input type="range" id="set-cap" min="5" max="50" step="5" value="${S.settings.doseCap}" style="width:110px"></div></div>
      <div class="setrow"><div class="sr-main"><div class="sr-t">New cards per night</div><div class="sr-s">Fresh material, paced</div></div>
        <div class="sr-ctl"><b id="ncap-val">${S.settings.newCap}</b><input type="range" id="set-ncap" min="0" max="10" step="1" value="${S.settings.newCap}" style="width:110px"></div></div>
      <div class="togglerow"><div class="tr-main"><div class="tr-t">Second nudge</div><div class="tr-s">One gentle reminder, 45 minutes later</div></div><label class="switch"><input type="checkbox" id="set-renudge"${S.settings.reNudge ? ' checked' : ''}><span class="tr"></span></label></div>
    </div>`;
  qs('#set-dosetime').onchange = e => { S.settings.doseTime = e.target.value || '21:30'; saveState(); renderWidgets(); toast('Dose opens at ' + S.settings.doseTime); };
  qs('#set-cap').oninput = e => { S.settings.doseCap = +e.target.value; qs('#cap-val').textContent = e.target.value; saveState(); };
  qs('#set-cap').onchange = () => renderDose();
  qs('#set-ncap').oninput = e => { S.settings.newCap = +e.target.value; qs('#ncap-val').textContent = e.target.value; saveState(); };
  qs('#set-ncap').onchange = () => renderDose();
  qs('#set-renudge').onchange = e => { S.settings.reNudge = e.target.checked; saveState(); };
}
function dkSafe() { return dayKey(); }
L.toggleSuspend = id => { const c = S.cards.find(x => x.id === id); if (c) { c.suspended = !c.suspended; saveState(); renderDose(); renderWidgets(); } };
L.deleteCard = id => {
  const i = S.cards.findIndex(x => x.id === id); if (i < 0) return;
  const [c] = S.cards.splice(i, 1); saveState(); renderDose(); renderWidgets();
  toast('Card removed', { action: { label: 'Undo', fn: () => { S.cards.splice(i, 0, c); saveState(); renderDose(); renderWidgets(); } } });
};
L.startDose = L.startDose; // bound

/* ---------------- render: listen ---------------- */
function renderListen() {
  const el = qs('#view-listen');
  const items = Player.listenItems();
  const rows = items.map(i => {
    const words = mdToPlain(i.body).split(/\s+/).filter(Boolean).length;
    const est = Math.max(1, Math.round(words / 150));
    return `<div class="listenrow${Player.trackId === i.id ? ' playing' : ''}" data-id="${i.id}" onclick="Infallyn.openEditor('${i.id}')">
      <span class="lr-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/></svg></span>
      <div class="it-main"><div class="it-title">${esc(i.title || 'Untitled')}</div><div class="it-meta"><span class="metachip">${words} words · ≈ ${est} min</span>${i.source === 'ocr' ? '<span class="metachip">✍ scanned</span>' : ''}</div></div>
      <button class="lr-play" aria-label="Play" onclick="event.stopPropagation();Infallyn.playItem('${i.id}')"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="bigcard" style="margin-bottom:14px">
      <div class="hero-title">${items.length ? 'The listening room' : 'Nothing to listen to yet'}</div>
      <div class="hero-sub">${items.length ? 'Notes and documents, read aloud. Tap the transcript to jump around — perfect for the commute.' : 'Scan a handwritten page or write a note — then press play.'}</div>
      ${items.length && Player.trackId ? '<button class="btn btn-primary btn-block mt16" onclick="Infallyn.openTranscript()">🎧 Open player & transcript</button>' : ''}
    </div>
    <div class="sectionlabel">Queue · ${items.length} items</div>
    <div style="display:flex;flex-direction:column;gap:8px">${rows || ''}</div>`;
}
L.playItem = id => { Player.load(id, true); renderListen(); };

/* ---------------- render: you ---------------- */
function renderYou() {
  const el = qs('#view-you');
  const notifStatus = ('Notification' in window) ? Notification.permission : 'unsupported';
  const acc = Auth.accounts()[Auth.session.user] || {};
  const since = acc.createdAt ? new Date(acc.createdAt) : null;
  const stayOn = !!Store.get(Auth.autoKey(Auth.session.user));
  el.innerHTML = `
    <div class="sectionlabel">Account</div>
    <div class="panel settingsgroup">
      <div class="setrow">
        <span class="lk-ava" style="background:hsl(${Auth.hue(Auth.session.user)} 38% 42%)">${esc(Auth.session.user[0])}</span>
        <div class="sr-main"><div class="sr-t">${esc(Auth.session.user)}</div>
          <div class="sr-s">${since ? 'Keeper of this Infallyn since ' + since.getDate() + ' ' + MONTHS[since.getMonth()] + ' ' + since.getFullYear() + ' · ' : ''}vault encrypted with your passphrase</div></div>
        <div class="sr-ctl"><button class="btn btn-ghost btn-sm" onclick="Infallyn.lockNow()">Lock</button><button class="btn btn-danger btn-sm" onclick="Infallyn.signOut()">Sign out</button></div>
      </div>
      <div class="togglerow"><div class="tr-main"><div class="tr-t">Stay signed in on this device</div><div class="tr-s">Skips the lock screen — anyone using this browser could open your Infallyn</div></div><label class="switch"><input type="checkbox" id="set-stay"${stayOn ? ' checked' : ''}><span class="tr"></span></label></div>
      <div class="setrow"><div class="sr-main"><div class="sr-t">Auto-lock when hidden</div><div class="sr-s">Lock Infallyn after being away this long</div></div>
        <div class="sr-ctl"><select class="input" id="set-autolock">
          <option value="0"${+S.settings.autolock === 0 ? ' selected' : ''}>Never</option>
          <option value="1"${+S.settings.autolock === 1 ? ' selected' : ''}>1 min</option>
          <option value="5"${+S.settings.autolock === 5 ? ' selected' : ''}>5 min</option>
          <option value="15"${+S.settings.autolock === 15 ? ' selected' : ''}>15 min</option>
        </select></div></div>
      <div class="setrow"><div class="sr-main"><div class="sr-t">Switch account</div><div class="sr-s">${Object.keys(Auth.accounts()).length} account${Object.keys(Auth.accounts()).length === 1 ? '' : 's'} on this device</div></div>
        <div class="sr-ctl"><button class="btn btn-ghost btn-sm" onclick="Infallyn.switchAccount()">Switch</button></div></div>
    </div>
    <div class="sectionlabel">Appearance</div>
    <div class="panel settingsgroup">
      <div class="setrow"><div class="sr-main"><div class="sr-t">Theme</div><div class="sr-s">Reading Room (light) · Night Shelf (warm dark)</div></div>
        <div class="sr-ctl"><select class="input" id="set-theme">
          <option value="auto"${S.settings.theme === 'auto' ? ' selected' : ''}>Auto</option>
          <option value="light"${S.settings.theme === 'light' ? ' selected' : ''}>Reading Room</option>
          <option value="dark"${S.settings.theme === 'dark' ? ' selected' : ''}>Night Shelf</option>
        </select></div></div>
    </div>
    <div class="sectionlabel">Reminders</div>
    <div class="panel settingsgroup">
      <div class="setrow"><div class="sr-main"><div class="sr-t">Notifications</div><div class="sr-s" id="notif-status">${notifStatus === 'granted' ? 'Enabled — reminders will reach you' : notifStatus === 'denied' ? 'Blocked in browser settings' : notifStatus === 'unsupported' ? 'Not available in this preview' : 'Tap enable, then allow'}</div></div>
        <div class="sr-ctl">${notifStatus === 'granted' ? '' : `<button class="btn btn-ghost btn-sm" onclick="Infallyn.enableNotifications()">Enable</button>`}<button class="btn btn-ghost btn-sm" onclick="Infallyn.testNotification()">Test</button></div></div>
      <div class="togglerow"><div class="tr-main"><div class="tr-t">Evening dose nudge</div><div class="tr-s">Nightly invitation at ${esc(S.settings.doseTime)} + one gentle re-nudge</div></div><label class="switch"><input type="checkbox" id="set-renudge2"${S.settings.reNudge ? ' checked' : ''}><span class="tr"></span></label></div>
    </div>
    <div class="sectionlabel">Voice & audio</div>
    <div class="panel settingsgroup">
      <div class="setrow" style="flex-direction:column;align-items:stretch">
        <div class="sr-t">Default voice</div>
        <select class="input" id="set-voice" style="margin-top:8px;width:100%"></select>
        <div class="sr-s mt8">On-device voices, free and private. Premium cloud voices can be added later.</div>
      </div>
      <div class="setrow" style="flex-direction:column;align-items:stretch"><div class="sr-t">Speed <span id="set-rate-val" style="color:var(--accent)">${S.settings.rate}×</span></div>
        <input type="range" id="set-rate" min="0.5" max="3" step="0.25" value="${S.settings.rate}" style="margin-top:8px"></div>
    </div>
    <div class="sectionlabel">Data — yours to keep</div>
    <div class="panel settingsgroup">
      <div class="setrow"><div class="sr-main"><div class="sr-t">Export</div><div class="sr-s">One JSON file: every note, card, review, and photo</div></div><div class="sr-ctl"><button class="btn btn-ghost btn-sm" onclick="Infallyn.exportData()">Export</button></div></div>
      <div class="setrow"><div class="sr-main"><div class="sr-t">Import</div><div class="sr-s">Restore from an Infallyn export</div></div><div class="sr-ctl"><button class="btn btn-ghost btn-sm" onclick="pickFiles('json')">Import</button></div></div>
      <div class="setrow"><div class="sr-main"><div class="sr-t">Start fresh</div><div class="sr-s">Remove all content, keep nothing</div></div><div class="sr-ctl"><button class="btn btn-danger btn-sm" onclick="Infallyn.startFresh()">Clear</button></div></div>
      <div class="setrow"><div class="sr-main"><div class="sr-t">Restore samples</div><div class="sr-s">Bring back the demonstration content</div></div><div class="sr-ctl"><button class="btn btn-ghost btn-sm" onclick="Infallyn.restoreSamples()">Restore</button></div></div>
    </div>
    <div class="sectionlabel">About</div>
    <div class="panel"><p class="aboutnote">
      <img class="about-emblem" src="data:image/webp;base64,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" alt="Infallyn emblem">
      <b class="serif" style="font-size:16px;color:var(--ink)">Infallyn</b> · v1.2 — local-first, account-private study platform.<br><br>
      🔒 Your space is sealed with your passphrase: PBKDF2-derived AES-256 encryption, on this device only. Passphrases are never stored; photos are encrypted too. No server, no tracking, nothing trains a model.<br>
      🌙 The Daily Dose uses an FSRS-style spaced repetition schedule tuned for small nightly sessions.<br>
      ✍ Handwriting is recognized by Tesseract when online; the original images stay encrypted beside the text.<br><br>
      <span class="muted">Four pillars: the Shelf, the nightly Dose, the OCR→Audio engine, and glanceable widgets — yours per account.</span>
    </p></div>`;
  qs('#set-theme').onchange = e => { S.settings.theme = e.target.value; saveState(); applyTheme(); };
  qs('#set-renudge2').onchange = e => { S.settings.reNudge = e.target.checked; saveState(); };
  const rate = qs('#set-rate'); rate.oninput = e => { qs('#set-rate-val').textContent = e.target.value + '×'; S.settings.rate = +e.target.value; saveState(); };
  rate.onchange = () => { if (Player.speaking) Player.speak(Player.si); };
  const vs = qs('#set-voice');
  if (Player.supported) {
    const list = Player.voices();
    vs.innerHTML = list.length ? list.map(v => `<option value="${esc(v.voiceURI)}"${v.voiceURI === S.settings.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('') : '<option>System default</option>';
    vs.onchange = () => { S.settings.voiceURI = vs.value; saveState(); if (Player.speaking) Player.speak(Player.si); };
  } else vs.innerHTML = '<option>Not available in preview</option>';
  const stay = qs('#set-stay');
  stay.onchange = async () => { await Auth.setStay(stay.checked); toast(stay.checked ? 'Will stay signed in on this device.' : 'Will require your passphrase next time.'); };
  qs('#set-autolock').onchange = e => { S.settings.autolock = +e.target.value; saveState(); toast(+e.target.value ? 'Locks after ' + e.target.value + ' min hidden.' : 'Auto-lock off.'); };
}

/* ---------------- theme ---------------- */
function applyTheme() {
  let t = S.settings.theme;
  if (t === 'auto') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
}
L.toggleTheme = () => {
  const cur = document.documentElement.dataset.theme;
  S.settings.theme = cur === 'dark' ? 'light' : 'dark'; saveState(); applyTheme();
  toast(S.settings.theme === 'dark' ? 'Night Shelf — warm and dim' : 'Reading Room — daylight');
};
matchMedia && matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'auto') applyTheme(); });

/* ---------------- notifications & reminders ---------------- */
async function notifyUser(title, body, hash) {
  toast(body ? title + ' — ' + body : title, { action: { label: 'Open', fn: () => go(hash) }, ms: 6000 });
  try {
    if (('Notification' in window) && Notification.permission === 'granted') {
      const n = new Notification(title, { body, tag: hash, silent: false });
      n.onclick = () => { try { window.focus(); } catch (e) {} go(hash); n.close(); };
    }
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate([20, 60, 20]); } catch (e) {}
}
L.enableNotifications = async () => {
  try {
    if (!('Notification' in window)) { toast('Notifications are not available here.'); return; }
    const p = await Notification.requestPermission();
    renderYou();
    toast(p === 'granted' ? 'Reminders enabled — see you at ' + S.settings.doseTime : 'No problem — the widget ring will nudge instead.');
  } catch (e) { toast('Notifications are blocked in this preview context.'); }
};
L.testNotification = () => notifyUser('It works ✔', 'This is how task reminders and the nightly dose will appear.', '#/you');
function tick() {
  const now = Date.now(); let changed = false;
  for (const it of S.items) {
    if (it.type === 'task' && it.status === 'open' && it.due && it.due <= now && !it.notified) {
      it.notified = true; changed = true;
      notifyUser('Task due now', it.title, '#/item/' + it.id);
    }
  }
  const dk = dayKey(now);
  const [hh, mm] = (S.settings.doseTime || '21:30').split(':').map(Number);
  const doseAt = new Date(); doseAt.setHours(hh || 21, mm || 30, 0, 0);
  const doneToday = S.sessions[dk] && S.sessions[dk].completed;
  const q = buildQueue(now);
  if (now >= doseAt.getTime() && !doneToday && q.queue.length && !S.flags['dose1.' + dk]) {
    S.flags['dose1.' + dk] = now; changed = true;
    notifyUser("Tonight's Dose is ready", q.queue.length + ' cards · about ' + fmtDur(q.estSec), '#/dose/start');
    if (S.settings.reNudge) { S.flags['dose2at.' + dk] = now + 45 * MIN; }
  }
  if (S.flags['dose2at.' + dk] && now >= S.flags['dose2at.' + dk] && !S.flags['dose2.' + dk] && !doneToday) {
    S.flags['dose2.' + dk] = now; changed = true;
    notifyUser('Infallyn is closing soon', q.queue.length + ' cards are waiting for tonight', '#/dose/start');
  }
  if (changed) saveState();
  renderWidgets(); renderHeader(); updateDots();
}
function updateDots() {
  const doseDue = buildQueue().queue.length > 0 && !(S.sessions[dayKey()] && S.sessions[dayKey()].completed);
  qsa('.navbtn').forEach(b => {
    if (b.dataset.tab === 'dose') b.classList.toggle('hasdot', doseDue);
    if (b.dataset.tab === 'shelf') b.classList.toggle('hasdot', S.items.some(i => i.type === 'task' && i.status === 'open' && i.due && i.due < Date.now()));
  });
}

/* ---------------- search ---------------- */
L.openSearch = () => { sheetOpen('searchwrap'); setTimeout(() => qs('#searchinput').focus(), 200); doSearch(); };
function doSearch() {
  const q = qs('#searchinput').value.trim().toLowerCase();
  const box = qs('#searchresults');
  if (!q) { box.innerHTML = '<p class="muted small" style="padding:12px 2px">Try “endorphin”, “goa”, “bill”… everything you have written is searchable.</p>'; return; }
  const hits = S.items.filter(i => (i.title || '').toLowerCase().includes(q) || mdToPlain(i.body).toLowerCase().includes(q) || i.tags.some(t => t.toLowerCase().includes(q))).slice(0, 20);
  box.innerHTML = hits.length ? hits.map(itemRow).join('') : '<p class="muted small" style="padding:12px 2px">Nothing on the shelves matches “' + esc(q) + '”.</p>';
  qsa('#searchresults .itemrow').forEach(r => r.addEventListener('click', () => sheetClose('searchwrap')));
}

/* ---------------- data: export / import / reset ---------------- */
L.exportData = async () => {
  const media = await Media.allData();
  const blob = new Blob([JSON.stringify({ app: 'Infallyn', version: 1, exportedAt: new Date().toISOString(), state: S, media }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'infallyn-export-' + dayKey() + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Export downloaded — notes, cards, and photos included.');
};
async function importDataFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'Infallyn' || !data.state) throw new Error('Not an Infallyn export');
    normalizeState(data.state);
    await Media.importData(data.media);
    saveState(); applyTheme(); renderAll(); sheetClose('searchwrap'); sheetClose('editorsheet');
    toast('Infallyn restored from export.');
  } catch (e) { toast('That file could not be imported (' + e.message + ').'); }
}
L.lockNow = () => Auth.lock(false);
L.signOut = () => Auth.lock(true);
L.switchAccount = () => Auth.lock(true);
L.startFresh = () => { if (confirm('Clear everything in ' + Auth.session.user + "'s Infallyn? Tasks, notes, cards, and history will be gone.")) { freshState(false); S.settings.welcomeSeen = true; Media.wipeUser(); Auth.persist(); renderAll(); toast('Blank shelves. Fill them with something worth keeping.'); } };
L.restoreSamples = () => { if (confirm('Replace the current content with samples?')) { freshState(true); Auth.persist(); renderAll(); toast('Sample content restored.'); } };

/* ---------------- keyboard ---------------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (qs('#doseoverlay').classList.contains('on')) { L.closeDose(); return; } if (closeTopSheet()) return; }
  if (DZ.active && !anySheetOpen()) {
    if (e.key === ' ') { e.preventDefault(); L.flipCard(); }
    const map = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
    if (map[e.key] && DZ.revealed) L.doseGrade(map[e.key]);
  }
});

/* ---------------- welcome ---------------- */
qs('#wl-start').onclick = () => {
  const t = qs('#wl-dosetime').value; if (t) S.settings.doseTime = t;
  S.settings.welcomeSeen = true; saveState(); sheetClose('welcome'); renderAll();
  toast('Infallyn is yours. Tonight\'s dose opens at ' + S.settings.doseTime + '.');
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
};

/* ---------------- render all & init ---------------- */
function renderAll() {
  renderHeader(); renderWidgets(); renderShelf(); renderDose(); renderListen();
  if (UIState.tab === 'you') renderYou();
  updateDots();
}
L.renderAll = renderAll;

function runSelfTestUI() {
  const results = runSelfTests();
  const div = document.createElement('div');
  div.id = 'selftest-out';
  div.style.cssText = 'position:fixed;top:4px;left:4px;right:4px;z-index:9999;background:#111;color:#dfd;font:12px monospace;padding:10px;border-radius:8px;max-height:50vh;overflow:auto;white-space:pre-wrap';
  const fails = results.filter(r => !r.pass);
  div.textContent = 'SELFTEST ' + (fails.length ? 'FAIL (' + fails.length + ')' : 'PASS') + '\n' + results.map(r => (r.pass ? ' ✔ ' : ' ✘ ') + r.name + (r.pass ? ' — ' + r.detail : ' — ' + r.detail)).join('\n');
  document.body.appendChild(div);
  console.log('SELFTEST', fails.length ? 'FAIL' : 'PASS', results);
}
/* ---------------- app lifecycle: boot / lock / unlock ---------------- */
let tickTimer = null, appBound = false, appBooted = false;
function bindApp() {
  if (appBound) return; appBound = true;
  qsa('.navbtn').forEach(b => b.addEventListener('click', () => go('#/' + b.dataset.tab)));
  qs('#nav-capture').addEventListener('click', () => L.openCapture('task'));
  qs('#capture-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { captureSeg = b.dataset.seg; qsa('#capture-seg button').forEach(x => x.classList.toggle('active', x === b)); renderCaptureBody(); } });
  qs('#widget-now').addEventListener('click', e => { if (e.target.closest('.wn-ctrls')) return; go('#/listen'); });
  qs('#np-prev').onclick = () => Player.prevS(); qs('#np-play').onclick = () => Player.playPause(); qs('#np-next').onclick = () => Player.nextS();
  qs('#pb-play').onclick = () => Player.playPause();
  qs('#pb-transcript').onclick = () => L.openTranscript();
  qs('#btn-search').onclick = () => L.openSearch();
  qs('#btn-theme').onclick = () => L.toggleTheme();
  qs('#searchinput').addEventListener('input', doSearch);
  qs('#tr-rate').addEventListener('input', e => { qs('#tr-rate-val').textContent = (+e.target.value).toFixed(2).replace(/\.?0+$/, '') + '×'; Player.setRate(+e.target.value); });
  qs('#tr-sleep').addEventListener('change', e => Player.sleep(+e.target.value));
  const pnx = qs('#preview-note-extra');
  if (pnx) pnx.textContent = Store.persistent ? 'Everything persists right here in your browser.' : 'This embedded preview is session-only — download the file and open it in a browser for a persistent vault.';
}
function restartTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => { if (Auth.session) tick(); }, 20000);
  setTimeout(() => { if (Auth.session) tick(); }, 900);
}
function startApp(reason) {
  applyTheme();
  bindApp();
  if (!location.hash) { try { location.hash = '#/shelf'; } catch (e) {} }
  routeTo(location.hash || '#/shelf');
  restartTick();
  if (Player.supported) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => fillVoiceSelect(); } catch (e) {} }
  if (!appBooted) {
    appBooted = true;
    try { if (new URLSearchParams(location.search).has('selftest')) runSelfTestUI(); } catch (e) {}
  }
  if (!S.settings.welcomeSeen) sheetOpen('welcome');
  console.log('%cInfallyn ready', 'color:#D4A85A;font-weight:bold', '· user:', Auth.session.user, '· items:', S.items.length, '· cards:', S.cards.length);
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => Auth.boot()) : Auth.boot();
