# Infallyn — Product & Technical Specification

| | |
|---|---|
| **Product** | Infallyn — personal productivity & study platform |
| **Version** | 1.0 (Draft for review) |
| **Date** | 23 September 2026 |
| **Owner** | Product / Architecture |
| **Status** | For stakeholder review |
| **Scope** | Architecture, user workflows, feature specifications, UX guidelines, roadmap, risks |

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [The Four Pillars](#2-the-four-pillars)
3. [App Architecture](#3-app-architecture)
4. [Data Model](#4-data-model)
5. [Key User Workflows](#5-key-user-workflows)
6. [Feature Specifications](#6-feature-specifications)
7. [UX Design Guidelines](#7-ux-design-guidelines)
8. [Analytics & Instrumentation](#8-analytics--instrumentation)
9. [Privacy & Security Guidelines](#9-privacy--security-guidelines)
10. [Release Plan & Roadmap](#10-release-plan--roadmap)
11. [Risks & Mitigations](#11-risks--mitigations)
12. [Open Questions](#12-open-questions)
- [Appendix A — Notification Specification](#appendix-a--notification-specification)
- [Appendix B — Scheduling Math (FSRS & Dose Sizing)](#appendix-b--scheduling-math-fsrs--dose-sizing)
- [Appendix C — Glossary](#appendix-c--glossary)

---

## 1. Product Overview

### 1.1 Vision

> **Infallyn is the quiet room where everything you need to learn, remember, and finish lives together** — your tasks, your notes, your reading, your memories — **and where a few minutes every night keeps it all alive.**

Infallyn is not another to-do app or another flashcard app. It is a single, calm workspace organized like a personal archive: you capture things once (a task, a handwritten page, a PDF, a photo worth remembering), and Infallyn takes care of the rest — surfacing tasks on time, resurfacing memories and knowledge on a science-backed schedule, and turning anything you write by hand into clean text you can *listen to* on the go.

### 1.2 Problem statement

| Problem | Today's "solution" | Why it fails |
|---|---|---|
| Study material is scattered across 5+ apps (notes, scanner, PDF reader, flashcards, podcast player) | Context-switching | Capture friction kills the habit; nothing cross-references anything |
| Handwritten notes are dead weight — unsearchable, unreviewable, unusable while commuting | Photos in the gallery roll | Never converted; never reviewed; never heard |
| Spaced-repetition apps are text-first and joyless | Anki & clones | No photo/document support, no daily ritual, high setup cost |
| Review habits collapse without a consistent trigger | Willpower | No fixed nightly moment; streaks break |

### 1.3 Goals and non-goals

**Goals (v1.0)**

1. One unified workspace: tasks, theoretical notes, and literature documents with reliable, customizable reminders.
2. A *nightly ritual* — "Daily Dose" — a visual memory gallery that reviews due items (photos, note cards, document snippets) on an FSRS spaced-repetition schedule.
3. A best-in-class handwriting pipeline: **scan → clean digital text → high-quality audio**, fully usable offline.
4. Glanceable, interactive home-screen access: due counts, next task, and audio playback controls — without opening the app.

**Non-goals (v1.0)**

- Real-time collaboration or shared accounts (revisit post-v2).
- Social features, marketplaces, content feeds.
- A web/desktop app (the phone *is* Infallyn in v1; export formats keep the door open).
- Cloud-only architectures; Infallyn works 100% offline by default.
- Cursive-handwriting OCR for all languages at launch (Latin script first; see §6 OCR-305/318 and Open Questions).

### 1.4 Target users (personas)

| Persona | Profile | Core need | Signature behavior |
|---|---|---|---|
| **Ibrahim, 21** — medical student | Studies from handwritten lecture notes; 90-min daily commute | Turn notes into searchable text and *listen* on the bus; nightly recall drills before exams | Scans notes after class, listens at 1.8×, does his dose at 22:30 |
| **Marcus, 38** — lifelong learner | Reads papers & non-fiction; wants to remember highlights and family moments | A nightly "memory gallery" mixing book highlights with photos; low-effort capture | Pins photos and PDF snippets as memory cards; 5-minute dose each night |
| **Dr. Chen, 45** — researcher | Manages 200+ literature PDFs; tasks tied to papers | A trustworthy document Infallyn with reminders; audio pass of handwritten margin notes | Links tasks to documents; uses reminders for reading deadlines |

### 1.5 Success metrics (KPIs)

| Metric | Definition | Target (v1.0, 90 days) |
|---|---|---|
| Activation | % of new users who capture ≥1 item **and** complete their first Daily Dose within 48 h | ≥ 60% |
| Habit strength | Nightly Dose completion rate among DAU | ≥ 45% |
| Streak depth | % of WAU with a ≥7-night streak | ≥ 30% |
| Listening | Median audio minutes/week among users who used OCR→Audio | ≥ 25 min |
| OCR trust | % of scanned pages accepted without text edits | ≥ 70% (print) / ≥ 50% (handwriting) |
| Retention | D30 retention | ≥ 25% |
| Reliability | Task reminders fired within ±1 min of scheduled time | ≥ 99.5% |

### 1.6 Assumptions

1. Phone-first product (iOS + Android). Tablets benefit from the same layouts; no dedicated tablet design in v1.
2. Launch languages: English UI; handwriting recognition for Latin script at launch, Indic/CJK via platform engines and cloud add-ons (see Open Questions).
3. Monetization is freemium (details in §10.3) — all *core* study features are free and offline.
4. No account required to use the app locally; accounts exist only for optional sync/backup.

---

## 2. The Four Pillars

| # | Pillar | One-line spec | Deep dive |
|---|---|---|---|
| 1 | **Task & Document Shelf** | A unified, offline-first workspace for pending tasks, theoretical notes, and literature documents, with precise, customizable notifications | §3.3, §5.2–5.3, §6.1 |
| 2 | **Spaced Repetition — Daily Dose** | A visual memory gallery of due items (photos, note cards, document snippets) that triggers every night and schedules reviews with FSRS | §3.5, §5.5, §6.2 |
| 3 | **Intelligent OCR → Audio Engine** | Scan handwriting → on-device recognition → cleaned, structured text → high-quality TTS with background playback | §3.6–3.7, §5.4, §6.3 |
| 4 | **Smart Access & Integration** | Interactive home-screen widgets (due counts, next task, audio controls), deep links, Siri/Assistant shortcuts, share-sheet ingestion, encrypted backup/sync | §3.4, §5.7, §6.4 |

The pillars reinforce one loop: **capture once (1) → remember nightly (2) → listen anywhere (3) → reach everything at a glance (4).**

---

## 3. App Architecture

### 3.1 Platform strategy

**Recommendation: a single Flutter codebase for the app, with native extensions for widgets, background execution, and media.**

| Criterion | Flutter (recommended) | React Native | Fully native (×2) | Kotlin Multiplatform |
|---|---|---|---|---|
| Custom gallery/canvas UI (Dose, scanner) | ★★★ own rendering pipeline | ★★ bridge overhead | ★★★ | ★★★ |
| Widgets (home screen) | via native Swift/Kotlin extensions (required either way) | same | ★★★ | ★★ |
| Background scheduling & audio | native modules (required either way) | same | ★★★ | ★★★ |
| OCR/TTS ecosystem | mature plugins + easy native escape hatches | good | ★★★ | fair |
| Team efficiency (1 codebase) | ★★★ | ★★★ | ★ (two teams) | ★★ |
| Long-term UI consistency across platforms | ★★★ | ★★ | ★★★ | ★★★ |

**Minimum OS targets:** iOS 16+ (interactive widgets require iOS 17 — graceful deep-link fallback on 16), Android 10 (API 29)+.

**Companion native targets (required regardless of framework):**

- **iOS:** WidgetKit extension (SwiftUI), App Intents (Siri Shortcuts + interactive widgets), `BGTaskScheduler` workers, `AVAudioSession`/Now-Playing integration, Vision framework OCR bridge.
- **Android:** Glance (Jetpack Compose) widgets, WorkManager + AlarmManager workers, Media3 `MediaSessionService`, ML Kit OCR, system TTS binding.

### 3.2 Architectural style: local-first, modular, event-driven inside

Infallyn is **local-first**: the on-device database is the source of truth; the network is an optimization (sync/backup/premium voices), never a dependency.

```
┌──────────────────────────── PRESENTATION ────────────────────────────┐
│  Flutter app: Infallyn · Dose · Listen · Capture   (Riverpod state)   │
│  Native extensions: WidgetKit (iOS) / Glance (Android) widgets       │
│  Deep links: infallyn://dose/tonight · infallyn://item/<id> · etc.     │
└───────────────▲──────────────────────────────────────────────────────┘
                │
┌───────────────┴──────────── APPLICATION (use cases) ─────────────────┐
│  CaptureService      IngestPipeline (scan → OCR → text)              │
│  TaskScheduler       SpeechService (text → audio, queue, position)   │
│  DoseBuilder         NotificationScheduler (reminders, nightly)      │
│  SessionEngine       SyncEngine (oplog)        StatsService          │
└───────────────▲──────────────────────────────────────────────────────┘
                │
┌───────────────┴────────────── DOMAIN (pure Dart, unit-tested) ───────┐
│  Entities: Item, Task, Note, Document, ReviewCard, ReviewLog,        │
│            AudioTrack, ReminderRule, Collection, Tag                 │
│  Policies: FSRS scheduler · recurrence (RRULE) · reading-order       │
│            planner · dose sizing · quiet hours                       │
└───────────────▲──────────────────────────────────────────────────────┘
                │ repository interfaces
┌───────────────┴─────────── INFRASTRUCTURE ───────────────────────────┐
│  Drift/SQLite (source of truth, FTS5)   Media store (SHA-256 named)  │
│  Platform channels:                     Cloud adapters (opt-in):     │
│   • exact local notifications            • Cloud OCR (hard pages)    │
│   • background tasks (WorkManager /      • Premium neural TTS proxy  │
│     BGTaskScheduler)                     • E2E-encrypted sync (v1.5) │
│   • ML Kit / Apple Vision (on-device OCR)                            │
│   • system TTS engines · audio focus / media session                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Modularization:** feature packages (`feature_shelf`, `feature_dose`, `feature_listen`, `feature_capture`), core packages (`domain`, `data`, `platform_*`, `design_system`). Dependencies point inward only; domain has zero Flutter imports.

**State management:** Riverpod (compile-safe DI + testable providers). Navigation: `go_router` with a registered deep-link map (widgets, notifications, and shortcuts all resolve to deep links — one entry point for every entry vector).

### 3.3 Pillar 1 subsystem — Infallyn, storage & reminders

**Storage layout (sandbox):**

```
/app_root
  /databases/Infallyn.db        # SQLite via Drift; FTS5 virtual table for search
  /media/<ab>/<sha256>.jpg     # content-addressed originals + derivatives
  /audio/<ab>/<sha256>.opus    # synthesized audio cache
  /backups/                    # encrypted export bundles
```

Content-addressing deduplicates scans/photos; an internal reference-count garbage collector reclaims orphaned media after 30 days.

**Reminder engine:** `ReminderRule` rows materialize into OS notifications. Android uses exact alarms (`AlarmManager.setExactAndAllowWhileIdle`, `SCHEDULE_EXACT_ALARM` with in-app permission priming and inexact fallback); iOS uses `UNCalendarNotificationTrigger` (exact) — no background code needed to *fire* a notification on either platform. Snooze/complete actions run via notification-action extensions (iOS) and broadcast receivers (Android).

### 3.4 Pillar 2 & 4 subsystem — background execution and the nightly trigger (honest constraints)

A mobile OS will not guarantee running your code at an arbitrary nightly time while the app is terminated. Infallyn therefore separates **reliable triggering** (notifications — exact on both platforms) from **opportunistic preparation** (background tasks):

| Concern | Android | iOS |
|---|---|---|
| Task reminders (exact) | `AlarmManager` exact alarms + `POST_NOTIFICATIONS` runtime permission | `UNCalendarNotificationTrigger` |
| Nightly Dose trigger | High-priority notification; optional exact alarm + full-screen intent where permitted | Exact calendar notification |
| Dose queue pre-build & widget refresh | WorkManager periodic (≈ nightly, flexible window) + on-open fallback | `BGAppRefreshTask` (opportunistic) + on-open fallback |
| Audio playback in background | Media3 `MediaSessionService` (foreground service, `mediaPlayback` type) | `UIBackgroundModes: audio` + Now-Playing/MPRemoteCommand |
| Widget data freshness | Glance with `WorkManager` updates at dose time | WidgetKit timeline entries pre-generated 48 h ahead |

**Design rule:** *every* background task must have an on-open fallback path, so the product behaves identically even if the OS never grants background time.

### 3.5 Pillar 2 engine — FSRS review scheduler

- Algorithm: **FSRS** (Free Spaced Repetition Scheduler — the open algorithm now adopted by Anki) over legacy SM-2: better interval prediction with fewer ratings, per-user parameter tuning optional.
- Per-card state: `stability`, `difficulty`, `due_at`, `last_reviewed_at`, `state` (new/learning/review/relearning), `lapses`.
- Ratings: **Again / Hard / Good / Easy** (also swipe gestures; §7.5).
- Desired retention: default **0.90**, user-adjustable 0.80–0.95 (higher = shorter intervals, more nightly load).
- Dose sizing: nightly queue = min(due cards, cap), cap default **20** (10–50 configurable), plus ≤5 new cards/night. Estimated session length shown *before* starting ("≈ 4 min"). Math in Appendix B.

### 3.6 Pillar 3 engine — OCR pipeline

```
 capture ──► preprocess ──► recognize ──► reconstruct ──► review/correct ──► persist ──► (synthesize)
 (camera/    (crop, deskew,   (on-device     (lines →       (confidence       (Note +     (TTS, §3.7)
  import)     shadow,          Vision /      paragraphs,    highlighting,     original
              binarize)        ML Kit)       lists, heads)  split editor)     image kept)
```

1. **Capture:** in-app multi-page camera scanner with live edge detection; or import photos/PDFs via share sheet.
2. **Preprocess:** perspective crop, deskew, illumination normalization, adaptive binarization — all on-device, ≤300 ms/page on mid-tier hardware.
3. **Recognize:** on-device first — Apple **Vision** (`VNRecognizeTextRequest`, accurate mode) on iOS; **ML Kit Text Recognition v2** on Android (Latin bundle at launch; Devanagari/CJK bundles available). Handles neat handwriting well; degrades on cursive. **Cloud fallback** (Google Cloud Vision / Azure Read) is user-initiated per page, opt-in, and clearly labeled "this page leaves your device" (§9).
4. **Reconstruct:** geometric line-box analysis → paragraph merging, list detection, heading inference; produces clean Markdown, *never* silently altered — an optional "smart tidy" pass (punctuation, hyphenation, obvious OCR miss fixes) shows a word-level diff for approval (P2).
5. **Review/correct (the trust screen):** split view — original image left, recognized text right; words below a confidence threshold are underlined; tapping a word shows the cropped region of the original. Corrections feed a personal dictionary that biases future recognition.
6. **Persist:** new `Note` linked to the source image ("film + negative" principle — the original is always retained). One toggle adds it to tonight's Dose and/or the Listening queue.

### 3.7 Pillar 3 engine — TTS pipeline

| Aspect | Specification |
|---|---|
| Default voices | On-device neural TTS (iOS: system enhanced voices; Android: Google TTS neural voices) — free, offline, private |
| Premium voices (P1) | Cloud neural voices (e.g., Azure Neural / ElevenLabs) via proxy; per-note opt-in; audio cached so text is sent once; explicit consent screen |
| Text prep | Reading-order planner: headings → pauses, list items → enumerated phrasing, links/footnotes → configurable skip; language detection per paragraph with voice fallback chain |
| Synthesis | Sentence-level chunking (≤ ~500 chars) for streaming start < 800 ms; long notes never block playback |
| Sync markers | TTS boundary events drive the "karaoke" sentence highlight and tap-to-seek (P1) |
| Caching | Synthesized audio cached as Opus (~24 kbps mono ≈ 0.2 MB/min), keyed by SHA-256(text + voice); LRU eviction with user-controlled ceiling |
| Playback | Queue = current shelf/selection; 0.5×–3.0× speed; skip ±15 s / ±1 item; sleep timer; resume position per track; lock-screen & widget controls |
| Accessibility | Full transcript view always available; playback is *never* the only way to consume a note |

### 3.8 Security architecture

- App lock: optional Face/fingerprint unlock; background blur.
- Encryption at rest: SQLCipher (optional but promoted during onboarding); keys in Keychain (iOS, `WhenUnlockedThisDeviceOnly`) / Android Keystore; biometric gate.
- In transit: TLS 1.3 only; sync payloads additionally **end-to-end encrypted** (XChaCha20-Poly1305; key derived from user passphrase, never uploaded).
- No third-party crash/analytics SDK receives note content — events are content-free (§8).
- Privacy policy promise: **user notes are never used to train models.**

### 3.9 Performance budgets

| Budget | Target |
|---|---|
| Cold start → interactive (p90) | < 2.0 s |
| Frame rate (Dose gallery scroll/swipe) | 60 fps sustained (120 Hz adaptive on ProMotion) |
| Scan → text (per page, on-device, mid-tier 2023 Android, p50) | < 3 s |
| TTS first audio (sentence cached / uncached) | < 150 ms / < 800 ms |
| Battery — background (sync + widgets + tasks) | < 2%/day typical |
| Initial download size | < 90 MB (OCR models delivered as on-demand platform modules) |
| Search latency over 10k items (p95) | < 100 ms (FTS5) |

### 3.10 Decision log

| ID | Decision | Rationale | Alternatives rejected |
|---|---|---|---|
| D1 | Flutter app + native widget/background/media extensions | One team, custom gallery-grade UI, native escape hatches where the OS demands it | RN (weaker canvas/storytelling perf), dual-native (2× cost) |
| D2 | Local-first, SQLite source of truth | Speed, privacy, offline; sync is additive | Cloud-first (fails commutes/flights) |
| D3 | FSRS for review scheduling | Best-in-class open algorithm, Anki-adopted, cheap to compute | SM-2 (more rating noise), custom ML (unproven) |
| D4 | On-device OCR default, cloud fallback opt-in | Privacy + offline + zero marginal cost | Cloud-only (privacy, cost, offline) |
| D5 | System TTS default; premium cloud voices optional | Free core, offline, instant start | Cloud-only TTS |
| D6 | Nightly trigger = exact local notification; prep = opportunistic BG tasks | The only reliable cross-platform pattern | Silent background wakeups (not guaranteed) |
| D7 | Content-addressed media store | Dedupe scans, cheap integrity checks, easy GC | UUID files (dupes) |
| D8 | E2E-encrypted sync via oplog (v1.5), encrypted export first | Trust-first; no server can read content | Plaintext cloud DB |

---

## 4. Data Model

### 4.1 Entity-relationship overview

```
Item (polymorphic root)
 ├── 1:1 Task        (when type = task)
 ├── 1:1 Note        (when type = note;  source: typed | ocr | import)
 ├── 1:1 Document    (when type = document; pdf | image)
 ├── 1:N ReviewCard  ──< ReviewLog        (Pillar 2)
 └── 1:N AudioTrack  ──< PlaybackSession  (Pillar 3)
Item N:M Collection (shelves)   via ItemCollection
Item N:M Tag                    via ItemTag
ReminderRule N:1 Item
```

### 4.2 Entity dictionary (key fields)

| Entity | Key fields (abridged) |
|---|---|
| `Item` | `id` (ULID), `type` (task\|note\|document), `title`, `pinned`, `archived_at`, `deleted_at` (tombstone), `created_at`, `updated_at`, `schema_version` |
| `Task` | `status` (inbox\|today\|done), `due_at`, `priority` (0–3), `recurrence_rule` (RRULE), `completed_at`, `linked_item_id` (e.g., the document to study) |
| `Note` | `body_md`, `source` (typed\|ocr\|import), `ocr_confidence_avg`, `source_media_ids[]`, `language` |
| `Document` | `file_media_id`, `mime`, `page_count`, `last_read_page`, `toc_json?` |
| `Collection` ("shelf") | `id`, `name`, `icon`, `accent`, `parent_id`, `sort_order` |
| `ReviewCard` | `id`, `kind` (photo\|note_card\|doc_snippet\|audio), `front_media_id`, `back_media_id?`, `caption`, `item_id`, `state`, `stability`, `difficulty`, `due_at`, `last_review_at`, `lapses`, `suspended` |
| `ReviewLog` | `card_id`, `rating` (again\|hard\|good\|easy), `reviewed_at`, `elapsed_ms`, `scheduled_vs_actual` (for FSRS tuning) |
| `AudioTrack` | `id`, `item_id`, `text_hash`, `voice_id`, `duration_ms`, `file_media_id`, `last_position_ms`, `boundary_map_json` |
| `PlaybackSession` | `started_at`, `ended_at`, `track_ids[]`, `speed`, `completed` |
| `ReminderRule` | `item_id`, `kind` (time\|due_offset\|recurring), `fire_at`, `rrule?`, `channel`, `last_fired_at` |
| `Setting` | namespaced KV (`dose.*`, `privacy.*`, `appearance.*`, `notifications.*`) |

**Indexes & search:** FTS5 table over `Item.title + Note.body_md + Document.title` with porter stemming; composite indexes on `(type, status, due_at)` and `ReviewCard(due_at, suspended)`; tombstone-based soft deletes power sync and Trash (30-day retention).

**Migration policy:** Drift migrations with recorded steps; destructive migrations prohibited after v1.0 GA (additive only).

**Device → cloud:** sync (v1.5) ships an append-only oplog of mutations (`entity, id, op, lww_clock, payload`), per-field last-writer-wins with tombstones; review logs are append-only by nature (merge is trivial). All payloads E2E-encrypted client-side (D8).

---

## 5. Key User Workflows

Workflow notation: numbered happy path, followed by edge cases. Signature flows (5.4, 5.5) include Given/When/Then acceptance scenarios.

### 5.1 First run & onboarding (≤ 90 seconds to value)

1. **Welcome (3 screens max):** vision statement → 3-step "how Infallyn works" (Capture · Review nightly · Listen) → theme pick (Reading Room / Night Shelf).
2. **Permissions with rationale** (each explained *before* the OS prompt; all skippable, re-prompted contextually later):
   - Notifications — "Infallyn reminds you of tasks and opens tonight's Dose."
   - Camera — "To scan handwritten notes."
   - Photos — "To turn saved photos into memory cards." (iOS: limited-access supported)
   - Exact alarms (Android 12+) — "So reminders land on the minute."
3. **Starter content choice:** *I'm a student* / *I read a lot* / *Just tasks for now* — presets shelves (e.g., "Lectures", "Papers", "Inbox") and defaults (Dose time 21:30 for students, 22:00 otherwise).
4. **First capture nudge:** capture sheet opens with sample content pre-created (a sample task, a sample memory-card photo, a sample note) so Day-0 screens are never empty.
5. **Dose-time confirmation:** "We'll open tonight's Dose at 21:30. √ Change" — sets the anchor habit immediately.

**Edge cases:** notification permission denied → Dose badge on widget/app icon + in-app banner explains how to re-enable; permission-priming screen uses real UI, never fake dialogs.

### 5.2 Universal capture (the 5-second rule)

**Trigger:** ＋ tab, capture widget, share sheet, App Shortcut/"Hey Siri, add to Infallyn".

1. One bottom sheet, three segments: **Task | Note | Scan** (remembers last used).
2. Smart input line parses natural language as you type:
   - `"Read chapter 4 tomorrow 9pm !!"` → title "Read chapter 4", due tomorrow 21:00, priority high
   - `#med-school` tags, `/lectures` assigns shelf, `*` pins
   - date grammar: `today, tmr, fri, next week, 12 oct, in 3 days`, times: `9pm, 08:30, noon`
3. Save (✓ button / Enter / auto-save on dismiss). Item lands in **Inbox** (or assigned shelf) and instantly appears in Today/Upcoming if dated.

**Edge cases:** ambiguous dates ("Friday" past midnight) → chip shows parsed value for one-tap correction; offline capture always works (local-first); share-sheet ingestion of PDFs/images routes to Scan or Document with pre-filled title from filename/metadata.

### 5.3 Organize & plan (Pillar 1 daily loop)

- **Shelf tab = shelves metaphor:** horizontal shelf carousel (pinned first), each shelf opens a two-pane list (items + filters). Global **Views** rail: *Inbox · Today · Upcoming · Anytime · Listening*.
- **Today view:** overdue (ember accent) → due today → pinned; swipe left = snooze presets (1 h / this evening / tomorrow), swipe right = complete with satisfying check animation + haptic.
- **Linking:** any task can link a note/document ("Study — Endocrinology lec. 4" → the PDF); linked chip appears in both places; tapping opens the target.
- **Weekly review (Sunday evening notification, optional):** digest screen — completed count, upcoming 7 days, overdue cleanup, Dose stats heatmap.

### 5.4 Signature flow A — Scan → clean text → audio (Pillar 3)

**Trigger:** Scan segment, capture widget, share sheet (photo/PDF), or "Scan" action on a shelf.

1. **Scanner:** camera opens with auto edge-detect and multi-page reel; shutter, reorder pages, "Done".
2. **Processing (perceived speed):** pages process streaming — first page's text typically lands in < 3 s; progress shown per page; user can start reviewing page 1 while page 3 recognizes.
3. **Trust screen (split view):** original image ↔ recognized Markdown; low-confidence words underlined; tap word ↔ see crop. Inline toolbar: heading/list/bold formatting; "merge/split paragraph" gestures.
4. **Destination chips (one tap each, remembered):**
   - `Save to note` (always)
   - `Add to tonight's Dose` → creates a `note_card` ReviewCard (front: title + first lines; back: full note)
   - `Add to Listening` → queues TTS; toggle "auto-generate audio on save" exists in settings
5. **Listen:** player opens with the note; sentence-highlight karaoke mode; lock-screen and Now Playing widget controls immediately live.

**Acceptance scenario (Given/When/Then):**

```gherkin
Given Ibrahim finished a 3-page handwritten lecture
When he scans all pages and taps "Save + Dose + Listen"
Then a single Note exists with editable Markdown linked to 3 images,
     1 note_card ReviewCard is due tonight (21:30 queue),
     an AudioTrack is generated with per-sentence boundaries,
     and the whole flow required ≤ 3 additional taps after the shutter.

Given the recognizer outputs a word with confidence < threshold
When the trust screen renders
Then that word is visually flagged and tapping it shows the image crop;
     after correction, the personal dictionary stores the fix.

Given airplane mode
When he scans and taps Listen
Then OCR and TTS still complete fully on-device with no error states.
```

**Edge cases:** blank/blurry page → specific guidance ("move closer / more light") with retake; cloud fallback offer appears only after two consecutive low-confidence pages, with the privacy label; mixed print+handwriting → engine auto-routes; very long scan (30+ pages) → background continuation with notification when done.

### 5.5 Signature flow B — the nightly Daily Dose (Pillar 2)

**Trigger:** configurable nightly notification (default **21:30**), Dose widget/tab badge, or "Hey Siri, start my nightly dose."

1. **Pre-build:** background worker materializes tonight's queue (due cards, ≤ 20 + ≤ 5 new, interleaved kinds, hardest-never-first ordering) and refreshes widget timelines. If the OS never grants background time, the queue builds on open (< 400 ms for 10k cards).
2. **The invitation:** "Tonight's Dose — 16 cards · ≈ 4 min · 3 photos, 9 notes, 4 snippets." One re-nudge at 22:15 (configurable, max 1, respects quiet hours).
3. **The session (the gallery):** full-bleed cards in a warm dark theme —
   - photo card: image + caption prompt ("What was this? Tap to reveal")
   - note card: front = title + first lines, tap/flip = full note
   - doc snippet: region crop from the page, tap = full page context
   - **grading:** swipe right = Good, left = Again, up = Easy, down = Hard — mirrored by 4 thumb-reachable buttons (accessibility); FSRS schedules the next appearance instantly.
   - in-session tools: edit card, suspend, bury-until-tomorrow; progress ring + count at top.
4. **Completion:** ring closes; summary "16 reviewed · 81% recalled · streak 6 nights"; tomorrow's forecast; gentle CTA "Add a memory from today?" (photo picker → new card in 2 taps).
5. **Aftermath:** review logs written, widget timeline refreshed ("Dose done ✓ · next review Thu"), streak saved.

**Acceptance scenario:**

```gherkin
Given 23 cards are due at 21:30 and the cap is 20
When the nightly notification fires
Then the invitation says "20 cards · ≈ 5 min", the queue is deterministic
     (same order on relaunch), and the 3 overflow cards join tomorrow.

Given the user misses the session entirely
When the next morning arrives
Then the streak shows one "shelf closed" grace night (1/week),
     due cards roll over, and no card is silently dropped.
```

**Edge cases:** time-zone travel → session anchors to *local* 21:30; streak freeze honored; session interrupted (call) → resume exactly at card N; user grades at 00:30 → counts for the *previous* night if before 03:00 (grace window, configurable).

### 5.6 Listening room (Pillar 3 daily loop)

- **Queue model:** implicit (current shelf/selection) or explicit playlist; drag to reorder; "Up next" chips.
- **Controls:** play/pause, ±15 s, previous/next item, 0.5×–3× speed (persisted per user), sleep timer (end-of-note option), transcript sheet with sentence tap-to-seek.
- **Continuity:** position syncs per track; "Continue listening" card on home; lock-screen/Now-Playing always correct.

### 5.7 Widget & quick-access loops (Pillar 4)

| Widget | Content | Interactions | Tap-through |
|---|---|---|---|
| **Due ring** (small) | Dose ring (due/done) + tasks-due-today count | Tap ring | `infallyn://dose/tonight` |
| **Next Up** (medium) | Next task (title, time) + next Dose time | Tap task row / tap dose chip | item detail / dose |
| **Now Playing** (medium) | Current note title, progress bar | **Play/pause button, ±15 s** (iOS 17 interactive / Android buttons); iOS 16 fallback: opens player | — |
| **Quick Capture** (small) | ✚ task · 📷 scan | Two buttons | capture sheet (pre-selected segment) |
| Lock screen (iOS) / shortcuts row | due count · play button | tap | dose / player |

Widget data comes from precomputed timeline snapshots; every widget state renders in light + dark and always shows *time-correct* info (e.g., after the nightly session completes, the ring shows done ✓ without requiring an app open).

### 5.8 Import / export / leave

- **In:** share sheet from any app (photos, PDFs, text), files app import, markdown import.
- **Out:** full export as zip (SQLite + markdown + media) any time; per-note markdown export; JSON schema documented publicly.
- **Delete:** in-app account/data deletion with media wipe; Trash restores within 30 days.

---

## 6. Feature Specifications

Priorities: **P0** = MVP launch blocker · **P1** = v1.0 fast-follow · **P2** = v1.x. Each feature lists acceptance criteria (AC).

### 6.1 Pillar 1 — Task & Document Shelf

| ID | Feature | Pri | Specification & acceptance criteria |
|---|---|---|---|
| LBR-101 | Universal capture sheet | P0 | 3 segments (Task/Note/Scan); smart parse of dates/times/priority/#tags//shelf; AC: item saved < 5 s from cold open; parse preview chip always visible before save |
| LBR-102 | Natural date/time parsing | P0 | Grammar table incl. relative dates & times; locale-aware (en first); AC: ≥ 95% correct on test corpus; ambiguity always surfaced as editable chip |
| LBR-103 | Core views | P0 | Inbox, Today, Upcoming, Anytime, shelf views; sort by due/priority/created; AC: overdue visually distinct (ember), counts on tabs correct in real time |
| LBR-104 | Reminders & notifications | P0 | Per-task time reminder, due-soon offset (default 30 min), snooze from notification (1 h/tonight/tomorrow); AC: fire within ±1 min (exact-grant devices); actions work from lock screen |
| LBR-105 | Recurring tasks | P1 | RRULE subset (daily/weekly/monthly/custom weekday sets); AC: completion schedules next occurrence; edit offers this-instance vs series |
| LBR-106 | Shelves, tags, pins, archive | P0 | Nestable shelves (1 level v1), free tags, pin to top; AC: filters combine (shelf+tag+status); archive hides from views, keeps links |
| LBR-107 | Document viewer | P1 | PDF reader (page nav, TOC if present, last-read resume), image viewer; AC: 50 MB PDF opens < 2 s; resume position persists |
| LBR-108 | Full-text search | P0 | FTS5 across titles/note bodies/doc titles; filters by type/shelf/tag; AC: < 100 ms p95 @ 10k items; matched-phrase snippets in results |
| LBR-109 | Linking tasks ↔ notes/documents | P1 | Bi-directional linked chips; AC: deleting one side surfaces a resolution prompt, never a dangling link |
| LBR-110 | Import & share target | P0/P1 | Share-sheet intake for images/PDF/text (P0); files import + markdown import (P1); AC: ingested item preserves source app metadata |
| LBR-111 | Trash & archive hygiene | P0 | 30-day trash with restore; AC: purge runs locally + clears sync tombstones |
| LBR-112 | Markdown note editor | P0 | Minimal toolbar (heading/list/bold/italic/checklist), autosave, keyboard-avoidant layout; AC: zero data loss on force-quit (2-s journaling) |

### 6.2 Pillar 2 — Daily Dose (spaced repetition)

| ID | Feature | Pri | Specification & acceptance criteria |
|---|---|---|---|
| DOSE-201 | Card types | P0 | photo, note_card; doc_snippet P1; audio P2. AC: each renders full-bleed in gallery; front/back defined per type |
| DOSE-202 | FSRS scheduler | P0 | Fields per §3.5; ratings map to intervals; AC: interval accuracy within FSRS reference ±10% on golden test set; same-day repeats obey learning steps |
| DOSE-203 | Nightly session UI | P0 | Gallery + swipe & button grading + progress ring; AC: 60 fps swipe; grading ≤ 1 tap or 1 swipe; state persists through app kill |
| DOSE-204 | Dose builder | P0 | cap 20 (10–50), new-card cap 5/night, interleave kinds, deterministic order; AC: estimated time shown pre-start ± 30% accuracy |
| DOSE-205 | Streaks & stats | P1 | Streak with 1 grace night/week; 12-week heatmap; forecast 30 days; retention %; AC: stats computable offline from ReviewLog |
| DOSE-206 | Missed-night handling | P0 | Roll-over queue, streak grace, morning catch-up (opt-in); AC: no due card ever silently dropped |
| DOSE-207 | Trigger configuration | P0 | Dose time picker, re-nudge toggle/time, quiet-hours respect, per-day overrides; AC: notification fires exact (granted devices); changing time tonight applies tonight |
| DOSE-208 | Card curation | P0 | "Remember this" toggle on any note/photo (creates card); card editor (crop, caption, front/back split); suspend/bury; AC: card creation from photo ≤ 3 taps |
| DOSE-209 | Audio cards | P2 | Front = 30-s audio clip (e.g., language phrase); AC: plays inline without leaving session |

### 6.3 Pillar 3 — OCR → Audio engine

| ID | Feature | Pri | Specification & acceptance criteria |
|---|---|---|---|
| OCR-301 | Multi-page scanner | P0 | Live edge detect, retake, reorder, batch; AC: page processed streaming; 30-page batch continues in background with completion notification |
| OCR-302 | On-device recognition | P0 | iOS Vision accurate mode; Android ML Kit v2 (Latin); AC: print CER ≤ 2% on internal corpus; neat-handwriting CER ≤ 12%; fully offline |
| OCR-303 | Structure reconstruction | P0 | Line-box geometry → paragraphs/lists/headings → Markdown; AC: no silent content edits; structure diff preview when user requests re-layout |
| OCR-304 | Trust screen (correction) | P0 | Split image/text, confidence underlines, tap-to-crop, personal dictionary; AC: corrections persist into future recognition bias; skip-edit path always available |
| OCR-305 | Cloud OCR fallback | P1 | Per-page, opt-in, labeled egress; auto-offer after repeated low confidence; AC: works only with explicit consent state; zero egress otherwise |
| OCR-306 | Smart tidy pass (LLM) | P2 | Punctuation/hyphenation/obvious-miss fixes as *suggested diff* only; AC: no suggestion auto-applies; diff UI word-level |
| OCR-307 | Personal dictionary | P2 | User terms (drug names, notation) bias recognition; AC: importable/exportable |
| TTS-311 | On-device playback | P0 | System neural voices; sentence chunking; AC: first audio < 800 ms uncached; works offline end-to-end |
| TTS-312 | Listening queue | P0 | Implicit shelf queue + manual playlist; AC: survives restart at exact position |
| TTS-313 | Background audio & controls | P0 | Foreground service / audio background mode; lock-screen + Now-Playing controls; AC: no truncation ≥ 60-min session; controls correct track metadata |
| TTS-314 | Speed, skips, sleep timer | P0 | 0.5×–3× persisted; ±15 s; item skip; sleep timer incl. end-of-note; AC: pitch preserved at all speeds (platform time-stretch) |
| TTS-315 | Sentence highlight sync | P1 | Boundary events → transcript karaoke + tap-to-seek; AC: drift < 150 ms over 10-min track |
| TTS-316 | Premium cloud voices | P1 | Opt-in per note; cached; consent screen; AC: zero network without consent; cache eviction honors ceiling |
| TTS-317 | Auto-generate on scan | P1 | Toggle; default on for "Listen" destinations; AC: generation queued, never blocks capture flow |
| TTS-318 | Multilingual notes | P2 | Per-paragraph language detect + voice chain; AC: mid-note language switch reads with correct voice or clean fallback |

### 6.4 Pillar 4 — Smart access & integration

| ID | Feature | Pri | Specification & acceptance criteria |
|---|---|---|---|
| INT-401 | Due-ring widget | P0* | *basic static version at MVP; interactive P1. AC: reflects tonight's state without app open (timeline refresh at session completion) |
| INT-402 | Now-Playing widget | P1 | Play/pause/±15 s (iOS 17 interactive App Intents; Android remote views); iOS 16 deep-link fallback; AC: state latency ≤ 2 s from playback events |
| INT-403 | Next Up widget | P1 | Next task + dose time; AC: updates on task mutate (within 5 min budget) and at midnight |
| INT-404 | Quick-capture widget/shortcut | P1 | Task & scan buttons; AC: lands on capture sheet with segment preselected |
| INT-405 | Lock-screen widgets (iOS) | P2 | Due count + play accessory widgets |
| INT-406 | Siri Shortcuts / App Shortcuts | P1 | "Start my nightly dose", "Play my notes", "Add a task"; AC: donate intents, work from lock screen; Android equivalent via Assistant/App Shortcuts |
| INT-407 | Quick Settings tile (Android) | P2 | Toggle: play/pause listening queue |
| INT-408 | Encrypted backup → sync | P1→P2 | P1: encrypted export to iCloud/Drive (user-driven); P2: background E2E sync via oplog; AC: restore on fresh device reproduces 100% of items incl. card state & positions |
| INT-409 | Export formats | P1 | zip(SQLite+md+media), per-note markdown; documented schema; AC: round-trip import of own export succeeds |
| INT-410 | Wear OS companion | Backlog | Dose progress + play/pause; AC: n/a (backlog) |


---

## 7. UX Design Guidelines

### 7.1 Design principles

1. **Infallyn, not a feed.** No infinite scroll, no recommendation engine, no red-dot anxiety. The app ends when your work ends.
2. **Capture in five seconds.** Every capture path — sheet, widget, share, voice — must beat opening a notebook.
3. **Night-friendly by default.** The Dose happens at 21:30 in bed: warm dark palette, large type, one-handed thumbs, dimmable brightness, optional OLED black.
4. **Your data is yours.** Offline works fully; export exists; privacy choices are in plain language; the original scan is never thrown away.
5. **Progress you can feel.** Rings, streaks, and shelves visually respond — but celebrate quietly (no confetti explosions at midnight).

### 7.2 Information architecture & navigation

```
┌─────────────────────────── bottom navigation ───────────────────────────┐
│  📚 Infallyn      🌙 Dose       ＋ Capture      🎧 Listen      ⚙︎ You     │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Shelf:** shelves carousel + views rail (Inbox/Today/Upcoming/Anytime/Listening) + search.
- **Dose:** idle state (tonight's forecast, "preview tomorrow"), session state (gallery), stats sub-page (heatmap, streak, forecast).
- **Capture (center, elevated):** the 3-segment sheet (§5.2).
- **Listen:** queue, player (mini-player persistent across tabs), transcript sheet.
- **You:** settings, appearance, notifications/dose time, privacy controls, backup/export, stats digest.
- **Deep-link map (single source of truth):** `infallyn://dose/tonight`, `infallyn://item/{id}`, `infallyn://listen`, `infallyn://capture/{segment}`, `infallyn://stats`.

### 7.3 Visual language

**Two themes, one soul:**

| Token | Reading Room (light) | Night Shelf (dark, default after 19:00) |
|---|---|---|
| `bg` | `#F7F2E9` parchment | `#14120F` warm near-black (OLED variant `#000000`) |
| `surface` | `#FFFDF7` | `#1E1B16` |
| `ink` (text) | `#1F1B16` (15.1:1 on bg) | `#EDE6D8` (13.2:1 on bg) |
| `muted` | `#6E655A` (4.9:1) | `#A79B8A` (6.1:1) |
| `accent` (brass) | `#8C6A3F` | `#D4A85A` |
| `success / go` | `#4C7A5C` fern | `#7FAE8E` |
| `alert / overdue` | `#C25E4C` ember | `#E07856` |
| `info` | `#5B6B8C` dusk | `#93A5C4` |

All text pairs meet WCAG 2.2 AA (≥ 4.5:1 body, ≥ 3:1 large text). The dark theme is *warm-shifted* (low blue content) with an optional extra amber filter during Dose sessions.

**Typography:** display serif **Literata** (OFL) for screen titles, card fronts, and reading surfaces — the "book" voice; **Inter** for UI controls, lists, and meta — the "tool" voice. Dynamic Type / font scaling to 200% must never truncate (layouts reflow, never ellipsize body text). Minimum body size 16 dp.

**Iconography & shape:** 24-dp grid, 1.75-dp rounded strokes; corner radius tokens 8/12/20; cards have soft 2-dp shadows in light theme, hairline `#2A251E` borders in dark; optional subtle paper-grain texture on bg (never on text surfaces, disabled at accessibility reduce-transparency).

**Imagery:** user photos and scans are the heroes — full-bleed, rounded 20, gentle parallax in the Dose gallery; no stock photography anywhere in the product chrome.

### 7.4 Motion

| Token | Value | Use |
|---|---|---|
| `quick` | 150 ms, ease-out | chips, toggles, checkmarks |
| `standard` | 240 ms, ease-in-out | card flip (note card front/back), sheet transitions |
| `emphatic` | 400 ms spring (damped 0.85) | Dose card swipe-off, ring completion, streak flame |
| `ambient` | subtle parallax ±6 px | gallery scroll |

Grading swipes get haptics: light impact on commit, success pattern on ring completion. **All motion honors the OS reduce-motion setting** (cross-fades replace springs; parallax disabled).

### 7.5 Core components (design-system package)

- **ShelfCard / ItemRow:** title, meta chips (due, tag, linked 📎, 🔊 audio-available), swipe actions.
- **DoseCard:** full-bleed media, caption zone, flip affordance, grade bar (Again/Hard/Good/Easy with FSRS interval preview: "Good → 6 d").
- **CaptureSheet:** segmented, smart-parse chips, one-thumb reach (actions in bottom 40%).
- **TrustScreen split view:** synchronized scroll-image pane ↔ text pane; low-confidence underline token `alert@40%`.
- **PlayerBar:** mini persistent bar → full player sheet; transcript toggle; speed pill.
- **RingProgress & StreakFlame:** the two celebratory glyphs; quiet by default (animate on completion only).

### 7.6 Empty, loading & error states (patterns, not afterthoughts)

- **Empty states teach:** each carries one action ("The shelves are bare — add your first note" → capture sheet). Never dead-ends.
- **Loading:** skeleton matches final layout; scanner shows per-page progress; TTS streams first sentence with a "voice warming" shimmer only if > 400 ms.
- **Errors are sentences, not codes:** "This page was hard to read — try more light, or run it through cloud recognition (your page would leave the device)." Every error offers the next step.

### 7.7 Accessibility (target: WCAG 2.2 AA, platform excellence)

- All swipe gestures mirrored by buttons (Dose grading, task swipes).
- VoiceOver/TalkBack: DoseCard reads caption + grade hints; images use user captions or OCR-derived descriptions (prompted at card creation); player announces title/position.
- Contrast, target sizes ≥ 44 pt, focus order, and headings verified in test plans.
- Transcript view for all audio (never audio-only information).
- Reduce motion/transparency/flash effects honored; Dose session offers 200%-type layout (cards paginate instead of shrink).

### 7.8 Widget design guidelines

1. Glanceable in 2 s: **max two data elements** per widget (ring + count; title + progress).
2. Always time-correct: timeline snapshots refreshed at dose completion, task mutation, and midnight; stale states are impossible by design (fallback text "Open Infallyn" if data is unavailable).
3. Every pixel is a tap target with one obvious destination; interactive controls only for play/pause/skip (iOS 17+/Android), everything else deep-links.
4. Both themes rendered from the same tokens; widget previews shown in the picker in the user's current theme.
5. Localized text with truncation-proof layouts (shortest-string test for de/hi/kn).

### 7.9 Tone of voice & microcopy

- Warm, literate, brief — a good librarian, not a gamified assistant.
- Dose invitation: "Tonight's Dose — 16 cards · ≈ 4 min." Completion: "Shelf closed. 16 reviewed · 81% recalled · 6-night streak."
- Permission priming: say why, then ask. Privacy labels: "Stays on this phone" / "Leaves your device once, encrypted."
- Never: shame copy for missed nights ("You broke your streak!"). Instead: "Infallyn was closed yesterday — tonight's shelf is ready."

---

## 8. Analytics & Instrumentation

**Principles:** opt-in (default off), content-free (never note text, titles, or photo content), first-party endpoint, 12-month retention, GDPR & India DPDP-compliant. In-app stats work identically for users who never opt in.

| Event | Properties | Answers |
|---|---|---|
| `capture_created` | type, entry_point (sheet/widget/share/shortcut), parse_success | Is the 5-second rule holding? Which entries matter? |
| `ocr_run` | engine, page_count, duration_ms, avg_confidence_bucket, correction_count_bucket | On-device quality per script/hardware tier |
| `tts_playback` | voice_tier, speed, minutes, background_pct | Listening habit strength |
| `dose_session` | start_hour, card_count, by_kind, duration, rating_mix, completed | Habit loop health; optimal default times |
| `widget_event` | widget_kind, action | Widget value; which to invest in |
| `notification_event` | kind (task/dose), action (open/snooze/dismiss) | Reminder effectiveness; nudge fatigue |
| `retention_daily` | active_day, pillar_touched[] | D30 drivers per pillar |

---

## 9. Privacy & Security Guidelines

1. **Data inventory:** notes/scans/audio (user content, device + optional E2E cloud), review logs (device + E2E sync), telemetry (opt-in, content-free), crash reports (opt-in, scrubbed).
2. **On-device defaults:** OCR, TTS, search, scheduling, and stats all function with airplane mode on. This is a *tested release criterion*, not an aspiration.
3. **Egress labeling:** any feature that sends content off-device shows the once-only "leaves your device" label with a settings kill-switch (cloud OCR, premium voices, sync).
4. **Encryption:** at rest (optional SQLCipher, §3.8), in transit TLS 1.3, sync payloads E2E (server stores ciphertext).
5. **No training on user content. Stated in the policy. Enforced architecturally** (content never reaches training pipelines; cloud OCR vendors contracted with zero-retention terms).
6. **Deletion:** in-app full wipe; server-side deletion propagates to backups within 30 days; export-before-delete offered.
7. **Children/education contexts:** no social surface by design; privacy policy covers student use.

---

## 10. Release Plan & Roadmap

### 10.1 Phases

| Phase | Duration | Scope (exit criteria) |
|---|---|---|
| **P0 — Foundations & prototypes** | 4 wks | Design system, FSRS Dart port + golden tests, scanner/OCR spike on 500-page handwriting corpus, on-device TTS spike; clickable Dose prototype tested with 8 users |
| **P1 — MVP "the loop"** | 10 wks | Pillar 1 complete (LBR-101–112 P0s), Daily Dose core (DOSE-201–208 P0s), basic Due-ring widget (INT-401 static), encrypted local + export; closed beta 200 users |
| **P2 — Signature OCR→Audio** | 6 wks | OCR-301–304, TTS-311–314, share-sheet intake; beta metric gates: OCR accept-rate ≥ 50% handwriting; TTS p95 start < 800 ms |
| **P3 — Smart access & polish** | 4 wks | INT-402–406 interactive widgets/shortcuts, premium voices (TTS-316), stats/streaks, performance hardening to §3.9 budgets |
| **P4 — GA** | 2 wks | Store review, phased rollout 5%→50%→100%, crash-free ≥ 99.7% gate per step |

**Indicative team:** 1 PM, 1 product designer, 2 Flutter engineers, 1 native mobile engineer (widgets/background/media), 0.5 ML engineer, 1 backend (P3 onward). ~26 weeks to GA.

### 10.2 Post-v1 backlog (ordered)

E2E sync across devices (oplog) → doc_snippet region-picker polish + PDF page cards → LLM tidy pass → Wear OS → tablet two-pane → localization (hi, kn + Indic handwriting via cloud) → public API.

### 10.3 Monetization sketch (freemium; final decision = Open Question 1)

- **Free forever:** everything local — tasks/notes/documents, on-device OCR, on-device voices, Daily Dose, widgets, encrypted export. (Generous by design: the habit *is* the product.)
- **Premium (subscription):** premium cloud voices, cloud OCR pack, background E2E sync, stats history > 12 weeks, extra themes/icon sets.

---

## 11. Risks & Mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | OS never grants nightly background time → stale widgets/unbuilt queues | High (iOS especially) | Med | D6 pattern: notification is the trigger; on-open fallback builds queue < 400 ms; widget timeline pre-generated 48 h (§3.4) |
| R2 | Handwriting OCR accuracy below user expectations (cursive, low light) | Med-High | High | Trust screen + confidence UX; personal dictionary; cloud fallback; expectation-setting copy; internal corpus benchmarks as release gates |
| R3 | Habit fails anyway (streaks collapse) → churn | Med | High | 21:30 anchor at onboarding, ≤ 20-card doses, grace nights, morning catch-up, no shame copy (§7.9); measure `dose_session` by hour and adapt defaults |
| R4 | Battery/storage complaints from media-heavy accounts | Med | Med | Opus audio (~0.2 MB/min), HEIC/derived thumbnails, cache ceilings + LRU, GC for orphaned media, sync battery budget ≤ 2%/day |
| R5 | Scope creep (collaboration, web app, "smart everything") | High | Med | Non-goals §1.3; phase gates; backlog discipline (§10.2) |
| R6 | Privacy trust incident (vendor retention, telemetry leak) | Low | Critical | E2E everywhere, zero-retention vendor terms, opt-in content-free telemetry, architectural enforcement (§9.5) |
| R7 | Exact-alarm permission friction (Android 12+) | Med | Low | Priming screen with rationale; inexact fallback still fires within minutes; re-priming after OS updates |
| R8 | Store rejection risk (background/audio/full-screen-intent usage) | Low | Med | Use declared-permission patterns exactly as documented; pre-submit checklist per release |

---

## 12. Open Questions

1. **Monetization:** subscription vs one-time unlock vs tiers (§10.3 is a sketch). Needs pricing research.
2. **Sync substrate (P2):** custom E2E sync service vs iCloud/Drive-only vs both. Affects backend hiring.
3. **Handwriting script priorities:** Latin at launch — order for Devanagari, Kannada, CJK? (ML Kit covers Devanagari/CJK on-device; Kannada likely cloud-only initially.) Matters for launch-market fit.
4. **Accounts:** fully anonymous-local with optional account later, or account-from-sync-on? UX and support implications differ.
5. **LLM tidy pass:** on-device small model vs cloud LLM (cost/privacy trade) — decide at P2 with R6 in mind.
6. **Name collision/trademark check** for "Infallyn" in both app stores; prepare fallback names if needed.

---

## Appendix A — Notification Specification

| Notification | Default trigger | Channel (Android) / Thread (iOS) | Actions | Quiet-hours behavior |
|---|---|---|---|---|
| Task reminder | per ReminderRule | `tasks` / thread per shelf | Complete · Snooze (1 h, tonight, tomorrow) | Suppress if quiet hours unless task marked urgent |
| Due-soon | due_at − 30 min (config) | `tasks` | Same as above | Suppressed by default |
| Nightly Dose | user-set (default 21:30) | `dose` — high priority, bypasses DND **only** if user opts in | Start · +45 min | Re-nudge once at 22:15 if enabled |
| Streak rescue | 22:15 same night, if unstarted | `dose` | Start | Never re-fires after first |
| Weekly digest | Sunday 20:00 (opt-in) | `digest` | Open digest | Suppressed |
| Playback continue | idle 3 days (opt-in, off by default) | `playback` | Resume | Suppressed |
| Scan completed | background batch done | `progress` (silent) | Open note | Silent delivery |

## Appendix B — Scheduling Math (FSRS & Dose Sizing)

- FSRS memory model: power-law forgetting curve `R(t) = (1 + t/(9·S))^(-1)` (S = stability); ratings update S and difficulty D; intervals solve `R = desired_retention`. Defaults: retention 0.90, learning steps (1 m, 10 m), max interval 365 d.
- Dose time estimate: `photo ≈ 6 s`, `note_card ≈ 10 s`, `doc_snippet ≈ 8 s` → default 20-card mixed dose ≈ 3–5 min. Invitation copy rounds to nearest minute.
- Load balancing: if projected 7-day load exceeds cap × 7, FSRS fuzzing (±5% intervals) plus new-card throttle prevents spike pile-ups.
- Tuning: after ≥ 1,000 reviews per user, optional FSRS parameter optimization runs on-device from `ReviewLog` (no data leaves the phone).

## Appendix C — Glossary

| Term | Meaning |
|---|---|
| **Daily Dose** | The nightly review session; also shorthand for the queued set of due cards |
| **Shelf** | A user collection (folder) in the Infallyn |
| **Trust screen** | OCR correction split view (image ↔ text) |
| **Memory card** | A ReviewCard created from a photo |
| **Note card** | A ReviewCard created from a note (front = title/first lines, back = full note) |
| **FSRS** | Free Spaced Repetition Scheduler — open scheduling algorithm (Anki-adopted) |
| **CER** | Character Error Rate — OCR accuracy metric |
| **Oplog** | Append-only operation log used for E2E sync |
| **Night Shelf / Reading Room** | Dark / light themes |

---

*End of specification — v1.0. Feedback welcome via comments on this document; decision log (§3.10) and open questions (§12) are the live sections.*
