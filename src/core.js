'use strict';
/* =====================================================================
   INFALLYN — core domain logic (pure, DOM-free)
   Storage • media • smart parser • FSRS-lite scheduler • dose queue
   streaks • sentence splitting • seed data • self-tests
   ===================================================================== */

/* ---------------- utils ---------------- */
const qs  = (s, el) => (el || document).querySelector(s);
const qsa = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const b64 = { enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))), dec: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };

function dayKey(ts) { const d = ts instanceof Date ? ts : new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function keyToDate(k) { const [y, m, dd] = k.split('-').map(Number); return new Date(y, m - 1, dd); }
function keyOffset(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / DAY); }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WDAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtTime(ts) { const d = new Date(ts); let h = d.getHours(), m = pad2(d.getMinutes()); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + m + ap; }
function fmtRel(ts) {
  if (!ts) return '';
  const now = new Date(), d = new Date(ts), tk = dayKey(now), dk = dayKey(ts);
  const diff = daysBetween(tk, dk);
  const time = ' ' + fmtTime(ts);
  if (diff === 0) return 'Today' + time;
  if (diff === 1) return 'Tomorrow' + time;
  if (diff === -1) return 'Yesterday' + time;
  if (diff > 1 && diff < 7) return WDAYS[d.getDay()] + time;
  if (diff < -1 && diff > -6) return Math.abs(diff) + 'd overdue';
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + time;
}
function fmtDur(sec) { if (sec < 60) return Math.round(sec) + ' s'; if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + ' min'; return (sec / 3600).toFixed(1) + ' h'; }

/* ---------------- safe storage (sandbox-proof) ---------------- */
const Store = (() => {
  let ok = false; const mem = {};
  try { const t = '__lib_t'; localStorage.setItem(t, '1'); localStorage.removeItem(t); ok = true; } catch (e) { ok = false; }
  return {
    persistent: ok,
    get(k) { if (ok) { try { return localStorage.getItem(k); } catch (e) {} } return (k in mem) ? mem[k] : null; },
    set(k, v) { if (ok) { try { localStorage.setItem(k, v); return; } catch (e) { /* quota or security */ } } mem[k] = v; },
    del(k) { if (ok) { try { localStorage.removeItem(k); } catch (e) {} } delete mem[k]; }
  };
})();

