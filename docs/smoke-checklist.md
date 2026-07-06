# Manual Smoke Checklist (Local Unpacked Build)

Date: 2026-06-25

This checklist verifies the wired extension end-to-end against real Chrome,
`chrome.identity`, Google Drive, and the Chrome Built-in AI / Prompt API. It is
executed by a developer with a **development** OAuth client; it is not run in a
headless/CI session. See [`publication.md`](publication.md) for the OAuth/setup
background and [`design.md`](design.md) "Save Flow" for the intended behavior.

## Prerequisites

1. A Google Cloud project with the **Google Drive API** enabled and an OAuth
   consent screen configured (see `publication.md` "Development Setup").
2. A **development** OAuth client of type *Chrome Extension*, created against the
   local unpacked extension ID (see below).
3. `.env.local` containing your dev client ID:

   ```env
   VITE_GOOGLE_OAUTH_CLIENT_ID=<your-dev-id>.apps.googleusercontent.com
   ```

4. A Chrome channel where the Prompt API can be enabled (for the AI-available
   path). The AI-unavailable path is checkable on any channel.

> Note: the first AI run may require Chrome to download its on-device Built-in
> AI / Prompt API model. Keep the popup or options page open while setup runs.
> If download progress appears stuck for a long time, fully restart Chrome and
> try again. This is Chrome preparing its local model; Bookmark AI does not send
> page excerpts, prompts, bookmark data, raw AI output, OAuth tokens, or Drive
> payloads to an external AI provider.

## Obtaining the local unpacked extension ID

The dev OAuth client is bound to the extension ID, so this is a chicken-and-egg
step:

1. `bun run build` (with any non-empty `VITE_GOOGLE_OAUTH_CLIENT_ID`, e.g. the
   dummy value below) to produce `dist/`.
2. Load `dist/` via `chrome://extensions` → Developer mode → **Load unpacked**.
3. Copy the generated **extension ID** from that page.
4. Create/point the dev OAuth client at that ID, put the real client ID in
   `.env.local`, then `bun run build` again and reload the unpacked extension.

> Tip: to keep the unpacked ID stable across machines you can later add a
> manifest `key` (see `publication.md` "Stable Local Extension ID Option"). Not
> required for the MVP smoke path.

A dummy build env is fine for steps that do not exercise real OAuth (e.g. just
confirming the bundle loads and the manifest is correct):

```sh
VITE_GOOGLE_OAUTH_CLIENT_ID=dummy.apps.googleusercontent.com bun run build
```

## Checklist

### 1. Sign-in (OAuth)

- [ ] Open the popup on a normal web page and click **Save**.
- [ ] The first save triggers the Google OAuth consent screen requesting
      **only** `drive.file` (`See, edit, create, and delete only the specific
      Google Drive files you use with this app`).
- [ ] After granting, the popup connection badge reads **connected** on next
      open (the badge probe is non-interactive and never re-prompts).

### 2. Drive folder/file creation

- [ ] In Google Drive (My Drive), a visible folder **`bookmark-ai/`** is created.
- [ ] It contains **`bookmarks.jsonl`** with one JSON line for the saved page.
- [ ] The record has `url`, `canonicalUrl`, `title`, timestamps, and an
      `aiStatus`. It contains **no** raw page excerpt.

### 3. Save page (AI available)

- [ ] With the Prompt API available, saving a page walks the receipt trail:
      **saving → extracting → analyzing → syncing** (genuine per-stage progress).
- [ ] If Chrome reports the local model as `downloadable` or `downloading`, the
      popup shows model setup/download progress, then continues analysis once
      Chrome finishes preparing the model.
- [ ] The receipt shows a `description`, a `genre`, and `tags` in the browser
      UI language (Japanese or English, auto-selected; MIK-033), and the
      record's `aiStatus` is `ready`.

### 4. Prompt API unavailable behavior

- [ ] In a Chrome where the Prompt API is unavailable, the popup AI badge reads
      **unavailable**.
- [ ] Saving still succeeds: the bookmark is written with `aiStatus`
      **unavailable** (the `analyzing` step is shown as skipped), and the record
      is still synced to Drive.

### 5. Options: list / search / delete — and popup re-analyze

- [ ] Open the options page; saved bookmarks render from cache, then **Sync
      Drive** in the app-header sync hub pulls the authoritative list from
      Drive.
