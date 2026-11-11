/* =====================================================================
   INFALLYN — UI part 1: shell helpers • player (TTS) • OCR • capture
   scan flow • editors • memory-card editor • nightly dose session
   ===================================================================== */
const L = window.Infallyn = {};
const sheetOpen = id => qs('#' + id).classList.add('on');
const sheetClose = id => qs('#' + id).classList.remove('on');
const anySheetOpen = () => qsa('.sheetwrap.on').length > 0;
function closeTopSheet() { const s = qsa('.sheetwrap.on').pop(); if (s) { s.classList.remove('on'); return true; } return false; }

let toastN = 0;
function toast(msg, opts = {}) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = '<span>' + esc(msg) + '</span>';
  if (opts.action) { const b = document.createElement('button'); b.textContent = opts.action.label; b.onclick = () => { opts.action.fn(); t.remove(); }; t.appendChild(b); }
  qs('#toasts').appendChild(t); const id = ++toastN;
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, opts.ms || 3200);
}

/* ---------------- media helpers ---------------- */
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
function mediaImg(ref, cls, alt) {
  const id = 'im' + uid();
  Media.get(ref).then(u => { const el = document.getElementById(id); if (el && u) el.src = u; else if (el && !u) el.style.opacity = '.25'; });
  return `<img id="${id}" class="${cls || ''}" alt="${esc(alt || '')}" loading="lazy" src="${PLACEHOLDER}">`;
}
function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
async function downscale(dataUrl, max = 1280, q = 0.82) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const sc = Math.min(1, max / Math.max(img.width, img.height));
  if (sc >= 1 && dataUrl.length < 300000) return dataUrl;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