/* ---------------- media store (IndexedDB, per-account encrypted) ---------------- */
const Media = (() => {
  let dbp = null; const mem = new Map(); let broken = false;
  let ns = 'u/anon/', ckey = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('infallyn-media', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('m');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    dbp.catch(() => { broken = true; });
    return dbp;
  }
  async function putRaw(k, v) {
    if (k.startsWith('data:')) return;
    try { const db = await open(); await new Promise((res, rej) => { const tx = db.transaction('m', 'readwrite'); tx.objectStore('m').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
    catch (e) { mem.set(k, v); }
  }
  async function getRaw(k) {
    if (mem.has(k)) return mem.get(k);
    if (broken) return null;
    try { const db = await open(); return await new Promise((res, rej) => { const tx = db.transaction('m', 'readonly'); const q = tx.objectStore('m').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); }); }
    catch (e) { return mem.get(k) ?? null; }
  }
  async function delRaw(k) { mem.delete(k); try { const db = await open(); await new Promise((res, rej) => { const tx = db.transaction('m', 'readwrite'); tx.objectStore('m').delete(k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) {} }
  async function rawKeys() {
    const mk = [...mem.keys()];
    try { const db = await open(); const ks = await new Promise((res, rej) => { const tx = db.transaction('m', 'readonly'); const q = tx.objectStore('m').getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); return [...new Set(mk.concat(ks.map(String)))]; }
    catch (e) { return mk; }
  }
  async function encStr(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ckey, new TextEncoder().encode(text));
    return JSON.stringify({ iv: b64.enc(iv), ct: b64.enc(ct) });
  }
  async function decStr(pack) {
    const p = JSON.parse(pack);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(p.iv) }, ckey, b64.dec(p.ct));
    return new TextDecoder().decode(pt);
  }
  return {
    setContext(user, key) { ns = 'u/' + String(user || 'anon').replace(/[^\w.-]/g, '_') + '/'; ckey = key || null; },
    async put(id, dataUrl) {
      if (!id || id.startsWith('data:')) return;
      let v = dataUrl;
      if (ckey) { try { v = await encStr(dataUrl); } catch (e) { v = dataUrl; } }
      await putRaw(ns + id, v);
    },
    async get(id) {
      if (!id) return null;
      if (id.startsWith('data:')) return id;
      let v = await getRaw(ns + id);
      if (v == null) v = await getRaw(id); /* pre-account legacy record */
      if (v == null) return null;
      if (typeof v === 'string' && v.startsWith('data:')) return v;
      if (!ckey) return null;
      try { return await decStr(v); } catch (e) { return null; }
    },
    async del(id) { if (!id || id.startsWith('data:')) return; await delRaw(ns + id); },
    async migrateLegacy() {
      if (!ckey) return;
      for (const k of await rawKeys()) {
        if (k.startsWith('u/')) continue;
        const v = await getRaw(k);
        if (v == null) continue;
        const val = (typeof v === 'string' && v.startsWith('data:')) ? await encStr(v) : v;
        await putRaw(ns + k, val);
        await delRaw(k);
      }
    },
    async wipeUser() { for (const k of await rawKeys()) if (k.startsWith(ns)) await delRaw(k); },
    async allData() {
      const out = {};
      for (const k of await rawKeys()) {
        if (!k.startsWith(ns)) continue;
        const v = await getRaw(k);
        if (v == null) continue;
        if (typeof v === 'string' && v.startsWith('data:')) out[k.slice(ns.length)] = v;
        else if (ckey) { try { out[k.slice(ns.length)] = await decStr(v); } catch (e) {} }
      }
      return out;
    },
    async importData(obj) { for (const k of Object.keys(obj || {})) await this.put(k, obj[k]); },
    async wipe() { await this.wipeUser(); }
  };
})();

/* ---------------- state ---------------- */
const LS_KEY = 'infallyn.state.v1';
const DEFAULTS = {
  settings: {
    theme: 'auto', doseTime: '21:30', doseCap: 20, newCap: 5,
    reNudge: true, quietNotify: false, rate: 1, voiceURI: '', sleepMin: 0,
    welcomeSeen: false, autoTTS: false, autolock: 0
  },
  items: [], cards: [], reviews: [],        // reviews: {cardId, rating, at, ivl}
  sessions: {},                              // dateKey -> {reviewed, completed}
  lastGrace: null,
  flags: {},                                 // notified task ids, dose nudge bookkeeping
  shelvesOrder: []
};
let S = null;
function loadState() {
  try { S = JSON.parse(Store.get(LS_KEY) || 'null'); } catch (e) { S = null; }
  if (!S) { S = JSON.parse(JSON.stringify(DEFAULTS)); seedData(); saveState(); }
  S.settings = Object.assign({}, DEFAULTS.settings, S.settings || {});
  for (const k of ['items', 'cards', 'reviews']) if (!Array.isArray(S[k])) S[k] = [];
  if (!S.sessions) S.sessions = {}; if (!S.flags) S.flags = {};
}
let saveTimer = null;
function saveState() { clearTimeout(saveTimer); saveTimer = setTimeout(() => {
  if (Auth.session) { Auth.persist(); return; }
  try { Store.set(LS_KEY, JSON.stringify(S)); } catch (e) {}
}, 120); }
function freshState(seed) { S = JSON.parse(JSON.stringify(DEFAULTS)); if (seed) seedData(); }
function normalizeState(d) {
  S = d && typeof d === 'object' ? d : JSON.parse(JSON.stringify(DEFAULTS));
  S.settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULTS.settings)), S.settings || {});
  for (const k of ['items', 'cards', 'reviews']) if (!Array.isArray(S[k])) S[k] = [];
  if (!S.sessions) S.sessions = {}; if (!S.flags) S.flags = {};
  if (!Array.isArray(S.shelvesOrder)) S.shelvesOrder = [];
  return S;
}

