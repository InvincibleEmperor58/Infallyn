# Infallyn — Engineering Handoff (for AI agents & new contributors)

> **Read this before changing anything.** It compresses everything learned while building
> and debugging the app so far. Pair it with `README.md` (user-facing) and
> `docs/infallyn-specification.md` (product & architecture spec).

**State:** v1.2.1 — validated in a real (headless Chromium) browser: full account lifecycle,
typing fix on the lock screen, OCR round-trip, dose flow, persistence, zero page errors.

---

## 1. Non-negotiable build rules

1. **`src/` is the source of truth. Never edit `index.html` directly** — it is generated.
2. Build with `bash src/build.sh` (plain concatenation, **order matters**:
   `head.html → app.css → body.html → core.js → auth.js → ui1.js → ui2.js → tail.html`).
   It runs `node --check` as a gate (Node optional but recommended).
3. Keep the single-file, zero-dependency promise: no frameworks, no external CSS/JS/fonts.
   The only runtime external is the OCR engine (Tesseract.js via CDN) with a graceful
   offline fallback. Current size ≈ 273 KB — try to stay under ~400 KB.
4. After any UI change, **boot-test in a real browser** (puppeteer/playwright). Don't trust
   `node --check` alone — it can't catch HTML-parser traps (see §3) or runtime focus bugs.

## 2. Architecture in 60 seconds

- `core.js` — DOM-free domain logic. Global state object `S` (items/cards/reviews/sessions/
  settings), debounced `saveState()`, FSRS-style scheduler (`gradeCard`, `buildQueue`),
  natural-language date parser (`parseSmart`), sentence splitter, seed content, self-tests.
- `auth.js` — `Auth` (PBKDF2 150k → AES-256-GCM per-account vault in
  `localStorage: infallyn.vault.<user>`; photos encrypted per-record in IndexedDB
  `infallyn-media` under `u/<user>/`) + `LK` lock-screen UI. Boot: `Auth.boot()` →
  lock screen → `startApp()`.
- `ui1.js` — `Player` (Web Speech TTS, sentence queue, karaoke transcript), `OCR`
  (Tesseract loader + offline fallback), capture/scan/edit flows, `DZ` nightly-dose overlay.
- `ui2.js` — hash router (`#/shelf`, `#/dose`, `#/listen`, `#/you`), renderers, 20 s `tick()`
  (reminders + dose notifications), search, export/import, theme, lifecycle bindings.
- App global: `window.Infallyn` (alias `L`) — inline `onclick` handlers call `Infallyn.*`.
- Self-tests: open with `?selftest=1` (prints pass/fail panel; runs even before account setup).

## 3. Traps already found the hard way (do not reintroduce)

1. **Lock-screen focus:** never re-render the whole lock form on `input` events, and never
   leave unguarded delayed `focus()` timers — typing gets split across fields
   (fixed once; regression tests type keystroke-by-keystroke with `{delay}`).
2. **HTML parser eats nested buttons:** a `<button>` inside `<button>` gets auto-closed and
   ejects the rest of the markup (broke the Now-Playing widget). Use `div role="button"`.
3. **CSS grid blowout:** grid children need `minmax(0, 1fr)` tracks + `min-width:0;
   overflow:hidden` on text, or long titles stretch the page horizontally. Test every tab
   with `document.scrollWidth <= clientWidth`.
4. **TTS race:** `speechSynthesis` fires `onend` for *cancelled* utterances too — guard
   continuation with a token (`this.tk`) or playback double-fires (fixed in `Player.speak`).
5. **Auto-grading loops in tests:** dose grading changes state; test loops must detect the
   done-screen (`#dose-done` display) rather than counting cards.
6. **Puppeteer clicks:** coordinate-based `page.click()` can land on a re-rendered element;
   prefer `page.evaluate(() => el.click())` for this app.
7. **Names are stored lowercased** (`Infallible` → `infallible`); avatar initial derives
   from `Auth.hue(user)`.

## 4. Data & compatibility contracts

- Storage keys: `infallyn.accounts.v1`, `infallyn.vault.<user>`, `infallyn.autologin.<user>`,
  `infallyn.lastuser`, `infallyn.devicekey` (+ legacy `infallyn.state.v1` pre-accounts).
- Export JSON: `{app:'Infallyn', version:1, state, media}` — importer rejects other `app` ids;
  keep that contract stable.
- Passphrase vaults have **no recovery path by design** — any "reset" feature must not
  weaken this (device-wrapped auto-login key is the only convenience affordance).
- The spec's fictional persona/examples use **Ibrahim** (medical student) — keep docs matching.

## 5. Suggested progressive roadmap (roughly in order)

1. **Service worker + offline OCR** — cache Tesseract assets so scanning works offline;
   makes the PWA install story complete (manifest already ships).
2. **Recurring tasks** — RRULE subset (daily/weekly/monthly); completion schedules next.
3. **Document snippets as dose cards** — region-crop from PDFs/images; pairs with doc viewer.
4. **Local stats page** — per-pillar analytics computed from existing `reviews`/`sessions`.
5. ~~**Multi-device sync (big)**~~ — **implemented in v1.3** as E2E-encrypted per-entity LWW sync over Supabase Auth/PostgREST/Storage. See `docs/sync.md` (design, threat model, setup) and `supabase/schema.sql` (tables, RLS, bucket). Needs a live project to verify RLS + OTP email end-to-end.
6. **Accessibility pass** — full keyboard traversal audit, ARIA live regions for toasts.

## 6. Working convention

Small PRs, one concern each; reference Linear issues (`D-x`) in the PR title so Linear's
GitHub integration links them. Validate in the browser before every commit. Keep
`README.md`'s "Primer for AI assistants" and this file updated when architecture shifts.
