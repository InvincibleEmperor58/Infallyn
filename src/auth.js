/* =====================================================================
   INFALLYN — AUTH: personal on-device accounts
   Passphrase → PBKDF2(150k) → AES-GCM key. Each account's entire space
   (state + photos) is encrypted at rest with its own key. The key exists
   only in memory while signed in; only a verifier is stored, never the
   passphrase. No server. Nothing leaves the browser.
   ===================================================================== */
const Auth = {
  session: null,            // { user, key, stay }
  ACC: 'infallyn.accounts.v1',
  VAULT_VERIFIER: 'infallyn-ok-v1',
  _saving: Promise.resolve(),

  /* ---------- account registry ---------- */
  accounts() { try { return JSON.parse(Store.get(this.ACC) || '{}'); } catch (e) { return {}; } },
  saveAccounts(a) { Store.set(this.ACC, JSON.stringify(a)); },
  exists(u) { return !!this.accounts()[u]; },
  hue(u) { let h = 0; for (const ch of String(u)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; },

  /* ---------- crypto ---------- */
  async deriveKey(pass, saltB64) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64.dec(saltB64), iterations: 150000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  },
  async encJSON(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64.enc(iv), ct: b64.enc(ct) };
  },
  async decJSON(key, pack) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(pack.iv) }, key, b64.dec(pack.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  },

  vaultKey(u) { return 'infallyn.vault.' + u; },
  autoKey(u) { return 'infallyn.autologin.' + u; },

  /* ---------- persistence (whole-state vault, serialized) ---------- */
  persist() {
    if (!this.session) return Promise.resolve();
    this._saving = this._saving.then(async () => {
      try { Store.set(this.vaultKey(this.session.user), JSON.stringify(await this.encJSON(this.session.key, S))); } catch (e) {}
    }).catch(() => {});
    return this._saving;
  },
  async persistNow() { clearTimeout(saveTimer); await this.persist(); await this._saving; },

  async loadVault(u, key) {
    let data = null;
    const raw = Store.get(this.vaultKey(u));
    if (raw) { try { data = await this.decJSON(key, JSON.parse(raw)); } catch (e) { data = null; } }
    if (data && typeof data === 'object' && data.items) {
      normalizeState(data);
    } else {
      freshState(true); // fresh account: welcome with the sample content
    }
  },

  /* ---------- account lifecycle ---------- */
  validName(u) { return /^[a-z0-9_.-]{2,20}$/i.test(u); },

  async createAccount(u, pass, opts = {}) {
    u = u.trim().toLowerCase();
    if (!this.validName(u)) throw 'Name: 2–20 letters, numbers, dots or dashes.';
    if (this.exists(u)) throw 'That name is taken on this device.';
    if (typeof pass !== 'string' || pass.length < 6) throw 'Passphrase needs at least 6 characters.';
    if (opts.pass2 != null && pass !== opts.pass2) throw 'Passphrases do not match.';
    const salt = b64.enc(crypto.getRandomValues(new Uint8Array(16)));
    const key = await this.deriveKey(pass, salt);
    const verifier = await this.encJSON(key, { v: this.VAULT_VERIFIER });
    const accs = this.accounts();
    accs[u] = { salt, verifier, hint: opts.hint || '', createdAt: Date.now(), hue: this.hue(u) };
    this.saveAccounts(accs);

    if (opts.adopt) {
      try {
        const legacy = JSON.parse(Store.get(LS_KEY) || 'null');
        if (legacy && Array.isArray(legacy.items)) {
          normalizeState(legacy);
          S.settings.autolock = S.settings.autolock || 0;
        } else freshState(true);
      } catch (e) { freshState(true); }
    } else {
      freshState(!!opts.seed);
    }
    this.session = { user: u, key, stay: false };
    Media.setContext(u, key);
    await Media.migrateLegacy();
    await this.persistNow();
    if (opts.adopt) Store.del(LS_KEY);
    if (opts.stay) await this.enableStay(u, key);
    Store.set('infallyn.lastuser', u);
    return u;
  },

  async unlock(u, pass) {
    u = String(u || '').trim().toLowerCase();
    const a = this.accounts()[u];
    if (!a) throw 'No account with that name on this device.';
    let key;
    try { key = await this.deriveKey(pass, a.salt); } catch (e) { throw 'Could not derive key — try again.'; }
    let ok = false;
    try { ok = (await this.decJSON(key, a.verifier)).v === this.VAULT_VERIFIER; } catch (e) { ok = false; }
    if (!ok) throw 'Wrong passphrase for ' + u + '.';
    this.session = { user: u, key, stay: !!Store.get(this.autoKey(u)) };
    Media.setContext(u, key);
    await Media.migrateLegacy();
    await this.loadVault(u, key);
    await this.persistNow();
    Store.set('infallyn.lastuser', u);
    return u;
  },

  /* ---------- stay signed in (device-wrapped key, opt-in) ---------- */
  deviceKey() {
    let dk = Store.get('infallyn.devicekey');
    if (!dk) { dk = b64.enc(crypto.getRandomValues(new Uint8Array(32))); Store.set('infallyn.devicekey', dk); }
    return dk;
  },
  async enableStay(u, key) {
    try {
      const raw = await crypto.subtle.exportKey('raw', key);
      const imp = await crypto.subtle.importKey('raw', b64.dec(this.deviceKey()), 'AES-GCM', false, ['encrypt', 'decrypt']);
      const pack = await this.encJSON(imp, { u, k: b64.enc(raw) });
      Store.set(this.autoKey(u), JSON.stringify(pack));
      this.session.stay = true;
    } catch (e) {}
  },
  disableStay(u) { Store.del(this.autoKey(u)); },
  async setStay(on) {
    if (!this.session) return;
    if (on) await this.enableStay(this.session.user, this.session.key);
    else { this.disableStay(this.session.user); this.session.stay = false; }
  },
  async tryAutoLogin() {
    const u = Store.get('infallyn.lastuser');
    const packRaw = u && Store.get(this.autoKey(u));
    if (!u || !packRaw || !this.accounts()[u]) return false;
    try {
      const imp = await crypto.subtle.importKey('raw', b64.dec(this.deviceKey()), 'AES-GCM', false, ['encrypt', 'decrypt']);
      const { k } = await this.decJSON(imp, JSON.parse(packRaw));
      const key = await crypto.subtle.importKey('raw', b64.dec(k), 'AES-GCM', true, ['encrypt', 'decrypt']);
      const a = this.accounts()[u];
      if ((await this.decJSON(key, a.verifier)).v !== this.VAULT_VERIFIER) return false;
      this.session = { user: u, key, stay: true };
      Media.setContext(u, key);
      await Media.migrateLegacy();
      await this.loadVault(u, key);
      return true;
    } catch (e) { return false; }
  },

  /* ---------- lock / sign out ---------- */
  async lock(signOut) {
    await this.persistNow();
    try { Player.stop(); } catch (e) {}
    if (this.session && signOut) this.disableStay(this.session.user);
    this.session = null;
    Media.setContext(null, null);
    qsa('.sheetwrap.on').forEach(s => s.classList.remove('on'));
    qs('#doseoverlay').classList.remove('on'); DZ.active = false;
    clearInterval(tickTimer);
    LK.show('login');
  },

  /* ---------- boot ---------- */
  async boot() {
    if (!(window.crypto && crypto.subtle)) {
      LK.show('login', 'This browser blocks WebCrypto — accounts need it to keep your data encrypted.');
      return;
    }
    LK.show('login');
    if (await this.tryAutoLogin()) LK.afterUnlock('auto');
  }
};
window.Auth = Auth;