- [ ] **Search** by title/URL/tag narrows the list; clearing restores it.
- [ ] Genre/tag/status **filters** narrow the list and combine with search.
- [ ] **Delete** removes the row from the list and an action banner remains
      visible even if the active filter then matches no rows.
- [ ] **Re-analyze** on a non-`ready` record from the **popup's recent list**
      (the Options UI offers no re-analyze action, MIK-024), **while that page
      is the active tab in the current window**, re-extracts and updates the
      record. From an unrelated active tab it returns a safe "open the page in
      the active tab" error rather than reaching for a tab the extension was
      not granted.
- [ ] In **Ask AI**, if Chrome reports the model as `downloadable` or
      `downloading`, the chat shows an assistant setup card with spinner and
      progress; once setup completes, Ask AI can produce AI-ranked answers while
      preserving local fallback behavior if setup fails.

### 6. Unsynced local mutations survive Drive failure (MIK-014)

- [ ] With Drive made unavailable (e.g. offline, or revoke the token), **Delete**
      a bookmark in options. The row disappears and the app-header sync hub shows
      **Local changes pending — will retry on next sync** (the popup shows a
      `Local: changes pending` badge).
- [ ] Click **Sync Drive** while still offline: the deletion is **not** resurrected
      and the pending indicator remains.
- [ ] Restore Drive connectivity and **Sync Drive** again: the pending indicator
      clears, the deletion is now written to `bookmarks.jsonl` as a tombstone, and
      it stays deleted on a subsequent sync. The same holds for a save/re-analyze
      performed while Drive was unavailable (the record is pushed, not lost).

## Run record

Record each real run here. Do not mark a row **PASS** unless the step was
actually exercised against real Chrome + a dev OAuth client. Leave AI-available
rows as **N/A** when run on a channel without the Prompt API.

| Date | Section | Result | Notes |
|---|---|---|---|
| 2026-06-25 | 1. Sign-in (OAuth) | NOT EXECUTED | MIK-010 QA ran in a headless agent session with no interactive Chrome and no dev OAuth client. |
| 2026-06-25 | 2. Drive folder/file creation | NOT EXECUTED | Requires real `drive.file` token; see above. |
| 2026-06-25 | 3. Save page (AI available) | NOT EXECUTED | Requires a Chrome channel with the Prompt API enabled. |
| 2026-06-25 | 4. Prompt API unavailable behavior | NOT EXECUTED | Requires loaded unpacked extension. |
| 2026-06-25 | 5. Options: list / search / delete / re-analyze | NOT EXECUTED | Requires loaded unpacked extension with saved records. |

> MIK-010 status: automated validation (`just validate`, `just hooks-run`,
> dummy-OAuth `bun run build` + `dist/manifest.json` inspection) passed and the
> architecture/privacy/publication review found no MVP-blocking issue. The manual
> smoke pass above remains a **required human QA step** before Chrome Web Store
> submission; it is not executable in a headless agent session and is carried as
> follow-up rather than a blocker for closing the automated QA scope of MIK-010.

## Notes / known limitations

- Re-analysis uses `activeTab` + `scripting` only, so it works from the page's
  own tab (popup) but not for an arbitrary record opened from the options page in
  a different tab. This is intentional to keep permissions narrow (no `tabs`
  permission). Re-analyze from the page itself, or save it again.
- Deleting a bookmark writes a deletion **tombstone** to Drive (and the local
  cache), so the deletion is durable: a later `Sync Drive`, or a sync from another
  device that still holds the record, does **not** resurrect it. The one
  intended exception is when another device has a *strictly newer* explicit
  update for the same URL, which wins by the documented delete-vs-update rule
  (see `docs/design.md` "Delete vs. update conflict rules"). Tombstones are not
  pruned in the MVP, so the JSONL file retains one line per past deletion.
- A local mutation (delete/save/update/re-analyze) made while Drive is
  unavailable is kept in the cache and flagged **pending**; a later `Sync Drive`
  re-pushes it rather than overwriting it with the remote state, so it is not
  silently lost and is written to Drive once it recovers (see `docs/design.md`
  "Preserving unsynced local mutations"). The MVP has no background retry queue,
  so the push happens on the next user-triggered sync/save, not automatically in
  the background. A cache written by a pre-MIK-014 build that recorded only a
  sync error (no pending flag) is treated as a plain pull; the flag is set again
  on the next mutation.