/* ---------------- items ---------------- */
function makeItem(p) {
  return Object.assign({
    id: uid(), type: 'task', title: '', body: '', status: 'open',
    due: null, priority: 0, tags: [], shelf: 'inbox', pinned: false,
    source: null, pages: [], createdAt: Date.now(), completedAt: null, notified: false
  }, p);
}
const SHELF_ICONS = { inbox: '📥', lectures: '🎓', papers: '📄', personal: '🏡', books: '📚' };
function shelves() {
  const set = new Set(['inbox', ...S.shelvesOrder]);
  S.items.forEach(i => { if (i.shelf) set.add(i.shelf); });
  return [...set];
}
function itemById(id) { return S.items.find(i => i.id === id) || null; }

/* ---------------- smart parser ---------------- */
const WD_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function parseSmart(raw) {
  let text = ' ' + raw.trim() + ' ';
  const chips = []; const out = { title: '', due: null, priority: 0, tags: [], shelf: null, pinned: false };
  const eat = re => { const m = text.match(re); if (m) { text = text.replace(m[0], ' '); return m; } return null; };
  // priority
  let m = eat(/\s(!{1,3})\s/);
  if (m) { out.priority = m[1].length >= 2 ? 3 : (m[1].length === 1 ? 2 : 1); chips.push({ label: out.priority === 3 ? 'Urgent' : 'Important', type: 'prio' }); }
  // tags
  while ((m = eat(/\s#([\w-]+)\s/))) { out.tags.push(m[1]); chips.push({ label: '#' + m[1], type: 'tag' }); }
  // shelf
  if ((m = eat(/\s\/([\w-]+)\s/))) { out.shelf = m[1]; chips.push({ label: '/' + m[1], type: 'shelf' }); }
  if (eat(/\s\*\s/)) { out.pinned = true; chips.push({ label: 'Pinned', type: 'pin' }); }

  const now = new Date(); let base = null, time = null, timeSet = false;
  const setTime = h24 => { time = h24; timeSet = true; };
  const at = (h, mi) => h * HOUR + mi * MIN;

  if ((m = eat(/\s(tonight)\s/i))) { base = new Date(now); setTime(20.5 * 3600); }
  else if ((m = eat(/\s(today|tod)\s/i))) { base = new Date(now); }
  else if ((m = eat(/\s(tomorrow|tmrw?|tmoz)\s/i))) { base = new Date(now.getTime() + DAY); }
  else if ((m = eat(/\snext\s+week\s/i))) { base = new Date(now.getTime() + 7 * DAY); }
  else if ((m = eat(/\sin\s+(\d+)\s*(d|days?|w|weeks?|h|hours?|m|min(?:s)?|minutes?)\s/i))) {
    const n = +m[1], u = m[2].toLowerCase();
    const mult = u.startsWith('w') ? 7 * 24 : u.startsWith('d') ? 24 : 1;
    if (u.startsWith('h')) { out.due = now.getTime() + n * HOUR; }
    else if (u.startsWith('m')) { out.due = now.getTime() + n * MIN; }
    else { base = new Date(now.getTime() + n * mult * 24 * HOUR); }
    if (out.due) chips.push({ label: 'in ' + n + u, type: 'date' });
  }
  if (!base) {
    // weekday
    m = eat(/\s(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)\s/i);
    if (m) {
      const key = m[1].slice(0, 3).toLowerCase();
      let delta = (WD_MAP[key] - now.getDay() + 7) % 7; if (delta === 0) delta = 7;
      base = new Date(now.getTime() + delta * DAY);
    } else {
      // 12 oct / oct 12
      m = eat(/\s(\d{1,2})(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s/i) || eat(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(st|nd|rd|th)?\s/i);
      if (m) {
        const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf((m[1].match(/[a-z]/i) ? m[1] : m[3]).slice(0,3).toLowerCase());
        const day = +(m[1].match(/[a-z]/i) ? m[2] : m[1]);
        const d = new Date(now.getFullYear(), mon, day);
        if (d < new Date(now.getTime() - DAY)) d.setFullYear(d.getFullYear() + 1);
        base = d;
      }
    }
  }
  // time of day
  if ((m = eat(/\s(?:at\s+|@\s*)?(noon)\s/i))) { setTime(12 * 3600); }
  else if ((m = eat(/\s(?:at\s+|@\s*)?(midnight)\s/i))) { setTime(0); }
  else if ((m = eat(/\s(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i)) || (m = eat(/\s(?:at\s+|@\s*)?(\d{1,2}):(\d{2})\s/))) {
    let h = +m[1]; const mi = m[2] ? +m[2] : 0;
    const ap = m[3] ? m[3].toLowerCase() : null;
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (h < 24) setTime(h * 3600 + mi * 60);
  }
  else if (base && eat(/\s(morning)\s/i)) setTime(9 * 3600);
  else if (base && eat(/\s(afternoon)\s/i)) setTime(15 * 3600);
  else if (base && eat(/\s(evening|night)\s/i)) setTime(20 * 3600);

  if (base && timeSet) { base.setHours(Math.floor(time / 3600), Math.round((time % 3600) / 60), 0, 0); }
  else if (base) { base.setHours(9, 0, 0, 0); }
  if (base) { out.due = base.getTime(); chips.unshift({ label: fmtRel(out.due), type: 'date' }); }

  out.title = text.replace(/\s+/g, ' ').replace(/\s[-–—,;:]\s*$/, '').trim();
  if (out.shelf) out.shelf = out.shelf.toLowerCase();
  return out;
}

/* ---------------- FSRS-lite scheduler ---------------- */
function gradeCard(card, rating, now = Date.now()) {
  const c = Object.assign({}, card);
  c.reps = (c.reps || 0) + 1;
  c.ease = c.ease ?? 2.5;
  const fuzz = f => Math.max(1, Math.round(f * (0.95 + Math.random() * 0.1)));
  if (rating === 'again') {
    c.lapses = (c.lapses || 0) + 1;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.state = 'learning'; c.ivl = 0; c.due = now + 10 * MIN; c.inSession = true;
  } else if (c.state === 'new' || c.state === 'learning' || c.state === 'relearn') {
    if (rating === 'hard') c.ivl = 1;
    else if (rating === 'good') c.ivl = (c.state === 'new') ? 1 : 3;
    else { c.ivl = 4; c.ease = Math.min(3.2, c.ease + 0.15); }
    c.state = 'review'; c.ivl = Math.min(c.ivl, 365); c.due = now + c.ivl * DAY; c.inSession = false;
  } else {
    if (rating === 'hard') { c.ivl = Math.max(1, Math.round(c.ivl * 1.2)); c.ease = Math.max(1.3, c.ease - 0.15); }
    else if (rating === 'good') { c.ivl = fuzz(c.ivl * c.ease); }
    else { c.ivl = fuzz(c.ivl * c.ease * 1.35); c.ease = Math.min(3.2, c.ease + 0.15); }
    c.ivl = Math.min(c.ivl, 365); c.due = now + c.ivl * DAY; c.inSession = false;
  }
  c.lastReview = now;
  return c;
}
function ivlLabel(card, rating) {
  if (rating === 'again') return '10m';
  const c2 = gradeCard(card, rating, Date.now());
  return c2.ivl >= 1 ? c2.ivl + 'd' : '<1d';
}
const KIND_EST = { photo: 6, note: 10, snippet: 8 };
function dueCards(now = Date.now()) { return S.cards.filter(c => !c.suspended && c.state !== 'new' && (c.due || 0) <= now); }
function buildQueue(now = Date.now()) {
  const cap = clamp(+S.settings.doseCap || 20, 5, 50);
  const newCap = clamp(+S.settings.newCap ?? 5, 0, 10);
  const due = S.cards.filter(c => !c.suspended && c.state !== 'new' && (c.due || 0) <= now).sort((a, b) => (a.due || 0) - (b.due || 0));
  const fresh = S.cards.filter(c => !c.suspended && c.state === 'new').sort((a, b) => (a.created || 0) - (b.created || 0));
  const dueTake = due.slice(0, cap), newTake = fresh.slice(0, newCap);
  const queue = []; let di = 0, ni = 0;
  while (di < dueTake.length || ni < newTake.length) {
    for (let k = 0; k < 3 && di < dueTake.length; k++) queue.push(dueTake[di++]);
    if (ni < newTake.length) queue.push(newTake[ni++]);
  }
  const estSec = queue.reduce((s, c) => s + (KIND_EST[c.kind] || 8), 0);
  return { queue, estSec, dueTotal: due.length, newTotal: fresh.length };
}

/* ---------------- streaks ---------------- */
function computeStreak(now = Date.now()) {
  const todayK = dayKey(now);
  const done = new Set(Object.keys(S.sessions).filter(k => S.sessions[k] && S.sessions[k].completed));
  let streak = 0, graceUsed = false, d = todayK, lastGrace = S.lastGrace;
  if (!done.has(todayK)) d = keyOffset(todayK, -1);
  while (true) {
    if (done.has(d)) { streak++; d = keyOffset(d, -1); continue; }
    const gap = lastGrace ? daysBetween(lastGrace, d) : 999;
    if (!graceUsed && d !== todayK && gap >= 7) { graceUsed = true; lastGrace = d; streak++; d = keyOffset(d, -1); continue; }
    break;
  }
  return { streak, graceUsed };
}

/* ---------------- sentence splitting (for TTS) ---------------- */
function mdToPlain(md) {
  return String(md || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+\[([ xX])\]\s+/gm, (m, c) => c === ' ' ? 'To do: ' : 'Done: ')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1');
}
function splitSentences(md) {
  const plain = mdToPlain(md).replace(/\s+/g, ' ').trim();
  if (!plain) return [];
  const parts = plain.split(/(?<=[.!?…])\s+(?=["'(\[A-Z0-9])/g);
  const out = [];
  for (let p of parts) {
    p = p.trim(); if (!p) continue;
    while (p.length > 280) { let cut = p.lastIndexOf(' ', 280); if (cut < 80) cut = 280; out.push(p.slice(0, cut).trim()); p = p.slice(cut).trim(); }
    if (p) out.push(p);
  }
  const merged = [];
  for (const s of out) { if (s.length < 12 && merged.length) merged[merged.length - 1] += ' ' + s; else merged.push(s); }
  return merged;
}

/* ---------------- seed data (Day-0 never empty) ---------------- */
function svgUri(w, h, inner) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function seedPhotos() {
  const sunset = svgUri(800, 1000, `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1a3d"/><stop offset=".45" stop-color="#8a3b5e"/><stop offset=".75" stop-color="#e07856"/><stop offset="1" stop-color="#f2b263"/></linearGradient></defs>
    <rect width="800" height="1000" fill="url(#s)"/><circle cx="400" cy="640" r="110" fill="#ffd9a0"/><circle cx="400" cy="640" r="150" fill="#ffd9a0" opacity=".25"/>
    <rect y="760" width="800" height="240" fill="#1d1430"/><path d="M0 760 Q200 720 400 760 T800 760 V1000 H0 Z" fill="#160f26"/>
    <text x="400" y="920" text-anchor="middle" font-family="Georgia" font-size="34" fill="#f2b263" opacity=".85">goa · last winter</text>`);
  const hills = svgUri(800, 1000, `
    <defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8d0c9"/><stop offset="1" stop-color="#5f8d7f"/></linearGradient></defs>
    <rect width="800" height="1000" fill="url(#h)"/><circle cx="620" cy="180" r="70" fill="#fff7e0" opacity=".9"/>
    <path d="M0 640 L220 400 L420 640 Z" fill="#3f6b5e"/><path d="M260 700 L520 380 L800 700 Z" fill="#2f5348"/><rect y="690" width="800" height="310" fill="#24443b"/>
    <text x="400" y="920" text-anchor="middle" font-family="Georgia" font-size="34" fill="#dceee6" opacity=".9">the trek · dec 2025</text>`);
  const chai = svgUri(800, 1000, `
    <rect width="800" height="1000" fill="#e9dcc3"/><circle cx="180" cy="160" r="130" fill="#dfc9a2" opacity=".6"/>
    <path d="M280 380 h240 a30 30 0 0 1 30 30 v260 a60 60 0 0 1-60 60 h-180 a60 60 0 0 1-60-60 v-260 a30 30 0 0 1 30-30z" fill="#8c5a33"/>
    <path d="M550 430 q90 10 80 90 q-8 70 -85 60" fill="none" stroke="#8c5a33" stroke-width="26"/><ellipse cx="400" cy="390" rx="150" ry="26" fill="#c98f4e"/>
    <path d="M360 320 q14-40 0-78 M430 320 q14-40 0-78" stroke="#c9bda4" stroke-width="14" fill="none" stroke-linecap="round" opacity=".8"/>
    <text x="400" y="880" text-anchor="middle" font-family="Georgia" font-size="34" fill="#7a5c3c" opacity=".9">first chai · book café</text>`);
  const page = svgUri(900, 1200, `
    <rect width="900" height="1200" fill="#fbf6ea"/><rect width="900" height="1200" fill="none" stroke="#e4d9bf" stroke-width="8"/>
    <text x="80" y="140" font-family="Georgia" font-size="52" fill="#3c3428" font-style="italic">Endocrinology — Lec 4</text>
    <line x1="80" y1="175" x2="820" y2="175" stroke="#d9c9a5" stroke-width="3"/>
    ${[260, 330, 400, 470, 540, 610, 680, 750, 820, 890, 960, 1030].map((y, i) => {
      const widths = [720, 660, 740, 580, 700, 640, 720, 600, 680, 500, 710, 300];
      const seg = []; let x = 80; const w = widths[i];
      while (x < 80 + w - 40) { const len = 26 + Math.random() * 46; seg.push(`<path d="M${x} ${y} q ${len / 2} ${-9 - Math.random() * 10} ${len} 0" stroke="#4a4036" stroke-width="${2.2 + Math.random()}" fill="none" stroke-linecap="round" opacity=".88"/>`); x += len + 14; }
      return seg.join('');
    }).join('')}
    <text x="80" y="1120" font-family="Georgia" font-size="30" fill="#a3927a" font-style="italic">— scanned with Infallyn</text>`);
  return { sunset, hills, chai, page };
}
function seedData() {
  const P = seedPhotos(); const now = Date.now();
  const t = (o) => { const it = makeItem(Object.assign({ type: 'task' }, o)); S.items.push(it); return it; };
  const n = (o) => { const it = makeItem(Object.assign({ type: 'note' }, o)); S.items.push(it); return it; };
  const d = (o) => { const it = makeItem(Object.assign({ type: 'doc' }, o)); S.items.push(it); return it; };

  const t1 = t({ title: "Return 'Deep Work' to the campus bookshop", due: now + 3 * DAY, tags: ['books'], shelf: 'personal' });
  for (let k = 1; k <= 7; k++) { const dd = new Date(now + k * DAY); if (dd.getDay() === 5) { t1.due = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), 17, 0).getTime(); break; } }
  const endoNote = n({
    title: 'Lecture 4 — Endocrinology (transcribed)', source: 'ocr', shelf: 'lectures', tags: ['med'],
    body: "The pituitary gland is the conductor of the endocrine orchestra. The anterior pituitary releases six master hormones; ACTH travels to the adrenal cortex and asks for cortisol.\n\nCortisol follows a circadian rhythm: highest in the early morning, lowest around midnight. This is why morning blood draws are used for baseline testing.\n\nNegative feedback is the governing rule — the hormone product suppresses its own upstream signal. Loss of feedback is the seed of most endocrine disease.",
    pages: [P.page]
  });
  t({ title: 'Review endocrinology lecture notes', due: new Date(new Date().setHours(20, 0, 0, 0)).getTime() < now ? now + DAY : new Date(new Date().setHours(20, 0, 0, 0)).getTime(), priority: 3, tags: ['med'], shelf: 'lectures' });
  t({ title: 'Book train tickets for the Goa trip', due: now + 3 * DAY, tags: ['travel', 'goa'], shelf: 'personal' });
  t({ title: 'Pay the hostel mess bill', due: now - DAY, tags: [], shelf: 'personal' });
  n({
    title: 'The Feynman Technique', shelf: 'personal', tags: ['learning'],
    body: "The Feynman Technique is a four-step ritual for understanding anything.\n\nStep one: choose a concept and write its name at the top of a blank page.\n\nStep two: explain it as if teaching a twelve-year-old. Use plain words. Draw the mechanism.\n\nStep three: find the gaps. The places where you reach for jargon are the places you do not yet understand. Return to the source material for exactly those points.\n\nStep four: compress. Rewrite the explanation until it is simple, and then read it aloud — which is precisely what Infallyn's listening room is for."
  });
  n({
    title: 'Photosynthesis in one page', shelf: 'lectures', tags: ['bio'],
    body: "Photosynthesis converts light into chemical energy inside chloroplasts.\n\nThe light reactions split water, release oxygen, and charge two energy carriers: ATP and NADPH.\n\nThe Calvin cycle then uses that energy to fix carbon dioxide into sugar. RuBisCO, the most abundant protein on Earth, catalyses the first step.\n\nIn hot climates, some plants pre-concentrate CO2 — the C4 pathway — to avoid wasteful photorespiration."
  });
  d({ title: 'Reading list — cognitive science', shelf: 'papers', tags: ['reading'], body: "Papers to find and skim this month:\n\n1. Ebbinghaus — Memory: a contribution to experimental psychology (1885)\n2. Roediger & Karpicke — Test-enhanced learning (2006)\n3. Settles & Meeder — A trainable spaced repetition model (2016)\n4. Tabibian et al. — Enhancing human learning via spaced repetition optimization (2019)" });
  S.shelvesOrder = ['lectures', 'papers', 'personal'];

  const mk = (o) => S.cards.push(Object.assign({
    id: uid(), kind: 'photo', itemId: null, media: null, caption: '', back: '',
    state: 'new', ease: 2.5, ivl: 0, due: now, reps: 0, lapses: 0, created: now, suspended: false
  }, o));
  mk({ kind: 'photo', media: P.sunset, caption: 'Where was this sunset?', back: 'Goa — the December trip. We missed the train and caught a better one.' });
  mk({ kind: 'photo', media: P.hills, caption: 'Which trek is this?', back: 'Tirupati hills with Amma — started at 4am, reached the top by sunrise.' });
  mk({ kind: 'photo', media: P.chai, caption: 'The ritual from that rainy Tuesday?', back: 'First chai at the book café — the day Infallyn was just an idea.' });
  mk({ kind: 'note', itemId: endoNote.id, caption: endoNote.title, back: endoNote.body, due: now });
  mk({ kind: 'note', itemId: S.items[S.items.length - 1].id, caption: S.items[S.items.length - 1].title, back: S.items[S.items.length - 1].body, due: now + 2 * DAY });
  // seed a small streak history (sample)
  for (let k = 1; k <= 3; k++) S.sessions[keyOffset(dayKey(now), -k)] = { reviewed: 9 + k, completed: true };
}

/* ---------------- self tests ---------------- */
function runSelfTests() {
  const R = []; const T = (name, fn) => { try { const d = fn(); R.push({ name, pass: true, detail: d || '' }); } catch (e) { R.push({ name, pass: false, detail: e.message }); } };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  T('parser: relative day + time', () => {
    const p = parseSmart('Read chapter 4 tomorrow 9pm !!');
    assert(/Read chapter 4/.test(p.title), 'title=' + p.title);
    assert(p.priority === 3, 'prio=' + p.priority);
    const d = new Date(p.due); assert(d.getHours() === 21, 'hour=' + d.getHours());
    assert(daysBetween(dayKey(Date.now()), dayKey(p.due)) === 1, 'day');
    return JSON.stringify({ title: p.title, prio: p.priority });
  });
  T('parser: weekday + tags', () => {
    const p = parseSmart('Submit form fri #admin /home');
    assert(p.tags.includes('admin'), 'tags'); assert(p.shelf === 'home', 'shelf');
    const wd = new Date(p.due).getDay(); assert(wd === 5, 'wd=' + wd);
    return 'ok';
  });
  T('parser: in-hours', () => {
    const p = parseSmart('Call the plumber in 2 hours');
    assert(Math.abs(p.due - (Date.now() + 2 * 3600e3)) < 60000, 'due=' + p.due);
    return 'ok';
  });
  T('parser: plain title untouched', () => {
    const p = parseSmart('Water the plants');
    assert(p.title === 'Water the plants' && !p.due, p.title);
    return 'ok';
  });
  T('fsrs: new→good→1d, review→good grows', () => {
    const c = { state: 'new', ease: 2.5, ivl: 0, reps: 0, lapses: 0 };
    const g = gradeCard(c, 'good'); assert(g.state === 'review' && g.ivl === 1, JSON.stringify(g));
    const g2 = gradeCard(Object.assign({}, g, { due: 0 }), 'good'); assert(g2.ivl >= 2 && g2.ivl <= 4, 'ivl=' + g2.ivl);
    return 'ivl ' + g.ivl + '→' + g2.ivl;
  });
  T('fsrs: again lapses to learning 10m', () => {
    const c = { state: 'review', ease: 2.5, ivl: 10, reps: 3, lapses: 0 };
    const a = gradeCard(c, 'again'); assert(a.state === 'learning' && a.inSession === true, JSON.stringify(a.state));
    return 'ok';
  });
  T('queue: cap + interleave new', () => {
    const saved = JSON.stringify(S);
    S.cards = []; S.settings.doseCap = 10; S.settings.newCap = 2;
    for (let i = 0; i < 8; i++) S.cards.push({ id: 'd' + i, kind: 'photo', state: 'review', due: Date.now() - i * 1000, suspended: false });
    for (let i = 0; i < 5; i++) S.cards.push({ id: 'n' + i, kind: 'note', state: 'new', created: i, suspended: false });
    const q = buildQueue();
    assert(q.queue.length === 10, 'len=' + q.queue.length);
    assert(q.queue.filter(c => c.state === 'new').length === 2, 'news');
    S = JSON.parse(saved);
    return '10 taken, 2 new';
  });
  T('streak: grace night bridges one gap/week', () => {
    const saved = JSON.stringify(S);
    S.sessions = {}; S.lastGrace = null; const tk = dayKey(Date.now());
    S.sessions[keyOffset(tk, -1)] = { completed: true }; S.sessions[keyOffset(tk, -2)] = { completed: true };
    S.sessions[keyOffset(tk, -4)] = { completed: true }; // gap at -3
    const r = computeStreak();
    S = JSON.parse(saved);
    assert(r.streak === 4, 'streak=' + r.streak + ' grace=' + r.graceUsed);
    return 'streak 4 with 1 grace';
  });
  T('sentences: split & markdown strip', () => {
    const s = splitSentences('# Title\n\nOne short line. Another **bold** one! A question here?');
    assert(s.length === 3, 'len=' + s.length); assert(!s.join('').includes('#'), 'md leak');
    assert(s[2] === 'A question here?', 'last=' + s[2]);
    return s.length + ' sentences';
  });
  T('store: safe wrapper alive', () => { Store.set('__st', '1'); assert(Store.get('__st') === '1', 'roundtrip'); Store.del('__st'); return 'persistent=' + Store.persistent; });
  return R;
}