/* =====================================================================
   LOCK SCREEN UI
   ===================================================================== */
const LK = {
  mode: 'login', sel: null, fails: 0, bound: false,
  show(mode, presetMsg) {
    this.mode = mode || 'login';
    this.render(presetMsg || '');
    qs('#lockscreen').classList.add('on');
  },
  render(msg) {
    const accs = this.accList();
    const legacy = !Object.keys(Auth.accounts()).length && !!Store.get(LS_KEY);
    const el = qs('#lk-body');
    if (this.mode === 'login') {
      el.innerHTML = `
        ${accs.length ? `<div class="lk-users">${accs.map(a =>
          `<button class="lk-user${this.sel === a.name ? ' sel' : ''}" data-u="${esc(a.name)}">
             <span class="lk-ava" style="background:hsl(${a.hue} 38% 42%)">${esc(a.name[0].toUpperCase())}</span>
             <span>${esc(a.name)}</span></button>`).join('')}
           <button class="lk-user lk-add" data-mode="create"><span class="lk-ava lk-ava-add">＋</span><span>New</span></button>
          </div>`
        : `<img class="lk-emblem" src="data:image/webp;base64,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" alt="Infallyn"><div class="lk-brand serif">Infallyn</div><p class="lk-tag">Your quiet room — kept personal, unlocked only by you.</p>`}
        <div class="field"><label for="lk-user">User name</label>
          <input class="input" id="lk-user" autocomplete="username" autocapitalize="none" value="${esc(this.sel || Store.get('infallyn.lastuser') || '')}" placeholder="e.g. Ibrahim"></div>
        <div class="field"><label for="lk-pass">Passphrase</label>
          <input class="input" id="lk-pass" type="password" autocomplete="current-password" placeholder="••••••••"></div>
        <div class="lk-msg${msg.startsWith('Wrong') || msg.startsWith('No') || msg.startsWith('Could') ? ' err' : ''}" id="lk-msg">${esc(msg)}</div>
        ${this.hintFor() ? `<div class="lk-hint" id="lk-hint">Hint: ${esc(this.hintFor())}</div>` : ''}
        <button class="btn btn-primary btn-block" id="lk-go">Open my Infallyn</button>
        <div class="lk-row">
          <button class="lk-link" id="lk-new">Create an account</button>
          ${accs.length ? '' : '<span class="lk-mini">First one here? Infallyn starts once you create an account.</span>'}
        </div>
        ${legacy ? '<button class="lk-link lk-claim" id="lk-claim">♻ Found your existing content — claim it with a passphrase</button>' : ''}
        <p class="lk-note">🔒 AES-256 encrypted on this device · your passphrase never leaves the browser · no server, no tracking</p>`;
      this.bindLogin();
    } else {
      el.innerHTML = `
        <img class="lk-emblem" src="data:image/webp;base64,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" alt="Infallyn">
        <div class="lk-brand serif">New shelf, new key</div>
        <p class="lk-tag">One account per person — each Infallyn space is sealed with its own passphrase.</p>
        <div class="field"><label for="lk-user">User name</label>
          <input class="input" id="lk-user" autocomplete="username" autocapitalize="none" placeholder="e.g. Ibrahim"></div>
        <div class="field"><label for="lk-pass">Passphrase (min 6 chars)</label>
          <input class="input" id="lk-pass" type="password" autocomplete="new-password" placeholder="••••••••"></div>
        <div class="field"><label for="lk-pass2">Repeat passphrase</label>
          <input class="input" id="lk-pass2" type="password" autocomplete="new-password" placeholder="••••••••"></div>
        <div class="field"><label for="lk-hint">Recovery hint <span style="text-transform:none;font-weight:500">(optional, stored in plain sight)</span></label>
          <input class="input" id="lk-hint" placeholder="the usual, but with the year"></div>
        <label class="togglerow"><div class="tr-main"><div class="tr-t">📚 Start with sample content</div><div class="tr-s">A few tasks, notes and memory cards to explore</div></div><span class="switch"><input type="checkbox" id="lk-seed" checked><span class="tr"></span></span></label>
        <label class="togglerow"><div class="tr-main"><div class="tr-t">🔓 Stay signed in on this device</div><div class="tr-s">Skip the lock screen next time (anyone using this browser could open your Infallyn)</div></div><span class="switch"><input type="checkbox" id="lk-stay"><span class="tr"></span></span></label>
        <div class="lk-msg${msg ? ' err' : ''}" id="lk-msg">${esc(msg)}</div>
        <button class="btn btn-primary btn-block" id="lk-create">Create my Infallyn</button>
        <div class="lk-row"><button class="lk-link" id="lk-back">← Back to sign in</button></div>`;
      this.bindCreate();
    }
    const focusEl = qs(this.mode === 'login' ? (this.sel ? '#lk-pass' : '#lk-user') : '#lk-user');
    // Focus, but never steal from a field the user is already typing in
    // (the unguarded 120ms timer used to yank focus into the passphrase mid-word).
    const focusIfFree = () => {
      if (!focusEl) return;
      const act = document.activeElement;
      if (!(act && act.tagName === 'INPUT' && act !== focusEl && qs('.lk-card').contains(act))) focusEl.focus();
    };
    focusIfFree();
    setTimeout(focusIfFree, 120);
  },
  accList() { return Object.entries(Auth.accounts()).map(([name, a]) => ({ name, hue: a.hue != null ? a.hue : Auth.hue(name) })); },
  hintFor() { const a = this.sel && Auth.accounts()[this.sel]; return this.fails > 0 && a && a.hint ? a.hint : ''; },
  bindLogin() {
    // track the typed name silently — a full re-render here would rebuild the
    // inputs mid-typing and throw focus into the passphrase field (the bug).
    qs('#lk-user').addEventListener('input', e => { this.sel = e.target.value.trim().toLowerCase(); });
    const submit = () => this.doUnlock();
    qs('#lk-go').onclick = submit;
    qs('#lk-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    qs('#lk-user').addEventListener('keydown', e => { if (e.key === 'Enter') qs('#lk-pass').focus(); });
    const nb = qs('#lk-new'); if (nb) nb.onclick = () => this.show('create');
    const cl = qs('#lk-claim'); if (cl) cl.onclick = () => { this.pendingClaim = true; this.show('create', 'Your current content will move into the new account.'); };
    qsa('.lk-user[data-u]').forEach(b => b.onclick = () => { this.sel = b.dataset.u; this.fails = 0; this.render(''); });
    const add = qs('.lk-add'); if (add) add.onclick = () => this.show('create');
  },
  bindCreate() {
    const submit = () => this.doCreate();
    qs('#lk-create').onclick = submit;
    qs('#lk-pass2').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    qs('#lk-back').onclick = () => { this.pendingClaim = false; this.show('login'); };
  },
  setBusy(on) { const b = qs('#lk-go') || qs('#lk-create'); if (b) { b.disabled = on; b.textContent = on ? 'Opening Infallyn…' : b.textContent; } },
  async doUnlock() {
    const u = qs('#lk-user').value.trim().toLowerCase(), p = qs('#lk-pass').value;
    this.setBusy(true);
    try { await Auth.unlock(u, p); this.fails = 0; this.afterUnlock('unlock'); }
    catch (e) { this.fails++; qs('#lk-pass').value = ''; this.render(String(e.message || e)); this.shake(); }
    this.setBusy(false);
  },
  async doCreate() {
    const u = qs('#lk-user').value, p = qs('#lk-pass').value, p2 = qs('#lk-pass2') ? qs('#lk-pass2').value : null;
    this.setBusy(true);
    try {
      await Auth.createAccount(u, p, { pass2: p2, hint: qs('#lk-hint') ? qs('#lk-hint').value.trim() : '', seed: qs('#lk-seed') ? qs('#lk-seed').checked : true, stay: qs('#lk-stay') ? qs('#lk-stay').checked : false, adopt: !!this.pendingClaim });
      this.pendingClaim = false; this.fails = 0;
      this.afterUnlock('new');
    } catch (e) { this.render(String(e.message || e)); this.shake(); }
    this.setBusy(false);
  },
  async afterUnlock(reason) {
    qs('#lockscreen').classList.remove('on');
    if (typeof startApp === 'function') startApp(reason);
    if (reason === 'unlock') toast('Welcome back, ' + Auth.session.user + '.');
    if (reason === 'auto') toast('Signed in as ' + Auth.session.user + '.');
  },
  shake() { const c = qs('.lk-card'); if (c) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } }
};
window.LK = LK;

/* auto-lock when the tab stays hidden */
let __hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) __hiddenAt = Date.now();
  else if (Auth.session && +S.settings.autolock > 0 && __hiddenAt && Date.now() - __hiddenAt > (+S.settings.autolock) * 60000) {
    Auth.lock(false);
  }
});