/* =====================================================================
   PLAYER — text-to-speech listening room
   ===================================================================== */
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const Player = {
  trackId: null, sents: [], si: 0, speaking: false, paused: false, sleepTimer: null,
  supported: ('speechSynthesis' in window),
  voices() { return this.supported ? speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('en')).concat(speechSynthesis.getVoices().filter(v => !(v.lang || '').toLowerCase().startsWith('en'))) : []; },
  voice() {
    const vs = this.voices(); if (!vs.length) return null;
    return vs.find(v => v.voiceURI === S.settings.voiceURI) || vs.find(v => /natural|neural|enhanced|premium/i.test(v.name)) || vs[0];
  },
  listenItems() { return S.items.filter(i => (i.type === 'note' || i.type === 'doc') && mdToPlain(i.body).trim().length > 0); },
  load(itemId, autoplay) {
    const it = itemById(itemId); if (!it) return;
    this.sents = splitSentences(it.body); this.si = 0; this.trackId = itemId;
    this.stop(); this.updateChrome();
    qs('#tr-title').textContent = it.title || 'Note';
    if (this.sents.length === 0) { toast('This note has no text to read yet.'); return; }
    renderTranscript();
    if (autoplay) this.speak(0);
  },
  speak(i) {
    if (!this.supported) { toast('Speech synthesis is not available in this browser.'); return; }
    if (!this.sents.length) return;
    this.si = clamp(i, 0, this.sents.length - 1);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(this.sents[this.si]);
    const v = this.voice(); if (v) u.voice = v;
    u.rate = +S.settings.rate || 1; u.pitch = 1;
    u.onend = () => {
      if (!this.speaking) return;
      if (this.si < this.sents.length - 1) this.speak(this.si + 1);
      else this.trackFinished();
    };
    u.onerror = () => { if (this.speaking) this.trackFinished(); };
    this.speaking = true; this.paused = false;
    speechSynthesis.speak(u);
    this.updateChrome(); markSentence(this.si);
  },
  playPause() {
    if (!this.trackId) { const first = this.listenItems()[0]; if (first) { this.load(first.id, true); } else { go('#/capture/note'); toast('Write a note first — then I will read it to you.'); } return; }
    if (!this.speaking) { this.speak(this.si); return; }
    if (this.paused) { speechSynthesis.resume(); this.paused = false; } else { speechSynthesis.pause(); this.paused = true; }
    this.updateChrome();
  },
  stop() { if (this.supported) speechSynthesis.cancel(); this.speaking = false; this.paused = false; this.updateChrome(); },
  nextS() { if (this.si < this.sents.length - 1) { if (this.speaking) this.speak(this.si + 1); else { this.si++; markSentence(this.si); this.updateChrome(); } } },
  prevS() { if (this.si > 0) { if (this.speaking) this.speak(this.si - 1); else { this.si--; markSentence(this.si); this.updateChrome(); } } },
  cycleRate() {
    const cur = +S.settings.rate || 1; const idx = RATES.indexOf(cur);
    S.settings.rate = RATES[(idx + 1) % RATES.length]; saveState();
    const sl = qs('#tr-rate'); if (sl) { sl.value = S.settings.rate; qs('#tr-rate-val').textContent = S.settings.rate + '×'; }
    if (this.speaking) this.speak(this.si); else this.updateChrome();
    toast('Speed ' + S.settings.rate + '×');
  },
  setRate(r) { S.settings.rate = r; saveState(); if (this.speaking) this.speak(this.si); else this.updateChrome(); },
  trackFinished() {
    this.speaking = false; this.paused = false; this.updateChrome();
    const list = this.listenItems(); const i = list.findIndex(x => x.id === this.trackId);
    if (i >= 0 && i < list.length - 1) {
      const nxt = list[i + 1];
      toast('Note finished — next: ' + (nxt.title || 'Untitled'), { action: { label: 'Play', fn: () => { this.load(nxt.id, true); go('#/listen'); } }, ms: 5000 });
    } else toast('Finished. The shelf is quiet now.');
  },
  sleep(min) {
    clearTimeout(this.sleepTimer);
    if (min > 0) { this.sleepTimer = setTimeout(() => { this.stop(); toast('Sleep timer — paused for the night.'); }, min * 60000); toast('Will stop after ' + min + ' min'); }
  },
  updateChrome() {
    const it = this.trackId ? itemById(this.trackId) : null;
    qs('#pb-title').textContent = it ? (it.title || 'Untitled') : 'Nothing playing';
    qs('#pb-sub').textContent = this.trackId ? (this.sents.length ? 'Sentence ' + (this.si + 1) + '/' + this.sents.length + ' · ' + S.settings.rate + '×' : '') : 'Pick a note to listen';
    qs('#np-title').textContent = it ? (it.title || 'Untitled') : 'Nothing playing';
    qs('#np-sub').textContent = this.trackId ? (this.speaking ? (this.paused ? 'Paused' : 'Playing') + ' · sentence ' + (this.si + 1) + '/' + this.sents.length : 'Paused at sentence ' + (this.si + 1)) : 'Pick a note to listen';
    const playIcons = { play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>', pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path x="6" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' };
    const ic = (this.speaking && !this.paused) ? playIcons.pause : playIcons.play;
    qs('#pb-play').innerHTML = ic; qs('#np-play').innerHTML = ic;
    qs('#playerbar').classList.toggle('on', !!this.trackId);
    qsa('.listenrow').forEach(r => r.classList.toggle('playing', r.dataset.id === this.trackId));
    const sl = qs('#tr-rate'); if (sl) sl.value = S.settings.rate;
    const sv = qs('#tr-rate-val'); if (sv) sv.textContent = S.settings.rate + '×';
  }
};
function markSentence(i) {
  qsa('#tr-sentences .sentence').forEach((el, k) => { el.classList.toggle('cur', k === i); if (k === i) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
}
function renderTranscript() {
  const it = Player.trackId ? itemById(Player.trackId) : null; if (!it) return;
  qs('#tr-sentences').innerHTML = Player.sents.map((s, k) => `<div class="sentence${k === Player.si ? ' cur' : ''}" onclick="Infallyn.seek(${k})">${esc(s)}</div>`).join('');
}
L.seek = k => { if (Player.speaking) Player.speak(k); else { Player.si = k; markSentence(k); Player.updateChrome(); } };
L.playPause = () => Player.playPause();
L.openTranscript = () => { if (!Player.trackId) { toast('Nothing playing yet.'); return; } renderTranscript(); sheetOpen('transcriptsheet'); fillVoiceSelect(); };

function fillVoiceSelect() {
  const sel = qs('#tr-voice'); if (!sel || !Player.supported) return;
  const vs = Player.voices();
  sel.innerHTML = vs.length ? vs.map(v => `<option value="${esc(v.voiceURI)}"${v.voiceURI === S.settings.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('') : '<option>System default</option>';
  sel.onchange = () => { S.settings.voiceURI = sel.value; saveState(); if (Player.speaking) Player.speak(Player.si); };
}

/* =====================================================================
   OCR — handwriting & print recognition (CDN engine, offline fallback)
   ===================================================================== */
const OCR = {
  readyP: null,
  load() {
    if (this.readyP) return this.readyP;
    this.readyP = new Promise((res, rej) => {
      if (window.Tesseract) return res();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('offline'));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('timeout')), 15000);
    });
    this.readyP.catch(() => { this.readyP = null; });
    return this.readyP;
  },
  async recognize(dataUrl, onProg) {
    await this.load();
    const r = await Tesseract.recognize(dataUrl, 'eng', { logger: m => { if (onProg && typeof m.progress === 'number') onProg(m.progress, m.status || ''); } });
    const words = r.data.words || [];
    const sus = [...new Set(words.filter(w => w.confidence < 70).map(w => w.text))].slice(0, 10);
    return { text: (r.data.text || '').replace(/\n{3,}/g, '\n\n').trim(), conf: Math.round(r.data.confidence || 0), sus };
  },
  availableOffline() { return !!window.Tesseract; }
};

/* =====================================================================
   CAPTURE SHEET — Task | Note | Scan
   ===================================================================== */
let captureSeg = 'task';
L.openCapture = seg => {
  captureSeg = seg || 'task';
  qsa('#capture-seg button').forEach(b => b.classList.toggle('active', b.dataset.seg === captureSeg));
  renderCaptureBody();
  sheetOpen('capturesheet');
  if (captureSeg === 'task') setTimeout(() => { const i = qs('#cap-task'); if (i) i.focus(); }, 250);
};
function renderCaptureBody() {
  const el = qs('#capture-body');
  if (captureSeg === 'task') {
    el.innerHTML = `
      <div class="field"><label for="cap-task">Task — try natural language</label>
        <input class="input" id="cap-task" placeholder="Read chapter 4 tomorrow 9pm !! #med-school /lectures" autocomplete="off"></div>
      <div class="parsedchips" id="cap-chips"></div>
      <p class="parsehint">Dates: today · tomorrow · fri · 12 oct · in 3 days — Times: 9pm · 08:30 · noon — <span class="kbd">!!</span> urgent · <span class="kbd">#tag</span> · <span class="kbd">/shelf</span> · <span class="kbd">*</span> pin</p>
      <div class="rowbtns"><button class="btn btn-ghost grow" onclick="Infallyn.closeCapture()">Cancel</button><button class="btn btn-primary grow" id="cap-task-save">Add task</button></div>`;
    const inp = qs('#cap-task');
    let deb; inp.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => {
      const p = parseSmart(inp.value);
      qs('#cap-chips').innerHTML = p.chips.map(c => `<span class="metachip">${esc(c.label)}</span>`).join('') + (p.title ? `<span class="metachip">${esc(p.title)}</span>` : '');
    }, 100); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveTaskCapture(); });
    qs('#cap-task-save').onclick = saveTaskCapture;
  } else if (captureSeg === 'note') {
    el.innerHTML = `
      <div class="field"><label for="cap-note-t">Title</label><input class="input" id="cap-note-t" placeholder="Photosynthesis — quick theory"></div>
      <div class="field"><label for="cap-note-b">Note</label><textarea class="textarea tall" id="cap-note-b" placeholder="Write, or paste anything. #heading, *bold*, - lists all work."></textarea></div>
      <div class="togglerow"><div class="tr-main"><div class="tr-t">🌙 Remember tonight</div><div class="tr-s">Adds a card to tonight's Daily Dose</div></div><label class="switch"><input type="checkbox" id="cap-dose" checked><span class="tr"></span></label></div>
      <div class="rowbtns"><button class="btn btn-ghost grow" onclick="Infallyn.closeCapture()">Cancel</button><button class="btn btn-primary grow" id="cap-note-save">Save note</button></div>`;
    qs('#cap-note-save').onclick = saveNoteCapture;
  } else {
    ScanF.render(el);
  }
}
function saveTaskCapture() {
  const raw = qs('#cap-task').value.trim(); if (!raw) { toast('Give the task a few words.'); return; }
  const p = parseSmart(raw);
  const it = makeItem({ type: 'task', title: p.title || raw, due: p.due, priority: p.priority, tags: p.tags, shelf: p.shelf || UIState.shelfFilter || 'inbox', pinned: p.pinned });
  S.items.unshift(it); saveState(); sheetClose('capturesheet');
  renderAll();
  toast(p.due ? 'Task added — ' + fmtRel(p.due) : 'Task added to ' + (it.shelf || 'inbox'));
}
function saveNoteCapture() {
  const title = qs('#cap-note-t').value.trim(), body = qs('#cap-note-b').value.trim();
  if (!title && !body) { toast('A few words, at least.'); return; }
  const wantDose = qs('#cap-dose').checked;
  const it = makeItem({ type: 'note', title: title || (mdToPlain(body).split(/[.\n]/)[0] || 'Untitled').slice(0, 60), body, shelf: UIState.shelfFilter || 'inbox' });
  S.items.unshift(it);
  if (wantDose && mdToPlain(body).trim()) S.cards.push({ id: uid(), kind: 'note', itemId: it.id, caption: it.title, back: body, state: 'new', ease: 2.5, ivl: 0, due: Date.now(), reps: 0, lapses: 0, created: Date.now(), suspended: false });
  saveState(); sheetClose('capturesheet'); renderAll();
  toast(wantDose ? 'Note saved — card due tonight' : 'Note saved');
}
L.closeCapture = () => { sheetClose('capturesheet'); ScanF.reset(); };
qsa && document.addEventListener('click', e => { if (e.target.id === 'capturesheet') { L.closeCapture(); } if (e.target.classList && e.target.classList.contains('sheetwrap')) e.target.classList.remove('on'); });

/* ---------------- Scan flow (OCR pipeline UI) ---------------- */
const ScanF = {
  pages: [], step: 'pick', cur: 0, targetItem: null, saving: false,
  reset() { this.pages = []; this.step = 'pick'; this.cur = 0; this.targetItem = null; this.saving = false; },
  render(el) {
    if (this.step === 'pick') {
      el.innerHTML = `
        <div class="dropzone" id="dz"><div class="dz-ico">📷</div><b>Scan handwritten pages</b>
          <p class="small mt8">Take photos or choose images. Text is recognized on your device where possible.</p></div>
        <div class="offlinebox" id="ocr-note">${OCR.availableOffline() ? '<b>OCR engine ready.</b> Recognition runs locally in your browser.' : '<b>OCR engine is offline in this preview.</b> You can still save pages and type the text by hand — or download this file and open it with internet access for full recognition.'}</div>
        <div class="rowbtns"><button class="btn btn-ghost grow" onclick="Infallyn.closeCapture()">Cancel</button><button class="btn btn-ghost grow" onclick="ScanF.pasteInstead()">Paste text instead</button></div>`;
      qs('#dz').onclick = () => pickFiles('scan');
    } else if (this.step === 'pages') {
      el.innerHTML = `
        <div class="pagerail" id="scan-rail">${this.pages.map((p, i) => pthumbHtml(p, i)).join('')}</div>
        <div class="row" style="margin:4px 0 12px"><button class="pillbtn" onclick="pickFiles('scan')">＋ Add pages</button>
          <span class="muted small">${this.pages.length} page${this.pages.length === 1 ? '' : 's'} · rotate/crop later in the gallery</span></div>
        <div class="rowbtns">
          <button class="btn btn-ghost grow" onclick="Infallyn.closeCapture()">Cancel</button>
          <button class="btn btn-ghost" onclick="ScanF.saveImagesOnly()">Save as images</button>
          <button class="btn btn-primary grow" id="scan-run" ${this.pages.length ? '' : 'disabled'}>Recognize text</button></div>`;
      qsa('#scan-rail .pthumb').forEach(t => t.onclick = () => { this.cur = +t.dataset.i; this.step = 'review'; this.render(el); });
      qs('#scan-run').onclick = () => this.runOCR(el);
    } else if (this.step === 'review') {
      const p = this.pages[this.cur] || this.pages[0];
      const badge = p.conf == null ? '' : (p.conf >= 85 ? 'hi' : p.conf >= 65 ? 'mid' : 'lo');
      el.innerHTML = `
        <div class="pagerail">${this.pages.map((pp, i) => pthumbHtml(pp, i)).join('')}</div>
        <div class="trustview">
          <div class="tv-img">${mediaImg(p.media, '', 'page ' + (this.cur + 1))}</div>
          <textarea id="trust-text" placeholder="Recognized text appears here — or type it.">${esc(p.text)}</textarea>
        </div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          ${p.conf != null ? `<span class="confbadge ${badge}">${p.conf}% confident</span>` : '<span class="muted small">Not recognized yet</span>'}
          ${p.sus && p.sus.length ? `<span class="muted small">Check:</span>${p.sus.map(w => `<span class="metachip">${esc(w)}</span>`).join('')}` : ''}
        </div>
        <div class="rowbtns" style="flex-wrap:wrap">
          <button class="btn btn-ghost" onclick="ScanF.backToPages()">Pages</button>
          <button class="btn btn-ghost" id="scan-rerun" ${p.status === 'busy' ? 'disabled' : ''}>${p.text ? 'Re-recognize' : 'Recognize'}</button>
          <button class="btn btn-primary grow" onclick="ScanF.toSave()">Next: save note →</button></div>`;
      qsa('.pagerail .pthumb', el).forEach(t => t.onclick = () => { this.cur = +t.dataset.i; this.render(el); });
      qs('#trust-text').addEventListener('input', e => { p.text = e.target.value; });
      qs('#scan-rerun').onclick = () => this.runOCR(el, this.cur);
    } else if (this.step === 'save') {
      const allText = this.pages.map(p => p.text).filter(Boolean).join('\n\n');
      el.innerHTML = `
        <div class="field"><label for="scan-title">Title</label><input class="input" id="scan-title" value="${esc(this.sugTitle || '')}" placeholder="Lecture 4 — Endocrinology"></div>
        <p class="muted small" style="margin:-4px 0 12px">${this.pages.length} page${this.pages.length === 1 ? '' : 's'} · ${mdToPlain(allText).split(/\s+/).filter(Boolean).length} words recognized · original images kept</p>
        <div class="togglerow"><div class="tr-main"><div class="tr-t">🌙 Remember tonight</div><div class="tr-s">Review this note in the Daily Dose</div></div><label class="switch"><input type="checkbox" id="scan-dose" checked><span class="tr"></span></label></div>
        <div class="togglerow"><div class="tr-main"><div class="tr-t">🎧 Ready to listen</div><div class="tr-s">Appears in the Listening room</div></div><label class="switch"><input type="checkbox" checked disabled><span class="tr"></span></label></div>
        <div class="rowbtns"><button class="btn btn-ghost" onclick="ScanF.backToReview()">← Text</button><button class="btn btn-primary grow" id="scan-save">Save to Infallyn</button></div>`;
      qs('#scan-save').onclick = () => this.saveNote();
    }
  },
  async addFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const dUrl = await downscale(await fileToDataUrl(f));
        const mediaId = 'm' + uid();
        await Media.put(mediaId, dUrl);
        this.pages.push({ id: mediaId, media: mediaId, text: '', conf: null, sus: [], status: 'ready' });
      } catch (e) { toast('Could not read that image.'); }
    }
    if (!this.pages.length) { toast('No images found.'); return; }
    this.step = this.pages.some(p => p.text) ? 'review' : 'pages';
    this.render(qs('#capture-body'));
  },
  async runOCR(el, onlyIdx) {
    const idxs = onlyIdx != null ? [onlyIdx] : this.pages.map((_, i) => i).filter(i => this.pages[i].status !== 'ok');
    let engineFailed = false;
    for (const i of idxs) {
      const p = this.pages[i]; p.status = 'busy'; this.render(el);
      try {
        const r = await OCR.recognize(p.mediaRes || p.media, pr => { p.prog = pr; });
        p.text = r.text; p.conf = r.conf; p.sus = r.sus; p.status = 'ok';
      } catch (e) { engineFailed = true; p.status = 'err'; }
      this.render(el);
    }
    if (engineFailed) {
      const el2 = qs('#capture-body');
      const box = document.createElement('div'); box.className = 'offlinebox';
      box.innerHTML = '<b>Could not reach the OCR engine (offline preview?).</b> Type or paste the text for each page below — the original photos stay attached either way.';
      el2.prepend(box);
      this.step = 'review'; this.cur = idxs.find(i => this.pages[i].status === 'err') ?? this.cur; this.render(el2);
    } else { this.step = 'review'; this.cur = idxs[0] ?? 0; this.render(el); }
  },
  pasteInstead() {
    this.pages = [{ id: 't' + uid(), media: null, text: '', conf: null, sus: [], status: 'ready', textOnly: true }];
    this.step = 'review'; this.render(qs('#capture-body'));
  },
  backToPages() { this.step = 'pages'; this.render(qs('#capture-body')); },
  backToReview() { this.step = 'review'; this.render(qs('#capture-body')); },
  toSave() {
    const texts = this.pages.map(p => p.text.trim());
    this.sugTitle = (texts.find(Boolean) || 'Scanned note').split('\n')[0].slice(0, 70);
    this.step = 'save'; this.render(qs('#capture-body'));
  },
  async saveNote() {
    if (this.saving) return; this.saving = true;
    const title = qs('#scan-title').value.trim() || 'Scanned note';
    const wantDose = qs('#scan-dose').checked;
    const body = this.pages.map(p => p.text.trim()).filter(Boolean).join('\n\n');
    const pageMedia = this.pages.filter(p => !p.textOnly).map(p => p.media);
    let it;
    if (this.targetItem) {
      it = itemById(this.targetItem);
      if (it) { it.pages = (it.pages || []).concat(pageMedia); if (body) it.body = (it.body ? it.body + '\n\n' : '') + body; }
    }
    if (!it) {
      it = makeItem({ type: 'note', title, body, source: 'ocr', shelf: UIState.shelfFilter || 'inbox', pages: pageMedia });
      S.items.unshift(it);
      if (wantDose && body) S.cards.push({ id: uid(), kind: 'note', itemId: it.id, caption: title, back: body, state: 'new', ease: 2.5, ivl: 0, due: Date.now(), reps: 0, lapses: 0, created: Date.now(), suspended: false });
    }
    saveState(); this.saving = false;
    L.closeCapture(); renderAll();
    toast(it && S.items.includes(it) ? 'Scanned note saved' + (wantDose ? ' — card due tonight' : '') : 'Pages added to note', { action: { label: 'Listen', fn: () => { Player.load(it.id, true); go('#/listen'); } } });
  }
};
function pthumbHtml(p, i) {
  const stat = p.status === 'busy' ? '<span class="pstat busy">reading…</span>' : p.status === 'ok' ? '<span class="pstat ok">' + (p.conf != null ? p.conf + '%' : 'done') + '</span>' : p.status === 'err' ? '<span class="pstat err">manual</span>' : '';
  return `<div class="pthumb${i === ScanF.cur ? ' active' : ''}" data-i="${i}">${p.media ? mediaImg(p.media, '', 'page') : '<div style="display:grid;place-items:center;height:100%">📝</div>'}${stat}</div>`;
}
ScanF.render && (window.ScanF = ScanF);
window.ScanF = ScanF;

let pickMode = 'scan';
function pickFiles(mode) {
  pickMode = mode;
  const inp = qs('#file-input');
  inp.accept = mode === 'json' ? '.json,application/json' : 'image/*';
  inp.multiple = mode === 'scan';
  inp.value = ''; inp.click();
}
qs('#file-input').addEventListener('change', async e => {
  const files = [...e.target.files]; if (!files.length) return;
  if (pickMode === 'scan') await ScanF.addFiles(files);
  else if (pickMode === 'memory') L.openMemoryEditor(files[0]);
  else if (pickMode === 'json') importDataFile(files[0]);
});
window.pickFiles = pickFiles;

/* =====================================================================
   EDITORS
   ===================================================================== */
L.openEditor = id => {
  const it = itemById(id); if (!it) return;
  const el = qs('#editor-body');
  const shelfOpts = shelves().map(s => `<option value="${esc(s)}"${it.shelf === s ? ' selected' : ''}>${esc(s)}</option>`).join('');
  if (it.type === 'task') {
    const d = it.due ? new Date(it.due - new Date().getTimezoneOffset() * MIN) : null;
    el.innerHTML = `
      <h2>Edit task</h2>
      <div class="field"><label>Title</label><input class="input" id="ed-title" value="${esc(it.title)}"></div>
      <div class="field"><label>Due</label><input type="datetime-local" class="input" id="ed-due" value="${d ? d.toISOString().slice(0, 16) : ''}"></div>
      <div class="row"><div class="field grow"><label>Priority</label><select class="input" id="ed-prio">
        <option value="0"${it.priority === 0 ? ' selected' : ''}>Normal</option><option value="2"${it.priority === 2 ? ' selected' : ''}>Important</option><option value="3"${it.priority === 3 ? ' selected' : ''}>Urgent</option></select></div>
      <div class="field grow"><label>Shelf</label><select class="input" id="ed-shelf">${shelfOpts}</select></div></div>
      <div class="field"><label>Tags (comma separated)</label><input class="input" id="ed-tags" value="${esc(it.tags.join(', '))}"></div>
      <div class="togglerow"><div class="tr-main"><div class="tr-t">📌 Pinned</div><div class="tr-s">Keep at the top of Today</div></div><label class="switch"><input type="checkbox" id="ed-pin"${it.pinned ? ' checked' : ''}><span class="tr"></span></label></div>
      <div class="rowbtns"><button class="btn btn-danger" onclick="Infallyn.deleteItem('${it.id}')">Delete</button><button class="btn btn-ghost grow" onclick="Infallyn.closeEditor()">Cancel</button><button class="btn btn-primary grow" onclick="Infallyn.saveEditor('${it.id}')">Save</button></div>`;
  } else {
    const hasCard = S.cards.some(c => c.itemId === it.id && !c.suspended);
    el.innerHTML = `
      <h2>Edit ${it.type === 'doc' ? 'document' : 'note'}</h2>
      <div class="field"><label>Title</label><input class="input" id="ed-title" value="${esc(it.title)}"></div>
      ${it.pages && it.pages.length ? `<div class="field"><label>Pages</label><div class="pagerail">${it.pages.map(p => `<div class="pthumb">${mediaImg(p, '', 'page')}</div>`).join('')}</div></div>` : ''}
      <div class="field"><label>Text ${it.source === 'ocr' ? '<span class="muted small">(recognized from handwriting — edit freely)</span>' : ''}</label><textarea class="textarea tall" id="ed-body">${esc(it.body)}</textarea></div>
      <div class="togglerow"><div class="tr-main"><div class="tr-t">🌙 Remember tonight</div><div class="tr-s">${hasCard ? 'Already in the Dose — you can suspend it there' : "Add a card to tonight's Daily Dose"}</div></div><label class="switch"><input type="checkbox" id="ed-dose"${hasCard ? ' checked disabled' : ''}><span class="tr"></span></label></div>
      <div class="row"><div class="field grow"><label>Shelf</label><select class="input" id="ed-shelf">${shelfOpts}</select></div></div>
      <div class="rowbtns" style="flex-wrap:wrap">
        <button class="btn btn-danger" onclick="Infallyn.deleteItem('${it.id}')">Delete</button>
        <button class="btn btn-ghost" onclick="Infallyn.addPages('${it.id}')">＋ Scan</button>
        <button class="btn btn-ghost" onclick="Infallyn.listenNow('${it.id}')">🎧 Listen</button>
        <button class="btn btn-primary grow" onclick="Infallyn.saveEditor('${it.id}')">Save</button></div>`;
  }
  sheetOpen('editorsheet');
};
L.closeEditor = () => sheetClose('editorsheet');
L.saveEditor = id => {
  const it = itemById(id); if (!it) return;
  it.title = qs('#ed-title').value.trim() || it.title;
  if (it.type === 'task') {
    const dv = qs('#ed-due').value;
    it.due = dv ? new Date(dv).getTime() : null;
    it.notified = false;
    it.priority = +qs('#ed-prio').value;
    it.pinned = qs('#ed-pin').checked;
  } else {
    it.body = qs('#ed-body').value;
    if (qs('#ed-dose') && qs('#ed-dose').checked && !qs('#ed-dose').disabled) {
      S.cards.push({ id: uid(), kind: 'note', itemId: it.id, caption: it.title, back: it.body, state: 'new', ease: 2.5, ivl: 0, due: Date.now(), reps: 0, lapses: 0, created: Date.now(), suspended: false });
    }
  }
  it.shelf = qs('#ed-shelf') ? qs('#ed-shelf').value : it.shelf;
  if (qs('#ed-tags')) it.tags = qs('#ed-tags').value.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
  saveState(); L.closeEditor(); renderAll(); toast('Saved');
};
L.deleteItem = id => {
  const idx = S.items.findIndex(i => i.id === id); if (idx < 0) return;
  const [it] = S.items.splice(idx, 1);
  const orphanCards = S.cards.filter(c => c.itemId === id);
  saveState(); L.closeEditor(); closeTopSheet(); renderAll();
  toast('Deleted “' + (it.title || 'item') + '”', { action: { label: 'Undo', fn: () => { S.items.splice(idx, 0, it); saveState(); renderAll(); } }, ms: 5000 });
};
L.listenNow = id => { Player.load(id, true); L.closeEditor(); go('#/listen'); };
L.addPages = id => { ScanF.reset(); ScanF.targetItem = id; L.closeEditor(); L.openCapture('scan'); };

/* ---------------- memory card editor (photo → dose card) ---------------- */
L.openMemoryEditor = async fileOrUrl => {
  let dataUrl = fileOrUrl;
  if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) dataUrl = await downscale(await fileToDataUrl(fileOrUrl));
  const mediaId = 'm' + uid(); await Media.put(mediaId, dataUrl);
  const el = qs('#editor-body');
  el.innerHTML = `
    <h2>New memory card</h2>
    <div class="field" style="text-align:center">${mediaImg(mediaId, '', 'memory', ) .replace('<img ', '<img style="max-height:38dvh;border-radius:16px;margin:0 auto" ')}</div>
    <div class="field"><label>Question / caption (front)</label><input class="input" id="mem-cap" placeholder="Where was this?"></div>
    <div class="field"><label>Answer / story (back)</label><textarea class="textarea" id="mem-back" placeholder="The story behind this moment…"></textarea></div>
    <div class="rowbtns"><button class="btn btn-ghost grow" onclick="Infallyn.closeEditor()">Cancel</button><button class="btn btn-primary grow" onclick="Infallyn.saveMemory('${mediaId}')">Add to tonight's Dose</button></div>`;
  sheetOpen('editorsheet');
  qs('#mem-cap').focus();
};
L.saveMemory = mediaId => {
  const cap = qs('#mem-cap').value.trim(), back = qs('#mem-back').value.trim();
  S.cards.push({ id: uid(), kind: 'photo', itemId: null, media: mediaId, caption: cap || 'A moment to keep', back, state: 'new', ease: 2.5, ivl: 0, due: Date.now(), reps: 0, lapses: 0, created: Date.now(), suspended: false });
  saveState(); L.closeEditor(); renderAll(); toast('Memory added to tonight\'s Dose');
};

/* =====================================================================
   NIGHTLY DOSE — session overlay
   ===================================================================== */
const DZ = { q: [], idx: 0, reviewed: 0, againCount: 0, active: false, revealed: false, requeued: new Set() };
L.startDose = () => {
  const { queue } = buildQueue();
  if (!queue.length) { toast('Nothing is due — the shelf rests tonight.'); return; }
  DZ.q = queue.map(c => ({ card: c })); DZ.idx = 0; DZ.reviewed = 0; DZ.againCount = 0; DZ.active = true; DZ.requeued.clear();
  qs('#doseoverlay').classList.add('on');
  qs('#dose-done').style.display = 'none'; qs('#dosecard-area').style.display = 'flex';
  renderDoseCard();
};
function renderDoseCard() {
  const cur = DZ.q[DZ.idx];
  if (!cur) { finishDose(); return; }
  DZ.revealed = false;
  const c = cur.card;
  qs('#dz-count').textContent = (DZ.idx + 1) + '/' + DZ.q.length;
  qs('#dz-progress').style.width = (DZ.idx / DZ.q.length * 100) + '%';
  qs('#gradebar').classList.remove('revealed');
  const card = qs('#dosecard');
  card.style.transform = ''; card.style.opacity = '1';
  if (c.kind === 'photo') {
    card.innerHTML = `<span class="dc-kind">Memory</span>
      <div class="dc-media">${mediaImg(c.media, '', 'memory card')}</div>
      <div class="dc-caption"><div>${esc(c.caption || 'What do you remember?')}</div><div class="cap-hint">Recall it, then tap to reveal</div></div>`;
  } else {
    const plain = mdToPlain(c.back || '');
    const peek = plain.split(/(?<=[.!?])\s/).slice(0, 2).join(' ');
    card.innerHTML = `<span class="dc-kind">Note card</span>
      <div class="dc-front"><div class="dc-title">${esc(c.caption || 'Untitled note')}</div><div class="dc-peek">${esc(peek)}</div><div class="cap-hint" style="color:#A79B8A;font-size:12.5px;font-weight:600">Tap to flip</div></div>`;
  }
  ['again', 'hard', 'good', 'easy'].forEach(r => { qs('#gp-' + r).textContent = ivlLabel(c, r); });
  try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
}
L.flipCard = () => {
  if (!DZ.active || DZ.revealed) return;
  const c = DZ.q[DZ.idx].card; DZ.revealed = true;
  const card = qs('#dosecard');
  if (c.kind === 'photo') {
    qs('.dc-caption', card).innerHTML = `<div>${esc(c.caption || '')}</div>${c.back ? `<div style="margin-top:8px;color:#A79B8A;line-height:1.5">${esc(c.back)}</div>` : ''}`;
  } else {
    card.innerHTML = `<span class="dc-kind">Note card</span><div class="dc-back">${esc(mdToPlain(c.back || ''))}</div>`;
  }
  qs('#gradebar').classList.add('revealed');
};
L.doseGrade = rating => {
  if (!DZ.active || !DZ.revealed) { L.flipCard(); return; }
  const { card } = DZ.q[DZ.idx];
  const graded = gradeCard(card, rating);
  const i = S.cards.findIndex(x => x.id === card.id); if (i >= 0) S.cards[i] = graded;
  S.reviews.push({ cardId: card.id, rating, at: Date.now(), ivl: graded.ivl });
  DZ.reviewed++; if (rating === 'again') DZ.againCount++;
  try { navigator.vibrate(rating === 'again' ? [14, 40, 14] : 12); } catch (e) {}
  const el = qs('#dosecard'); el.classList.add('leaving');
  const dir = rating === 'again' ? '-120%' : rating === 'hard' ? '0%,60%' : rating === 'easy' ? '0%,-60%' : '120%,0%';
  el.style.transform = 'translate(' + dir + ')'; el.style.opacity = '0';
  if (rating === 'again' && !DZ.requeued.has(card.id)) { DZ.requeued.add(card.id); DZ.q.push({ card: { ...graded, state: 'relearn' } }); }
  saveState();
  setTimeout(() => { el.classList.remove('leaving'); DZ.idx++; renderDoseCard(); }, 240);
};
function finishDose() {
  DZ.active = false;
  const dk = dayKey(Date.now());
  S.sessions[dk] = { reviewed: (S.sessions[dk] ? S.sessions[dk].reviewed : 0) + DZ.reviewed, completed: true };
  const { streak } = computeStreak();
  saveState();
  qs('#dosecard-area').style.display = 'none'; qs('#dose-done').style.display = 'flex';
  const recall = DZ.reviewed ? Math.round((DZ.reviewed - DZ.againCount) / DZ.reviewed * 100) : 100;
  qs('#dd-pct').textContent = recall + '%';
  setTimeout(() => { qs('#dd-ring').style.strokeDashoffset = 289 * (1 - recall / 100); }, 60);
  qs('#dd-reviewed').textContent = DZ.reviewed;
  qs('#dd-recall').textContent = recall + '%';
  qs('#dd-streak').textContent = streak;
  qs('#dd-title').textContent = streak >= 7 ? 'Shelf closed — a full week of nights.' : 'Shelf closed.';
  qs('#dd-sub').textContent = 'Same time tomorrow — Infallyn will have your next dose ready.';
  renderAll();
}
L.closeDose = () => { qs('#doseoverlay').classList.remove('on'); DZ.active = false; renderAll(); };
qs('#dz-close').onclick = L.closeDose;
qs('#dd-close').onclick = L.closeDose;
qsa('#gradebar .grade').forEach(b => b.onclick = () => L.doseGrade(b.dataset.g));
qs('#dosecard').addEventListener('click', () => L.flipCard());

/* swipe grading */
(() => {
  const card = qs('#dosecard'); let sx = 0, sy = 0, drag = false;
  card.addEventListener('pointerdown', e => { if (!DZ.active) return; sx = e.clientX; sy = e.clientY; drag = true; card.setPointerCapture(e.pointerId); });
  card.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!DZ.revealed && Math.abs(dx) + Math.abs(dy) > 30) { L.flipCard(); }
    card.style.transition = 'none';
    card.style.transform = `translate(${dx * .6}px,${dy * .6}px) rotate(${dx * .03}deg)`;
  });
  card.addEventListener('pointerup', e => {
    if (!drag) return; drag = false; card.style.transition = '';
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!DZ.revealed) { card.style.transform = ''; return; }
    if (dx > 90) L.doseGrade('good');
    else if (dx < -90) L.doseGrade('again');
    else if (dy < -90) L.doseGrade('easy');
    else if (dy > 90) L.doseGrade('hard');
    else card.style.transform = '';
  });
})();
