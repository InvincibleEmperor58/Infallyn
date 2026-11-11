<p align="center"><img src="assets/emblem.png" alt="Infallyn emblem" width="140"></p>

# Infallyn

> **Your quiet room for study & memory.** A private, offline-first study platform in a
> **single HTML file** — tasks & documents, a nightly spaced-repetition *Daily Dose*,
> handwriting **OCR → audio**, glanceable widgets, and **passphrase-encrypted personal
> accounts**. No frameworks. No build step to run it. No server. No tracking.

---

## ✨ Features

| Pillar | What you get |
|---|---|
| 🗄 **Shelf** | Tasks, notes & documents · smart capture with natural-language parsing (`read ch4 tomorrow 9pm !! #tag /shelf`) · Today / Inbox / Upcoming / Anytime · shelves, tags, pins · reminders · full-text search |
| 🌙 **Daily Dose** | Photo & note memory cards · FSRS-style scheduling (Again / Hard / Good / Easy, interval previews) · swipe or keyboard grading · nightly trigger + gentle re-nudge · streaks with grace nights · 13-week heatmap & forecast |
| ✍→🎧 **OCR → Audio** | Multi-page scanning · handwriting/print recognition (Tesseract.js) · trust screen with confidence highlighting · text-to-speech listening room with sentence karaoke, tap-to-seek, 0.75×–3× speed, sleep timer |
| 📱 **Smart access** | Dose-ring / Next-Up / Now-Playing widgets · deep links · light **Reading Room** & warm-dark **Night Shelf** themes · full JSON export/import |
| 🔐 **Accounts** | One lock screen per person · passphrase → PBKDF2 → AES-256-GCM · every note *and photo* encrypted at rest · stay-signed-in · auto-lock · per-account isolation |

## 🚀 Run it

**Option A — just open it**

```
index.html          ← double-click. That's the whole app.
```

**Option B — local server**

```bash
python3 server.py   # → http://localhost:8000
```

**Option C — GitHub Pages (recommended for daily use)**

1. Repo **Settings → Pages → Deploy from branch** → `main` / root → Save.
2. Open `https://<you>.github.io/<repo>/` — done. The manifest + icons make it
   installable ("Add to Home Screen") on phones.

> OCR loads Tesseract.js from a CDN at runtime; everything else works fully offline.
> When offline, scanning falls back to manual text entry (originals are always kept).

## 🔐 Privacy model

- Your passphrase is run through **PBKDF2 (150k iterations)** to derive an
  **AES-256-GCM** key. The entire state JSON **and every image** is encrypted with it
  before touching storage. Only a cryptographic verifier is stored — never the passphrase.
  No passphrase = no decryption. There is no reset. That is the design.
- `localStorage`: `infallyn.accounts.v1`, `infallyn.vault.<user>`, `infallyn.autologin.<user>`,
  `infallyn.lastuser`, `infallyn.devicekey`
- `IndexedDB` `infallyn-media`: per-user namespace `u/<user>/<mediaId>`, each value an
  `{"iv":…,"ct":…}` envelope
- Multiple accounts on one device are fully isolated. Nothing ever leaves the browser.

## 🗂 Repository layout

```
├── index.html               ★ the entire app — one self-contained file (emblem baked in)
├── manifest.webmanifest     installability (icons, theme color, standalone display)
├── server.py                tiny static server for local dev
├── assets/                  app icons (192/512/maskable) + README emblem
├── src/                     editable source modules + build tool
│   ├── head.html            <head>, meta, embedded icons, manifest link
│   ├── app.css              design system (Reading Room / Night Shelf tokens, components)
│   ├── body.html            app shell: widgets, nav, capture/scan/editor sheets, dose overlay
│   ├── core.js              DOM-free domain logic: state, FSRS-style scheduler, smart parser,
│   │                        encrypted per-user media store, streaks, sentences, self-tests
│   ├── auth.js              Auth (PBKDF2/AES-GCM vaults, stay-signed-in, boot) + lock screen
│   ├── ui1.js               player/TTS · OCR engine · capture & scan flows · editors · dose session
│   ├── ui2.js               router · renderers · reminders · search · export/import · lifecycle
│   ├── tail.html            closing tags
│   └── build.sh             concatenates the modules → ../index.html (with node --check gate)
└── docs/
    └── infallyn-specification.md   full product & architecture spec
```

## 🛠 Building from source

```bash
cd src && ./build.sh     # → regenerates ../index.html
```

Node is optional (only used for the syntax check) — the build itself is plain concatenation
in this order: `head.html → app.css → body.html → core.js → auth.js → ui1.js → ui2.js → tail.html`.

## 🧪 Self-tests

Open the app with [`?selftest=1`](index.html?selftest=1) — the domain test suite
(parser, scheduler, queue, streaks, sentences, storage) runs and prints a pass/fail panel.

## 🤖 Primer for AI assistants

> **Infallyn** is a single-file offline-first web app (vanilla JS, no build step to run).
> `index.html` is the whole app; `src/` holds the same code as modules concatenated by
> `src/build.sh` (head + app.css + body + core + auth + ui1 + ui2 + tail). `core.js` is
> DOM-free domain logic (global state `S`, FSRS-style scheduler, smart date parser,
> encrypted media store `Media`, safe `Store` wrapper). `auth.js` = passphrase accounts
> (`Auth` + lock screen `LK`, AES-256-GCM vaults at `infallyn.vault.<user>`). `ui1.js` =
> player (Web Speech TTS), OCR (Tesseract via CDN), capture/scan/edit flows, nightly
> "Daily Dose" overlay (`DZ`). `ui2.js` = hash router (`#/shelf`, `#/dose`, `#/listen`,
> `#/you`), renderers, reminders, lifecycle (`Auth.boot()` → `LK` → `startApp()`).
> App global: `window.Infallyn` (alias `L`). Self-tests: `?selftest=1`.

## 📄 License

[MIT](LICENSE) — free to use, modify, and ship.
