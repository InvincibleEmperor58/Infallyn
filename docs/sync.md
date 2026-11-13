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
3. **Authentication → Providers → Email**: enable it. For the 6-digit code
   flow keep *Confirm email* on; Supabase mails the `{{ .Token }}` value.
4. **Project Settings → API**: copy the **Project URL** and the **anon public**
   key.
5. In Infallyn → **You → Sync** → paste both → **Save project**.
6. **Email me a code** → enter the 6 digits → **Verify**.
7. Choose a **sync passphrase** → **Connect this device**.
8. On the phone: same URL, same e-mail, same sync passphrase. Done.

The anon key and URL are stored in that browser's `localStorage` only; nothing
project-specific is committed to the repo.

## 7. Test status

`/tmp` harness (jsdom + in-memory Supabase): two independent device contexts —
separate `localStorage` and separate IndexedDB factories — exchanging through a
mocked REST + Storage API. Covers: account creation on both devices, space
creation vs joining, key unwrap with the right/wrong passphrase, item + card +
review propagation both ways, tombstone/delete propagation, photo round-trip,
and conflict resolution by `lww`.

Still to do against a real project: RLS enforcement under the anon key, the
OTP e-mail template, storage policy edge cases, and multi-thousand-row paging.
