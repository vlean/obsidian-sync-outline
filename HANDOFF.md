# Handoff: Outline Sync for Obsidian

Written 2026-09-07 from the VM session that built this. Intended reader: a
Claude Code session on a Mac that will test the plugin for the first time.

---

## 1. Background

**Outline** is a self-hosted team wiki (open source, Node + Postgres + Redis).
Documents live in *collections*, can nest arbitrarily, and are stored as
ProseMirror rich text with a markdown-compatible API. We run it at
`https://outline.apps.mugyen.com`, version **1.8.1**, as a Docker Compose stack
on the VM (`~/apps/outline/deploy/`), behind the host's Caddy. Four users, one
collection ("Mugyen"), three documents at time of writing.

**The goal.** People on the team keep notes in Obsidian vaults on their Macs.
We want those vaults and the Outline wiki to be the same content: edit in either
place, and the change shows up in the other — like Google Drive, not like a
one-way export. When the same document was edited in both places, the plugin
must say so and ask which version wins, rather than silently picking one.

**Why a plugin rather than a CLI.** Obsidian only loads TypeScript/JavaScript
plugins, and the sync should follow the person's editing rather than a cron
timer. Existing tools were surveyed and rejected:

- `kingston/outline-sync` (npm, TS) — manual `download`/`upload` commands, no
  reconciliation, no conflict detection, pulls in LangChain + faiss. We reused
  its useful discoveries (see §3) and none of its code.
- `gmiles32/obsout` (Python) — closest in spirit, but flat-only (the author
  states nested documents are unimplemented) and its sync is "newer mtime wins,
  older file overwritten", which is silent data loss.

---

## 2. What exists now

A complete, compiling, unit-tested Obsidian plugin at:

```
/home/vedantvijay/apps/outline-obsidian        (on the VM)
```

~1,700 lines of source, ~800 of tests, no runtime dependencies. The build
output is a single 33 KB `main.js`.

**It has never been run inside Obsidian.** That is the whole point of this
handoff — see §7.

---

## 3. How it works

### Identity and change detection

Outline gives every document a monotonically increasing integer `revision`.
This was the key discovery that made the design possible — verified on our
instance: `documents.info` and `documents.list` both return it, and
`documents.list` also returns full `text`, so one API call per 100 documents
fetches an entire remote snapshot.

The plugin stores, per document, the state at the last moment local and remote
agreed — the **merge base**:

- `baseRevision` — Outline's revision then
- `baseHash` — hash of the local note body then
- `path`, `title`, `collectionId`

That base is what lets it tell "I changed this" from "they changed this":

| local vs base | remote vs base | action |
| --- | --- | --- |
| same | same | nothing |
| changed | same | push to Outline |
| same | changed | pull into the vault |
| changed | changed | **conflict** → ask the user |

Sync state lives in the plugin's `data.json`, deliberately **not** in the notes:
writing sync metadata into a file would fire Obsidian's `modify` event and the
plugin would chase its own writes. Only `outlineId` and `outlineUrl` go into
frontmatter, and only when a document is first linked.

### The one race we cannot close

`documents.update` accepts no revision parameter — there is no server-side
compare-and-swap. A push is therefore check-then-write: read the revision
immediately before writing, refuse if it moved. If someone writes *inside* that
window, the plugin notices afterwards (the returned revision jumped by more than
one), and reports that the overwritten text is recoverable from the document's
history in Outline. It cannot prevent it. Practical advice: don't sit in the
Outline browser editor on a document you're also editing locally.

### Vault layout

```
Vault/
  Mugyen/                        ← one mapped collection
    Handbook.md                  ← a document
    Handbook/                    ← its child documents
      Oncall.md
  Outline Attachments/
    1b9a2c3d-….png               ← images pulled from Outline
```

Nesting uses the Obsidian folder-note convention (`Parent.md` beside `Parent/`)
rather than `index.md`, because it reads better in the file explorer.

### Things learned from reading Outline's own behaviour

- Images inside document text look like
  `![alt](/api/attachments.redirect?id=<uuid>)`. On pull these are downloaded
  and rewritten to local paths; on push, local images are uploaded via
  `attachments.create` (pre-signed POST) and rewritten back.
- Downloaded attachments are named `<attachmentId>.<ext>`, so a file's identity
  is recoverable from its name on the next push.
