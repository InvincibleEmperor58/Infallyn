# Infallyn — cross-device sync (Supabase)

Status: **engine implemented, awaiting a live project.** The client, schema and
tests exist; the round-trip has only been exercised against a mock Supabase
API (this sandbox cannot reach `*.supabase.co`).

---

## 1. Why a server at all

Infallyn's accounts, vaults and photos live in the browser that created them
(`localStorage` + IndexedDB). Nothing is shared between devices, so a second
device starts empty — that is by design, not a bug. Sync adds a **transport**,
not a source of truth: the local database stays authoritative, and the app
still works fully offline.

## 2. Threat model

| Party | Can see | Notes |
|---|---|---|
| Supabase (DB owner, backups, SQL console) | ciphertext, row sizes, timestamps, e-mail address | cannot read notes, cards or photos |
| Network | TLS 1.3 only | payloads are already ciphertext |
| Someone with your anon key | nothing — RLS scopes rows to `auth.uid()` | anon key is public by design |
| Someone with your **sync passphrase** | everything | treat it like the vault passphrase |
| Someone with your unlocked device | everything | same as today |

The server never receives: the sync passphrase, the space key unwrapped, or any
plaintext. `PBKDF2(150k, SHA-256)` → AES-256-GCM, same primitives as the vault.

## 3. Key model

```
spaceKey      random 32 B, generated on the first device
kdf_salt      random 16 B, public (spaces.kdf_salt)
wrapKey       PBKDF2(syncPassphrase, kdf_salt, 150k)
key_wrap      AES-GCM(spaceKey, wrapKey)        -> spaces.key_wrap (server)
local wrap    AES-GCM(spaceKey, vaultKey)       -> this browser only
```

* **First device**: generates `spaceKey`, uploads `kdf_salt` + `key_wrap`.
* **Second device**: signs in with the same e-mail, enters the same sync
  passphrase once → derives `wrapKey`, unwraps `spaceKey`, re-wraps it with
  *its own* vault key. After that, unlocking the local account is enough.
* A different passphrase fails to unwrap → *"That sync passphrase does not
  open this space."* There is no recovery, same as the vault.

## 4. Data model

`supabase/schema.sql` creates three tables + a private storage bucket:

| Table | Row | Contents |
|---|---|---|
| `spaces` | per user | `kdf_salt`, `key_wrap` |
| `entities` | per syncable object | `kind`, `id`, `lww`, `deleted`, `payload` = sealed JSON |
| `media` | per photo | `media_id`, `lww`, `mime`, `iv`, `bytes`, `storage_path` |
| bucket `infallyn-media` | per photo | AES-GCM ciphertext at `<uid>/<mediaId>` |

Entity kinds: `item`, `card`, `review` (keyed `cardId:at`), `session` (keyed by
day), `settings`, `shelves`, `flags`, `meta` — i.e. the whole `S` state.

RLS: `owner = auth.uid()` on all three tables, and storage objects are scoped by
the first path segment. One e-mail = one space; there is no sharing between
different e-mails (that would need a membership table).

## 5. Protocol

1. **Auth** — `POST /auth/v1/otp` (create_user), then
   `POST /auth/v1/verify {type:'email', token}` → JWT + refresh token.
   Tokens stored locally; refreshed automatically 30 s before expiry.
2. **Pull** — `GET /rest/v1/entities?order=lww.asc` (1 000/page). A row is
   applied only when its `lww` is newer than the local clock for that key;
   deleted rows remove the entity locally.
3. **Push** — the client projects `S` into entities, hashes each
   (canonical JSON), and uploads anything new or changed, plus tombstones for
   keys that vanished. `lww = max(now, remoteLww + 1)` keeps the clock
   monotonic across devices and clock skew.
4. **Media** — referenced media ids are sealed with the space key and upserted
   to storage (`x-upsert: true`), then a `media` row records `iv` + mime.
   Downloads do the reverse and land back in the local encrypted media store.
5. **Triggers** — on boot (after 2.5 s), on `visibilitychange`, every 2 min,
   and manually via **Sync now**.

### Conflicts
Per-entity **last-writer-wins** on the `lww` clock. Reviews are append-only
(`cardId:at` keys), so they merge instead of conflicting. `settings` merges
shallowly, so a theme change on one device does not wipe another's dose time.

### Known limits (v1)
- No history: the loser of a conflict is discarded, not recoverable.
- Entity rows are pulled in full each sync (fine at thousands of rows;
  cursoring by `lww` is the next optimisation).
- Photos cap at 12 MB each; larger ones are skipped and reported in the count.
- A user's space is personal — no sharing, no per-shelf ACLs.

## 6. Enabling it (5 minutes)

1. Create a project at <https://supabase.com> (free tier is enough).
2. **SQL Editor** → paste `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: make sure the Email
   provider is enabled.
4. **Authentication → URL Configuration**: set **Site URL** to your app URL
   (`https://invincibleemperor58.github.io/Infallyn/`) and add the same value
   under **Redirect URLs**. Without this the e-mailed link points at localhost.
5. **Authentication → Email Templates → Magic Link** — either leave it as a
   link (Infallyn adopts the `#access_token=…` fragment when it opens) or add a
   line `Code: {{ .Token }}` to the template, which enables the 6-digit box.
6. **Project Settings → API**: copy the **Project URL** and the **anon public**
   key.
7. In Infallyn → **You → Sync** → paste both → **Save project**.
8. **Email me a code** → open the link on that device *or* type the 6 digits →
   **Verify & sign in**.
9. Choose a **sync passphrase** (min 6 chars) → **Connect this device**.
10. On the phone: same URL, same e-mail, same sync passphrase. Done.

Both e-mail styles work: the link signs the device in when it opens (tokens in
the URL fragment are adopted, then stripped from the address bar), and the code
box works when the template includes `{{ .Token }}`.

The anon key and URL are stored in that browser's `localStorage` only; nothing
project-specific is committed to the repo.

## 7. Test status

`/tmp` harness (jsdom + in-memory Supabase): two independent device contexts —
separate `localStorage` and separate IndexedDB factories — exchanging through a
mocked REST + Storage API.

**14/14 sync checks** — space created on A, B joins without creating a second
space, B adopts the existing space instead of pushing duplicate samples
(`A=9 B=9 dupes=0`), items flow both ways, photo uploaded and decrypted
byte-identically on B while the storage object is ciphertext, deletes propagate
as tombstones, newer edit wins, a wrong passphrase is refused, every row is
owned by the signed-in user.

**12/12 UI checks** — panel states in order, invalid project URL refused with a
hint, `/auth/v1/otp` actually called, bad code surfaces an error, project
survives a re-render, clearing returns to the setup form.

**4/4 magic-link checks** — token fragment adopted, e-mail read back via
`/auth/v1/user`, tokens stripped from the address bar, panel advances to the
passphrase step.

**Self-tests unchanged at 8/10**; the two failures (`queue: cap + interleave
new`, `streak: grace night bridges one gap/week`) are pre-existing.

The sync suite is run **six times back to back** — repeating it is what exposed a
genuine race: `seededAt` was stamped at the *start* of seeding, so an item
created a millisecond later looked like real user content and blocked adoption
(8 duplicate samples). It is now stamped after seeding, with a 5 s tolerance.

Still to do against a real project: RLS enforcement under the anon key, the
OTP e-mail template, storage policy edge cases, and multi-thousand-row paging.
