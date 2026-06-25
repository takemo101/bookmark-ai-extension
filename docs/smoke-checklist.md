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
- [ ] The receipt shows a Japanese `description`, a `genre`, and `tags`, and the
      record's `aiStatus` is `ready`.

### 4. Prompt API unavailable behavior

- [ ] In a Chrome where the Prompt API is unavailable, the popup AI badge reads
      **unavailable**.
- [ ] Saving still succeeds: the bookmark is written with `aiStatus`
      **unavailable** (the `analyzing` step is shown as skipped), and the record
      is still synced to Drive.

### 5. Options: list / search / delete / re-analyze

- [ ] Open the options page; saved bookmarks render from cache, then a `Sync now`
      pulls the authoritative list from Drive.
- [ ] **Search** by title/URL/tag narrows the list; clearing restores it.
- [ ] Genre/tag/status **filters** narrow the list and combine with search.
- [ ] **Delete** removes the row from the list and an action banner remains
      visible even if the active filter then matches no rows.
- [ ] **Re-analyze** on a non-`ready` record, **while that page is the active tab
      in the current window**, re-extracts and updates the record. From an
      unrelated active tab it returns a safe "open the page in the active tab"
      error rather than reaching for a tab the extension was not granted.

## Notes / known limitations

- Re-analysis uses `activeTab` + `scripting` only, so it works from the page's
  own tab (popup) but not for an arbitrary record opened from the options page in
  a different tab. This is intentional to keep permissions narrow (no `tabs`
  permission). Re-analyze from the page itself, or save it again.
- Deleting a bookmark updates the local cache and is written to Drive, but the
  MVP repository merges by union of canonical URLs, so a subsequent `Sync now`
  from another device that still has the record can resurrect it. Durable
  cross-device deletion needs a repository tombstone capability (out of scope).