- Obsidian's `![[embed.png]]` syntax is converted to a standard Outline
  attachment link on push. `[[wikilinks]]` for documents are **not** translated —
  Outline renders them as literal text.
- HTTP must go through Obsidian's `requestUrl`, not `fetch`: plugins run on an
  `app://` origin and Outline sends no CORS headers for it.

---

## 4. File map

```
apps/outline-obsidian/
  manifest.json              plugin id "outline-sync", minAppVersion 1.0.0
  package.json               scripts: dev, build, test, test:live
  esbuild.config.mjs         bundles src/main.ts → main.js
  styles.css                 conflict modal styling, theme-aware
  README.md                  user-facing docs
  HANDOFF.md                 this file

  src/
    main.ts            (288)  plugin lifecycle, vault events, debounce, polling,
                              commands, status bar
    types.ts           (113)  settings, SyncRecord/SyncState, RemoteDocument
    outline/client.ts  (280)  Outline API over requestUrl; multipart builder for
                              attachment upload
    sync/engine.ts     (626)  THE CORE. Snapshot → scan → reconcile → apply.
                              Conflict construction, attachment materialisation,
                              self-write suppression
    sync/markdown.ts   (237)  frontmatter parse/write, body hashing, attachment
                              link rewriting both directions
    sync/paths.ts       (70)  title → safe filename, document tree → vault path
    sync/state.ts       (67)  the sync index (merge bases)
    sync/diff.ts        (91)  LCS line diff for the conflict modal
    ui/conflict-modal.ts(138) "which version wins" dialog with diff
    ui/settings-tab.ts (276)  connection, collection→folder mapping, policies

  test/
    pure.test.ts       (207)  25 tests, no Obsidian needed
    engine.test.ts     (473)  24 reconcile scenarios against a fake vault
    fake-vault.ts       (82)  in-memory Vault + FileManager + metadataCache
    obsidian-stub.ts    (27)  minimal Obsidian module for tests
    obsidian-live-stub.ts(29) same, but requestUrl really hits the network
    live.test.ts        (49)  read-only checks against a real Outline
  scripts/run-tests.mjs       bundles each suite with esbuild, runs it
```

---

## 5. Getting it onto the Mac

The directory is **not a git repository** — the VM session was asked not to
commit anything unprompted. Pick one:

```bash
# From the Mac, straight copy (excludes build junk):
rsync -av --exclude node_modules --exclude main.js \
  <vm-host>:apps/outline-obsidian/ ~/dev/outline-obsidian/

# Or turn it into a repo on the VM first and clone it.
```

Then:

```bash
cd ~/dev/outline-obsidian
npm install          # 17 dev dependencies, nothing at runtime
npm run build        # → main.js
npm test             # 49 tests, offline
```

Built and tested on Node v24.14.1 / npm 11.11.0.

---

## 6. Installing into Obsidian

```bash
mkdir -p "<vault>/.obsidian/plugins/outline-sync"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/outline-sync/"
```

Enable under Settings → Community plugins (turn off Restricted Mode first).
Those three files are the entire install.

Then Settings → Outline Sync:

1. **Outline URL** — `https://outline.apps.mugyen.com` (no `/api`)
2. **API token** — create your own in Outline under Settings → API. It acts as
   you and inherits your collection permissions. Do not reuse someone else's.
3. Click **Connect** — it should report the authenticated name and list
   collections.
4. Toggle on a collection and set its vault folder.

---

## 7. Test plan — what this handoff is asking for

Everything below §7.1 is **unverified**. The plugin compiles against the real
Obsidian 1.13.1 type definitions and its logic is tested against stubs, but
stubs are not the app.

### 7.1 Already verified on the VM

- `npm test` — 49 tests pass. Covers the full reconcile matrix, all four
  conflict resolutions, unresolved-conflict-reappears, new note → new document,
  notes outside mapped folders untouched, rename → retitle, remote delete →
  local trash, local delete → note restored (nothing deleted remotely),
  child nesting, stale-write refusal, self-write suppression.
- The tests were mutation-checked: forcing `remoteChanged = false` fails 5 of
  them, so they are not vacuous.
- `npm run test:live` against the real instance — authenticated, listed 1
  collection / 3 documents, confirmed every document carries `revision` and
  `text`, and that `documents.info` agrees with `documents.list` on revision.
  **Read-only. No write has ever touched the live wiki.**

