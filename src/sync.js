/* =====================================================================
   INFALLYN — SYNC (optional, Supabase)
   End-to-end encrypted cross-device sync. The server only ever stores
   ciphertext: every entity and every photo is sealed with a random 32-byte
   space key that exists on your devices.

   Key model
   ---------
   spaceKey       random 32B, generated on the first device
   kdf_salt       random 16B, public (server)
   wrapKey        PBKDF2(syncPassphrase, kdf_salt, 150k) -> AES-256-GCM
   key_wrap       AES-GCM(spaceKey, wrapKey)                (server)
   local wrap     AES-GCM(spaceKey, vaultKey)               (this device only)

   A second device needs the same sync passphrase once; after that the space
   key is unwrapped with the local vault key on every unlock. Supabase Auth
   (email one-time code) supplies auth.uid(), which RLS uses to scope rows.

   Identity: email code -> JWT; RLS on owner = auth.uid().
   Conflicts: per-entity last-writer-wins on a monotonic ms clock; review
   rows are append-only by construction; deletes are tombstones.
   ===================================================================== */
const Sync = (() => {
  const K = {
    CFG: 'infallyn.sync.config.v1',
    SES: 'infallyn.sync.session.v1',
    LOCAL: 'infallyn.sync.spacekey.v1',
    META: 'infallyn.sync.meta.v1',
  };
  const MAX_MEDIA = 12 * 1024 * 1024;   // skip absurd blobs, keep the app snappy

  const S0 = {
    busy: false, lastError: '', lastSyncAt: 0, lastStats: null,
    sentEmail: '',
  };
  let spaceKey = null;                   // CryptoKey (AES-GCM) once unlocked
  let panelMsg = '';

  /* ---------------- tiny helpers ---------------- */
  const jget = (k) => { try { return JSON.parse(Store.get(k) || 'null'); } catch (e) { return null; } };
  const jset = (k, v) => Store.set(k, JSON.stringify(v));
  const uid = () => (Auth.session && Auth.accounts()[Auth.session.user] && Auth.session.user) || '';

  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }

  async function aes(raw) {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ iv: b64.enc(iv), ct: b64.enc(ct) });
  }
  async function unseal(key, str) {
    const p = JSON.parse(str);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(p.iv) }, key, b64.dec(p.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function sealBytes(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    return { iv: b64.enc(iv), bytes: ct };
  }
  async function unsealBytes(key, ivB64, bytes) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(ivB64) }, key, bytes));
  }
  async function wrapKeyFor(pass, saltB64) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64.dec(saltB64), iterations: 150000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* ---------------- config & session ---------------- */
  function config() { return jget(K.CFG) || { url: '', anonKey: '' }; }
  function configure(url, anonKey) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (clean && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(clean)) throw new Error('Project URL should look like https://xxxx.supabase.co');
    if (clean && !String(anonKey || '').trim()) throw new Error('Paste the anon public key too.');
    jset(K.CFG, { url: clean, anonKey: String(anonKey || '').trim() });
    panelMsg = clean ? 'Project saved.' : 'Sync turned off.';
    return true;
  }
  function session() { return jget(K.SES); }
  function saveSession(tok) { jset(K.SES, tok); }
  function clearSession() { Store.del(K.SES); }
  function signedIn() { const s = session(); return !!(s && s.access_token && s.uid); }

  /* ---------------- REST ---------------- */
  async function req(path, opts = {}) {
    const cfg = config();
    if (!cfg.url || !cfg.anonKey) throw new Error('Add your Supabase project first.');
    const tok = opts.auth === false ? null : await ensureAccessToken();
    const headers = Object.assign({
      apikey: cfg.anonKey,
      Authorization: 'Bearer ' + (tok || cfg.anonKey),
    }, opts.headers || {});
    if (opts.body && !(opts.body instanceof Uint8Array)) headers['Content-Type'] = 'application/json';
    const res = await fetch(cfg.url + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body instanceof Uint8Array ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined),
    });
    if (res.status === 401 && opts.retry !== false && opts.auth !== false) {
      await refreshSession(true);
      return req(path, Object.assign({}, opts, { retry: false }));
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) {}
      throw new Error('Supabase ' + res.status + (detail ? ' — ' + detail : ''));
    }
    const type = res.headers.get('content-type') || '';
    if (opts.raw) return res;
    return type.includes('json') ? res.json() : res.text();
  }

  async function ensureAccessToken() {
    const s = session();
    if (!s) return null;
    if (s.expires_at && Date.now() < s.expires_at - 30000) return s.access_token;
    try { await refreshSession(); } catch (e) { clearSession(); throw new Error('Session expired — sign in again.'); }
    return session().access_token;
  }

  async function refreshSession(force) {
    const s = session();
    if (!s || !s.refresh_token) throw new Error('No session');
    if (!force && s.expires_at && Date.now() < s.expires_at - 30000) return s;
    const cfg = config();
    const res = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    const j = await res.json();
    saveSession({
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      email: s.email, uid: (j.user && j.user.id) || s.uid,
    });
  }

  async function sendCode(email) {
    const cfg = config();
    if (!cfg.url) throw new Error('Add your Supabase project first.');
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That does not look like an email.');
    await req('/auth/v1/otp', { method: 'POST', auth: false, body: { email: e, create_user: true } });
    S0.sentEmail = e;
    panelMsg = 'Code sent to ' + e + '.';
    return e;
  }

  async function verifyCode(code) {
    const cfg = config();
    const email = S0.sentEmail || (jget(K.SES) || {}).email;
    const token = String(code || '').trim();
    if (!email) throw new Error('Send yourself a code first.');
    if (!/^\d{4,10}$/.test(token)) throw new Error('Enter the code from the email.');
    const res = await fetch(cfg.url + '/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', email, token }),
    });
    if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 160); } catch (e) {} throw new Error('Wrong or expired code' + (d ? ' — ' + d : '')); }
    const j = await res.json();
    if (!j || !j.access_token || !j.user || !j.user.id) throw new Error('Sign-in failed — send a new code and try again.');
    saveSession({
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      email, uid: j.user.id,
    });
    panelMsg = 'Signed in as ' + email + '.';
    return email;
  }

  /* ---------------- space key ---------------- */
  async function loadSpaces() {
    const rows = await req('/rest/v1/spaces?select=kdf_salt,key_wrap&limit=1');
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function setRawKey(b64str) {
    rawKeyB64 = b64str;
    spaceKey = await aes(b64.dec(b64str));
    if (Auth.session && Auth.session.key) {
      const pack = await Auth.encJSON(Auth.session.key, { k: rawKeyB64 });
      Store.set(K.LOCAL, JSON.stringify(pack));
    }
  }
  async function tryLocalKey() {
    if (!Auth.session || !Auth.session.key) return false;
    const s = Store.get(K.LOCAL);
    if (!s) return false;
    try {
      const o = await Auth.decJSON(Auth.session.key, JSON.parse(s));
      if (!o || !o.k) return false;
      await setRawKey(o.k);
      return true;
    } catch (e) { return false; }
  }

  async function enableWithPassphrase(pass) {
    if (!signedIn()) throw new Error('Sign in with your email first.');
    if (!pass || String(pass).length < 6) throw new Error('Sync passphrase needs at least 6 characters.');
    const row = await loadSpaces();
    if (row) {
      const wrap = await wrapKeyFor(pass, row.kdf_salt);
      let k;
      try { k = (await unseal(wrap, row.key_wrap.packed)).k; }
      catch (e) { throw new Error('That sync passphrase does not open this space.'); }
      await setRawKey(k);
      await adoptExistingSpace();
      panelMsg = 'This device is connected to your existing space.';
    } else {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const salt = b64.enc(crypto.getRandomValues(new Uint8Array(16)));
      const wrap = await wrapKeyFor(pass, salt);
      const packed = await seal(wrap, { k: b64.enc(raw) });
      await req('/rest/v1/spaces', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { owner: session().uid, kdf_salt: salt, key_wrap: { packed } },
      });
      await setRawKey(b64.enc(raw));
      panelMsg = 'Sync space created. Use this same passphrase on your other devices.';
    }
    return true;
  }

  /* A device that has never been touched holds only the sample content;
     when it joins an existing space it should adopt the server copy instead
     of pushing eight demo tasks into it. */
  function isSampleOnly() {
    if (!S.seededAt) return false;
    if ((S.reviews || []).length) return false;      // studied anything -> real use
    const t = S.seededAt;
    const old = (o) => !o.createdAt || o.createdAt <= t;
    return (S.items || []).every(old) && (S.cards || []).every(old);
  }

  async function adoptExistingSpace() {
    let rows;
    try { rows = await req('/rest/v1/entities?select=kind&limit=1'); } catch (e) { return false; }
    if (!rows || !rows.length) return false;         // empty space: keep samples, push them
    if (!isSampleOnly()) return false;               // real user content: normal merge
    S.items = []; S.cards = []; S.reviews = []; S.sessions = {};
    S.lastGrace = null; S.seededAt = 0;
    saveMeta({ entities: {}, media: {} });
    saveState();
    return true;
  }

  /* ---------------- entity projection ---------------- */
  function collect() {
    const m = new Map();
    for (const it of S.items) m.set('item|' + it.id, { kind: 'item', id: it.id, value: it });
    for (const c of S.cards) m.set('card|' + c.id, { kind: 'card', id: c.id, value: c });
    for (const r of S.reviews) m.set('review|' + r.cardId + ':' + r.at, { kind: 'review', id: r.cardId + ':' + r.at, value: r });
    for (const [k, v] of Object.entries(S.sessions || {})) m.set('session|' + k, { kind: 'session', id: k, value: v });
    m.set('settings|main', { kind: 'settings', id: 'main', value: S.settings });
    m.set('shelves|main', { kind: 'shelves', id: 'main', value: S.shelvesOrder });
    m.set('flags|main', { kind: 'flags', id: 'main', value: S.flags });
    m.set('meta|lastGrace', { kind: 'meta', id: 'lastGrace', value: S.lastGrace });
    return m;
  }

  function writeBack(map) {
    const items = [], cards = [], reviews = [];
    let settings = S.settings, shelves = S.shelvesOrder, flags = S.flags, lastGrace = S.lastGrace;
    for (const ent of map.values()) {
      if (ent.kind === 'item') items.push(ent.value);
      else if (ent.kind === 'card') cards.push(ent.value);
      else if (ent.kind === 'review') reviews.push(ent.value);
      else if (ent.kind === 'session') { S.sessions[ent.id] = ent.value; }
      else if (ent.kind === 'settings') settings = Object.assign({}, S.settings, ent.value);
      else if (ent.kind === 'shelves') shelves = ent.value;
      else if (ent.kind === 'flags') flags = ent.value;
      else if (ent.kind === 'meta' && ent.id === 'lastGrace') lastGrace = ent.value;
    }
    S.items = items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    S.cards = cards;
    S.reviews = reviews.sort((a, b) => (a.at || 0) - (b.at || 0));
    S.settings = settings; S.shelvesOrder = shelves; S.flags = flags; S.lastGrace = lastGrace;
    // drop sessions that were tombstoned
    for (const key of Object.keys(S.sessions)) {
      if (!map.has('session|' + key)) delete S.sessions[key];
    }
  }

  /* ---------------- merge ---------------- */
  async function pullAll() {
    const out = [];
    const page = 1000;
    for (let off = 0; ; off += page) {
      const rows = await req('/rest/v1/entities?select=kind,id,lww,deleted,payload&order=lww.asc&limit=' + page + '&offset=' + off);
      out.push(...(rows || []));
      if (!rows || rows.length < page) break;
    }
    return out;
  }

  async function applyRemote(rows, meta) {
    let pulled = 0, removed = 0;
    const map = collect();
    for (const row of rows) {
      const key = row.kind + '|' + row.id;
      const prev = meta.entities[key];
      const lww = +row.lww || 0;
      if (prev && lww <= prev.lww) continue;
      if (row.deleted) {
        if (map.delete(key)) removed++;
        meta.entities[key] = { lww, h: null, deleted: true };
        continue;
      }
      let value;
      try { value = await unseal(spaceKey, row.payload); }
      catch (e) { continue; }  // wrong key / corrupt row: leave it alone
      map.set(key, { kind: row.kind, id: row.id, value });
      meta.entities[key] = { lww, h: canonical(value), deleted: false };
      pulled++;
    }
    writeBack(map);
    return { pulled, removed };
  }

  async function pushChanged(meta) {
    const map = collect();
    const now = Date.now();
    const upserts = [];
    for (const [key, ent] of map) {
      const h = canonical(ent.value);
      const prev = meta.entities[key];
      if (prev && prev.h === h && !prev.deleted) continue;
      const lww = Math.max(now, (prev ? prev.lww : 0) + 1);
      upserts.push({ owner: session().uid, kind: ent.kind, id: ent.id, lww, deleted: false, payload: await seal(spaceKey, ent.value) });
      meta.entities[key] = { lww, h, deleted: false };
    }
    for (const [key, prev] of Object.entries(meta.entities)) {
      if (map.has(key) || prev.deleted) continue;
      const [kind, ...rest] = key.split('|');
      const lww = Math.max(now, (prev.lww || 0) + 1);
      upserts.push({ owner: session().uid, kind, id: rest.join('|'), lww, deleted: true, payload: '' });
      meta.entities[key] = { lww, h: null, deleted: true };
    }
    if (upserts.length) {
      await req('/rest/v1/entities?on_conflict=owner,kind,id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: upserts,
      });
    }
    return upserts.length;
  }

  /* ---------------- media ---------------- */
  function referencedMedia() {
    const ids = new Set();
    for (const it of S.items) for (const p of (it.pages || [])) if (typeof p === 'string' && !p.startsWith('data:')) ids.add(p);
    for (const c of S.cards) if (typeof c.media === 'string' && !c.media.startsWith('data:')) ids.add(c.media);
    return ids;
  }

  async function syncMedia(meta) {
    let up = 0, down = 0, skipped = 0;
    const remote = await req('/rest/v1/media?select=media_id,lww,deleted,mime,iv,bytes&limit=1000');
    const remoteById = new Map((remote || []).map(r => [r.media_id, r]));

    for (const id of referencedMedia()) {
      const r = remoteById.get(id);
      const prev = meta.media[id];
      if (prev && r && +r.lww <= prev.lww && !r.deleted) continue;   // already there
      if (prev && !r) continue;
      let dataUrl;
      try { dataUrl = await Media.get(id); } catch (e) { dataUrl = null; }
      if (!dataUrl || !dataUrl.startsWith('data:')) { skipped++; continue; }
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
      if (!m) { skipped++; continue; }
      const mime = m[1] || 'application/octet-stream';
      const bytes = b64.dec(m[3]);
      if (bytes.length > MAX_MEDIA) { skipped++; continue; }
      const { iv, bytes: ct } = await sealBytes(spaceKey, bytes);
      const path = session().uid + '/' + id;
      await req('/storage/v1/object/infallyn-media/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
        body: ct,
      });
      const lww = Date.now();
      await req('/rest/v1/media?on_conflict=owner,media_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { owner: session().uid, media_id: id, lww, deleted: false, mime, iv, bytes: bytes.length, storage_path: path },
      });
      meta.media[id] = { lww };
      up++;
    }

    for (const [id, r] of remoteById) {
      if (r.deleted) continue;
      const prev = meta.media[id];
      if (prev && +r.lww <= prev.lww) continue;
      let have = null;
      try { have = await Media.get(id); } catch (e) {}
      if (have && have.startsWith('data:')) { meta.media[id] = { lww: +r.lww }; continue; }
      try {
        const res = await req('/storage/v1/object/infallyn-media/' + r.storage_path, { raw: true });
        const buf = new Uint8Array(await res.arrayBuffer());
        const plain = await unsealBytes(spaceKey, r.iv, buf);
        await Media.put(id, 'data:' + (r.mime || 'application/octet-stream') + ';base64,' + b64.enc(plain.buffer));
        meta.media[id] = { lww: +r.lww };
        down++;
      } catch (e) { skipped++; }
    }
    return { up, down, skipped };
  }

  /* ---------------- orchestration ---------------- */
  function meta() {
    const m = jget(K.META);
    if (!m || !m.entities) return { entities: {}, media: {} };
    if (!m.media) m.media = {};
    return m;
  }
  function saveMeta(m) { jset(K.META, m); }

  function ready() { return signedIn() && !!spaceKey; }

  async function run(opts = {}) {
    if (S0.busy) return S0.lastStats;
    if (!signedIn()) {
      if (opts.manual) throw new Error('Sign in with your email first.');
      return null;
    }
    if (!spaceKey && !(await tryLocalKey())) {
      if (opts.manual) throw new Error('Add your sync passphrase on this device first.');
      return null;
    }
    S0.busy = true; S0.lastError = '';
    try {
      const m = meta();
      // Push first: a local edit made while offline gets its own timestamp
      // instead of being overwritten by an incoming row we had not seen yet.
      const pushed = await pushChanged(m);
      const rows = await pullAll();
      const pullRes = await applyRemote(rows, m);
      const mediaRes = await syncMedia(m);
      saveMeta(m);
      if (pullRes.pulled || pullRes.removed || pushed || mediaRes.up || mediaRes.down) {
        saveState();
        await Auth.persist();
      }
      S0.lastSyncAt = Date.now();
      S0.lastStats = { pulled: pullRes.pulled, removed: pullRes.removed, pushed, mediaUp: mediaRes.up, mediaDown: mediaRes.down, skipped: mediaRes.skipped };
      panelMsg = describe(S0.lastStats);
      return S0.lastStats;
    } catch (e) {
      S0.lastError = String(e.message || e);
      throw e;
    } finally {
      S0.busy = false;
      if (typeof renderYou === 'function' && UIState && UIState.tab === 'you') renderYou();
      renderWidgets && renderWidgets();
    }
  }

  function describe(s) {
    if (!s) return '';
    const bits = [];
    if (s.pulled) bits.push(s.pulled + ' in');
    if (s.pushed) bits.push(s.pushed + ' out');
    if (s.removed) bits.push(s.removed + ' removed');
    if (s.mediaUp) bits.push(s.mediaUp + ' photo' + (s.mediaUp > 1 ? 's' : '') + ' up');
    if (s.mediaDown) bits.push(s.mediaDown + ' photo' + (s.mediaDown > 1 ? 's' : '') + ' down');
    return bits.length ? 'Synced — ' + bits.join(', ') + '.' : 'Already up to date.';
  }

  function status() {
    return {
      configured: !!config().url,
      signedIn: signedIn(),
      email: (session() || {}).email || '',
      ready: ready(),
      busy: S0.busy,
      lastSyncAt: S0.lastSyncAt,
      lastError: S0.lastError,
      msg: panelMsg,
    };
  }

  function forget() {
    Store.del(K.LOCAL); Store.del(K.META); clearSession();
    spaceKey = null; rawKeyB64 = ''; S0.lastSyncAt = 0; S0.lastStats = null;
    panelMsg = 'Sync removed from this device. Your server copy is untouched.';
  }

  /* ---------------- UI ---------------- */
  function renderPanel() {
    const st = status();
    const cfg = config();
    const row = (title, sub, ctl) => `<div class="setrow"><div class="sr-main"><div class="sr-t">${title}</div><div class="sr-s">${sub}</div></div><div class="sr-ctl">${ctl}</div></div>`;
    const msg = S0.lastError ? `<div class="lk-msg err" style="text-align:left;margin:6px 2px">${esc(S0.lastError)}</div>`
      : (panelMsg ? `<div class="lk-msg" style="text-align:left;margin:6px 2px">${esc(panelMsg)}</div>` : '');
    const last = S0.lastSyncAt ? 'Last sync ' + fmtRel(S0.lastSyncAt).replace(/^\w/, c => c.toLowerCase()) : 'Not synced yet';

    let body = '';
    if (!st.configured) {
      body = `
        <div class="setrow" style="flex-direction:column;align-items:stretch">
          <div class="sr-t">Supabase project URL</div>
          <input class="input" id="sync-url" placeholder="https://xxxx.supabase.co" autocomplete="off" spellcheck="false" style="margin-top:8px">
          <div class="sr-t" style="margin-top:12px">Anon public key</div>
          <input class="input" id="sync-key" placeholder="eyJhbGciOi…" autocomplete="off" spellcheck="false" style="margin-top:8px">
          <button class="btn btn-primary btn-sm" id="sync-save" style="margin-top:12px;align-self:flex-start">Save project</button>
        </div>`;
    } else if (!st.signedIn) {
      body = `
        <div class="setrow" style="flex-direction:column;align-items:stretch">
          <div class="sr-t">Email</div>
          <input class="input" id="sync-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" style="margin-top:8px">
          <button class="btn btn-ghost btn-sm" id="sync-send" style="margin-top:10px;align-self:flex-start">Email me a code</button>
          <div class="sr-t" style="margin-top:14px">6-digit code</div>
          <input class="input" id="sync-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" style="margin-top:8px">
          <button class="btn btn-primary btn-sm" id="sync-verify" style="margin-top:10px;align-self:flex-start">Verify &amp; sign in</button>
          <button class="lk-link" id="sync-reset" style="margin-top:12px;text-align:left">Use a different project</button>
        </div>`;
    } else if (!st.ready) {
      body = `
        <div class="setrow" style="flex-direction:column;align-items:stretch">
          <div class="sr-s">Signed in as <b>${esc(st.email)}</b>. One more step: the sync passphrase seals your space key. Use the <b>same</b> passphrase on every device.</div>
          <input class="input" id="sync-pass" type="password" autocomplete="new-password" placeholder="Sync passphrase (min 6)" style="margin-top:10px">
          <button class="btn btn-primary btn-sm" id="sync-enable" style="margin-top:10px;align-self:flex-start">Connect this device</button>
        </div>`;
    } else {
      body = row('Status', last + ' · E2E encrypted', `<button class="btn btn-primary btn-sm" id="sync-now"${st.busy ? ' disabled' : ''}>${st.busy ? 'Syncing…' : 'Sync now'}</button>`)
        + row('This device', 'Signed in as ' + esc(st.email), `<button class="btn btn-ghost btn-sm" id="sync-forget">Disconnect</button>`);
    }

    return `<div class="sectionlabel">Sync — across your devices</div>
      <div class="panel settingsgroup">
        ${body}
        ${msg}
        <div class="sr-s" style="padding:6px 2px 0">End-to-end encrypted: the server stores ciphertext only. Passphrase and content never leave your devices in the clear.</div>
      </div>`;
  }

  function mount() {
    const on = (id, ev, fn) => { const el = qs('#' + id); if (el) el.addEventListener(ev, fn); };
    on('sync-save', 'click', () => {
      try { configure(qs('#sync-url').value, qs('#sync-key').value); S0.lastError = ''; renderYou(); toast('Project saved.'); }
      catch (e) { S0.lastError = e.message; renderYou(); }
    });
    on('sync-send', 'click', async () => {
      try { await sendCode(qs('#sync-email').value); S0.lastError = ''; }
      catch (e) { S0.lastError = e.message; }
      renderYou();
    });
    on('sync-verify', 'click', async () => {
      try { await verifyCode(qs('#sync-code').value); S0.lastError = ''; await run({ manual: false }); }
      catch (e) { S0.lastError = e.message; }
      renderYou();
    });
    on('sync-enable', 'click', async () => {
      try { await enableWithPassphrase(qs('#sync-pass').value); S0.lastError = ''; await run({ manual: false }); }
      catch (e) { S0.lastError = e.message; }
      renderYou();
    });
    on('sync-now', 'click', async () => {
      try { await run({ manual: true }); toast(describe(S0.lastStats)); }
      catch (e) { S0.lastError = e.message; renderYou(); }
    });
    on('sync-forget', 'click', () => {
      if (!confirm('Remove sync from this device? Your server copy stays; you can reconnect with the same passphrase.')) return;
      forget(); S0.lastError = ''; renderYou(); toast('Sync removed from this device.');
    });
    on('sync-reset', 'click', () => { if (confirm('Forget the Supabase project on this device?')) { configure('', ''); clearSession(); renderYou(); } });
  }

  /* auto-sync: after boot, when the tab regains focus, and every 2 minutes */
  let autoTimer = null;
  function startAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => { if (document.visibilityState !== 'hidden' && ready() && !S0.busy) run({}).catch(() => {}); }, 120000);
  }
  function bootAuto() {
    startAuto();
    setTimeout(() => { if (signedIn() && !S0.busy) run({}).catch(() => {}); }, 2500);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ready() && !S0.busy) run({}).catch(() => {});
  });

  return {
    config, configure, status, sendCode, verifyCode, enableWithPassphrase,
    run, forget, renderPanel, mount, bootAuto, ready, session, signedIn,
    _internals: { collect, canonical, seal, unseal, wrapKeyFor, applyRemote, pushChanged, meta, saveMeta },
  };
})();

/* UI entry points (inline onclick / console) */
L.syncSendCode = (email) => Sync.sendCode(email);
L.syncVerify = (code) => Sync.verifyCode(code);
L.syncEnable = (pass) => Sync.enableWithPassphrase(pass);
L.syncNow = () => Sync.run({ manual: true });
L.syncForget = () => Sync.forget();
L.syncStatus = () => Sync.status();
