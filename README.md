# Outline Sync for Obsidian

Two-way sync between an Obsidian vault and an [Outline](https://www.getoutline.com/)
wiki. Each Outline collection is mirrored into a vault folder; edits flow both
ways, and when both sides changed the same document the plugin asks which
version wins instead of picking one.

## How it decides what to do

Outline gives every document a monotonic `revision` counter. The plugin records,
per document, the revision and the body hash from the last time local and remote
agreed — the merge base. Every sync compares three things:

| local vs base | remote vs base | action |
| --- | --- | --- |
| same | same | nothing |
| changed | same | push to Outline |
| same | changed | pull into the vault |
| changed | changed | **conflict** — ask, or apply the configured policy |

Nothing is overwritten on the strength of a timestamp unless you explicitly
choose the "keep whichever was edited last" policy.

### Conflicts

The default is to ask. You get a diff of your note against Outline's version and
four choices: keep local, keep Outline, keep both (your note is pushed and
Outline's version is saved beside it as `Note (Outline 2026-09-07 14-32).md`), or
decide later. Deciding later changes nothing and raises the same question next
time.

### What is not protected

`documents.update` has no compare-and-swap, so a push is check-then-write: the
plugin reads the revision immediately before writing and refuses if it moved. A
write that lands during that window is detected afterwards (the revision jumps by
more than one) and reported, and the overwritten text remains in the document's
history in Outline. Practically: avoid having a document open in the Outline
editor while editing the same note locally.

## Layout

```
Vault/
  Engineering/                  ← one mapped collection
    Handbook.md                 ← a document
    Handbook/                   ← its child documents
      Oncall.md
  Outline Attachments/
    1b9a2c3d-….png              ← images pulled from Outline
```

Documents are identified by an `outlineId` in the note's frontmatter, so renaming
or moving a note in Obsidian does not break the link — a rename retitles the
document in Outline.

## Install

There is no community-plugin listing; install by copying the build output.

```bash
npm install
npm run build          # produces main.js
```

Then copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/outline-sync/` and enable it under
Settings → Community plugins.

For a fleet, ship those three files with your MDM or a small script; the plugin
folder is the whole install.

## Setup

1. In Outline: Settings → API → create a personal API key. It acts as you and
   inherits your collection permissions, so each person uses their own.
2. In Obsidian: Settings → Outline Sync → paste the URL and token → **Connect**.
3. Toggle on each collection you want and name its folder.

Everyone gets their own token, so everyone's vault mirrors exactly what they can
already see in Outline.

## Settings worth knowing

- **Check Outline every** — how often to poll for other people's edits. Local
  edits do not wait for this; they push a few seconds after you stop typing.
- **When both sides changed** — leave on "Ask me" unless you have a reason.
- **Delete Outline document when the note is deleted** — off by default.
  Deleting a note locally otherwise removes it for the whole team; with it off,
  the note is simply downloaded again on the next sync.

## Known limits

- Markdown is lossy in one direction: Outline stores rich text, so comments,
  highlights and table column widths do not survive a push that rewrites a
  document. Pulls are unaffected.
- Obsidian's `[[wikilinks]]` are not Outline links. Turn off wikilinks
  (Settings → Files and links) if you want links to survive the trip. Image
  embeds (`![[image.png]]`) are converted to Outline attachments on push.
- Drafts (unpublished documents) are not synced.

## Development

```bash
npm run dev     # rebuild on change
npm test        # pure + engine tests, no network
OUTLINE_URL=https://outline.example.com OUTLINE_API_TOKEN=ol_api_… npm run test:live
```

`npm test` runs against an in-memory vault and a fake Outline, and covers the
reconcile matrix, conflict resolution, nesting, renames and deletions.
`test:live` is read-only and only checks that a real install answers the way the
client expects.