### 7.2 Please test, roughly in this order

Use a **scratch collection** in Outline (create one called `Sandbox`) and a
**throwaway vault**. Do not point the first run at the real Mugyen collection.

1. **It loads.** Enable the plugin; no console errors. Settings tab renders.
2. **Connect.** Token accepted, collections listed. Bad token → readable error.
3. **First pull.** Map `Sandbox` to a folder. Sync. Documents appear as notes
   with `outlineId` frontmatter. A second sync reports "already up to date" and
   makes no API writes.
4. **Push.** Edit a note, wait ~3s. Change appears in Outline. Status bar
   updates. Critically: the plugin must *not* immediately re-pull its own push
   into an edit loop.
5. **Pull.** Edit a document in the Outline browser UI. Within the poll interval
   the note updates locally, with no spurious conflict.
6. **Conflict.** Edit a note locally *and* the same document in the browser,
   without letting a sync run between. Next sync should open the modal with a
   correct diff. Try each of: keep local, keep Outline, keep both, decide later.
   After each, the following sync should be quiet.
7. **New note.** Create a note in the mapped folder → becomes a document in
   `Sandbox`, and gains `outlineId`.
8. **Rename.** Rename a note → document retitled in Outline.
9. **Nesting.** Make a child document in Outline → arrives at
   `Parent/Child.md`.
10. **Images.** Paste a screenshot into a note (filenames with spaces are the
    interesting case — that bug was already found and fixed once) → it should
    upload and render in Outline. And an image added in Outline should download
    into `Outline Attachments/`.
11. **Deletes.** Delete a document in Outline → local note trashed. Delete a
    note locally → it should come *back* on the next sync, and nothing should be
    deleted in Outline.

### 7.3 Highest-risk areas, worth extra suspicion

- **Event loops.** `SyncEngine.isSelfWrite` suppresses the `modify` event caused
  by the plugin's own write, one-shot per write. If Obsidian coalesces or
  reorders events differently than expected, this could loop. Watch for repeated
  API writes with no user edits.
- **The debounce path.** `main.ts` builds the debouncer once at load using the
  then-current setting; changing the debounce in settings does not rebuild it
  until reload. Minor, but confirm the behaviour.
- **`fileManager.renameFile` during a pull.** Used when a document is retitled
  remotely. Untested against the real API — it may fire vault events mid-sync.
- **Attachment upload.** The multipart body is hand-assembled because
  `requestUrl` takes no `FormData`. Never exercised against a real server. Note
  our instance uses `FILE_STORAGE=local`, so uploads go to Outline's own
  endpoint with a bearer header; the S3 path (no auth header) is untested by
  definition.
- **Large documents.** Everything is whole-document; no chunking. The LCS diff
  falls back to a summary above ~4M line-pairs but has not been exercised.

---

## 8. Known limits, by design

- **Markdown is lossy toward Outline.** Outline stores rich text; a push that
  rewrites a document drops what markdown cannot express — inline comments,
  highlights, table column widths. Pulls are unaffected. This is inherent to
  syncing markdown against a ProseMirror store, not a bug to fix.
- **`[[wikilinks]]` don't translate.** Turn wikilinks off in Obsidian
  (Settings → Files and links) if links should survive the trip.
- **Drafts are not synced** (unpublished Outline documents).
- **No realtime.** Polling, not websockets. Outline is collaborative in the
  browser; the plugin is not a participant in that.

---

## 9. Operational notes about our Outline

- Deploy: `~/apps/outline/deploy/` on the VM — `docker compose` with
  `deploy-outline-1` (bound to `127.0.0.1:8007`), `deploy-postgres-1`,
  `deploy-redis-1`. Public via the host Caddy at `/etc/caddy/Caddyfile:157`.
- Auth is OIDC only, via our authentik at `outline.apps.mugyen.com`.
- `FILE_STORAGE=local`, uploads capped at 250 MB, stored at
  `deploy/data/outline` — single host, no redundancy. Worth moving to
  S3-compatible before people treat the wiki as a file store.
- API tokens expire 30 days after creation by default; two existed at time of
  writing, both unscoped admin, both expiring 2026-10-06. Outline supports
  scoped keys — a read-only key is the right choice for anything automated.
- **Do not paste an API token into this repo or a chat log.** The VM's token
  lives in `~/.claude.json` and is admin + unscoped.
