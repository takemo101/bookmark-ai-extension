# Bookmark AI Extension Design

Date: 2026-06-24

## Purpose

Bookmark AI Extension is a Chrome extension for saving the current tab as an AI-enriched bookmark. Bookmarks are stored in the user's own Google Drive as portable JSONL, so the same Google account can share bookmarks across PCs without a custom backend or database.

The product's differentiator is not just bookmark sync. The key feature is using Chrome's built-in Gemini / Prompt API to analyze the current page content and save a useful explanation of what the page is about, in Japanese or English (MIK-029). For example, saving a GitHub repository should produce a human-readable explanation of what the repository does.

## MVP Goals

- Chrome extension, not CLI-first.
- Save the current tab from the popup.
- Extract page content only when the user explicitly saves the tab.
- Analyze the page with Chrome Built-in AI / Prompt API.
- Save an AI-generated description, genre, and tags in Japanese or English
  (auto-selected per page; MIK-029).
- Store records in a visible Google Drive folder: `bookmark-ai/bookmarks.jsonl`.
- Sync across PCs via the user's Google Drive.
- Keep raw extracted page text out of persistent storage.
- Design from the start for eventual Chrome Web Store publication.

## Non-goals for MVP

- Bulk import/classification of existing Chrome bookmarks.
- Browser bookmark tree mutation.
- Semantic search or embeddings.
- External AI API fallback / user API key fallback.
- Multi-user collaboration.
- Mobile support.
- Full offline-first sync queue.
- Append-only event log storage.
- Site-specific extraction adapters such as a GitHub repository adapter.

## Technology Stack

Use:

- Vite+ (`vp`) as the web toolchain.
- Vite + TypeScript + React for UI.
- `@crxjs/vite-plugin` for Manifest V3 extension build integration.
- Vitest for pure logic tests via Vite+.

Rationale:

- Popup and options UI need stateful components.
- CRXJS handles MV3 entry points such as popup, options page, and service worker from the manifest.
- Vite+ provides a unified command surface for install, dev, check, test, and build.

## Extension Architecture

Suggested structure:

```txt
extension/
  manifest.config.ts
  vite.config.ts
  src/
    background/
      service-worker.ts
    popup/
      Popup.tsx
      main.tsx
    options/
      Options.tsx
      main.tsx
    lib/
      ai/
        prompt-api.ts
        analyze-page.ts
      bookmarks/
        schema.ts
        jsonl.ts
        merge.ts
      drive/
        auth.ts
        drive-client.ts
        repository.ts
      extraction/
        extract-page.ts
        build-excerpt.ts
      storage/
        local-cache.ts
      tabs.ts
      ids.ts
```

The exact paths can change during implementation, but keep these boundaries:

| Module | Responsibility |
|---|---|
| `drive/*` | Google auth token, folder/file bootstrap, download/upload, revision metadata. |
| `bookmarks/*` | JSONL schema, parse/serialize, URL upsert, merge behavior. |
| `extraction/*` | Current page extraction and excerpt construction. |
| `ai/*` | Prompt API availability and English/Japanese AI output generation. |
| `storage/*` | `chrome.storage.local` cache of bookmarks and Drive metadata. |
| `popup/*` | Save current tab flow and status display. |
| `options/*` | List/search/filter/delete/re-analyze management UI. |

## Permissions and Manifest

MVP permissions:

```json
{
  "permissions": ["identity", "storage", "activeTab", "scripting", "favicon"],
  "host_permissions": ["https://www.googleapis.com/*"],
  "oauth2": {
    "client_id": "<injected from env>",
    "scopes": ["https://www.googleapis.com/auth/drive.file"]
  }
}
```

Use `activeTab` + `scripting` for page extraction. Do not use always-on content scripts or broad host permissions in the MVP.

The `favicon` permission only enables Chrome's extension-local favicon
endpoint (`chrome-extension://<id>/_favicon/?pageUrl=…&size=…`), used to show
site icons next to bookmarks in the popup and options UI. Favicon images are
resolved by Chrome at render time from the bookmark URL and are never stored
in bookmark records, settings, the local cache, or Drive; no external favicon
service is used.

## Google Drive Storage

Use Google Drive as source of truth.

- Folder: `bookmark-ai/`
- File: `bookmarks.jsonl`
- Settings file: `bookmark-ai/settings.json` — Drive-synced custom analysis
  skills (AI Analysis v2 Phase 2, MIK-018; see docs/ai-analysis-v2.md
  "Settings file"). Stores only user-defined custom skill definitions
  (id/name/enabled/priority/domains/urlPatterns/instruction/timestamps),
  never raw page excerpts. Built-in skills stay fixed in code
  (`src/lib/ai/profile.ts`) and are never persisted here.
- OAuth scope: `https://www.googleapis.com/auth/drive.file`
- Folder is visible in the user's My Drive.
- The extension creates and manages this folder/file itself.
- Do not use `appDataFolder` for MVP because portability and visibility are product goals.

`drive.file` is intentionally minimal. It allows the extension to create and manage files it owns, rather than requesting broad Drive access.

`settings.json` uses a simpler conflict policy than `bookmarks.jsonl`: whole-file
`updatedAt` last-writer-wins (a tie favors the caller's fresh write) rather than
a per-record merge, since settings edits are comparatively rare and the
per-skill merge complexity is not warranted for the first implementation (see
docs/ai-analysis-v2.md "Conflict policy for settings").

## Local Cache

Use `chrome.storage.local` as a cache, not the source of truth.

Cache:

- Last known bookmark snapshot.
- Drive folder ID.
- Drive file ID.
- Last known Drive revision/version/modified metadata.
- Last sync status and errors.
- A `pending` flag marking that the snapshot holds **unsynced local mutations**
  (a save/update/re-analyze or a deletion tombstone) that have not yet been
  confirmed on Drive; see "Preserving unsynced local mutations" below.

Popup/options should render from local cache first, then sync with Drive when needed.

The cache stays the source of truth's *cache*, never an authority of its own, so
a corrupt entry is safely discarded and re-pulled. The one nuance is the
`pending` flag: while it is set, the cache holds the only copy of a change that
never reached Drive, so a sync must reconcile (push) rather than overwrite it.

`bookmark-ai/settings.json`'s custom skills are cached the same way, but under
their own `chrome.storage.local` key and schema — a settings-cache read/write
never touches the bookmark cache blob, and vice versa. The options page's
"Analysis skills" screen renders from this cache first, then syncs with Drive;
the same cache is read (fast, no Drive round-trip) when a save/re-analyze needs
the currently-enabled custom skills.

## Bookmark Data Model

Use JSONL: one JSON object per line. MVP uses current-state records, not an event log.

Proposed record:

```ts
type AiStatus = 'pending' | 'ready' | 'unavailable' | 'failed';

type BookmarkRecordV1 = {
  schemaVersion: 1;
  id: string;
  canonicalUrl: string;
  url: string;
  title: string;
  description?: string;
  genre?: string;
  tags: string[];
  aiStatus: AiStatus;
  aiModel?: 'chrome-prompt-api';
  aiError?: string;
  createdAt: string;
  updatedAt: string;
  lastAnalyzedAt?: string;

  /** Long-form generated Markdown analysis (AI Analysis v2 Phase 1). Never raw page excerpt text. */
  analysisMarkdown?: string;

  /** ID of the built-in analysis profile used for the latest ready analysis. */
  analysisProfileId?: string;
};
```

Notes:

- `canonicalUrl` is the upsert key.
- `createdAt` is preserved across duplicate saves.
- `updatedAt` changes when the same URL is saved or re-analyzed.
- `tags` are generated by AI in MVP; manual tag editing can come later.
- `analysisMarkdown` and `analysisProfileId` are optional for backward
  compatibility with records written before AI Analysis v2 Phase 1; see
  [`ai-analysis-v2.md`](ai-analysis-v2.md) for the full data model and prompt
  contract.
- Raw page excerpt is not stored.
- Deletions are recorded as separate **tombstone** lines
  (`kind: "tombstone"`), not by removing the record line; see "Durable deletion
  (tombstones)" below. This is the one exception to "current-state records only".

## Save Flow

1. User opens popup on a page.
2. Popup shows Google connection state, Prompt API availability, and Save button.
3. User clicks Save.
4. Extension gets current tab URL/title.
5. Extension injects an extractor into the current tab using `activeTab` + `scripting`.
6. Extractor returns general page content.
7. Extension builds a structured excerpt with a character cap of roughly
   8k-12k characters.
8. Extension writes or updates a pending bookmark record in Drive/local cache.
9. Popup/options runs Prompt API analysis in the foreground while the screen
   stays open, then updates the bookmark record with the target-language
   `description`, `genre`, `tags`, `aiStatus`, and analysis timestamps before reporting the
   save as complete (MIK-021). Analysis is never handed off to a service
   worker, offscreen document, or background queue.
10. If the UI closes mid-flow, the in-memory excerpt is dropped (it is never
    persisted) and the durable record remains `pending`, recoverable for later
    re-analysis from a valid active tab.

If AI is unavailable or fails:

- Still save the bookmark with URL/title and metadata.
- Set `aiStatus` to `unavailable` or `failed`.
- Keep the record recoverable for later re-analysis: saving the page again
  from the popup re-runs analysis. The Options detail drawer no longer offers a
  Re-analyze action (MIK-024).

## Page Extraction

MVP extraction is generic only.

Do extract:

- `document.title`
- canonical URL if present
- meta description / Open Graph title/description when present
- headings
- visible main text candidates

Do not build site-specific adapters in MVP.

Build a structured excerpt instead of sending the full page text to AI. The excerpt should prioritize title, metadata, headings, and selected main text. Cap the excerpt around 8k-12k characters.

Do not persist the excerpt in `bookmarks.jsonl`.

## AI Design

Use Chrome Built-in AI / Prompt API only in MVP.

- No Gemini API key fallback in MVP.
- No OpenAI fallback in MVP.
- Generated output language: Japanese or English, following the current
  browser UI language (MIK-033; revising MIK-029's page-inference-first
  policy). When the UI/browser language resolves to a supported language it is
  the output language, regardless of the page's own text — an English GitHub
  page with a Japanese UI produces Japanese analysis. Only when no UI/browser
  language is available does the analyzer fall back to inferring the language
  from the title/excerpt text with a deterministic script heuristic, then
  Japanese. `LanguageModel.availability()` / `create()` request the selected
  language via `expectedOutputs`. No languages beyond English/Japanese.
- Generate `description`, `genre`, and `tags` in a single analysis call.

Prompt shape should request structured JSON. Implementation must validate and safely recover from malformed output.

Example desired output:

```json
{
  "description": "このページは...",
  "genre": "開発ツール",
  "tags": ["GitHub", "TypeScript", "ブラウザ拡張"]
}
```

For the next AI analysis iteration, see
[`ai-analysis-v2.md`](ai-analysis-v2.md). It extends the MVP design with
long-form generated Markdown analysis, built-in and custom analysis skills,
Drive-synced skill settings, and UI-open foreground analysis behavior while
preserving the same privacy constraints: no external AI fallback and no
persisted raw page excerpts. A custom skill's instruction may control the
`analysisMarkdown` output shape (headings, sections, length) with priority
over the default long-form format (MIK-030); the JSON keys, output language,
and privacy constraints remain non-overridable.

## Drive Write and Conflict Strategy

MVP write operation rewrites the full JSONL file, but with lightweight conflict protection.

Write flow:

1. Download current `bookmarks.jsonl` and file metadata.
2. Parse records and deletion tombstones.
3. Upsert by `canonicalUrl`.
4. Before upload, check whether Drive metadata/revision changed.
5. If changed, re-download latest file.
6. Merge records and tombstones by `canonicalUrl`.
7. Upload full JSONL.
8. Update local cache with new file metadata, records, and tombstones.

This avoids many accidental overwrites across PCs while keeping MVP simpler than an append-only event log.

### Durable deletion (tombstones)

A plain union merge by `canonicalUrl` cannot express a deletion: re-uploading a
reduced file is undone the moment another device's copy (or the not-yet-changed
remote file) is merged back in, resurrecting the record. The MVP therefore makes
deletion a first-class, mergeable fact rather than the absence of a record.

- Deleting a bookmark records a **tombstone**: a JSONL line
  `{"schemaVersion":1,"kind":"tombstone","canonicalUrl":"…","deletedAt":"…"}`.
- Live record lines are unchanged (no `kind` field), so the format stays
  backward compatible; a tombstone is recognized only by `kind: "tombstone"`.
- A tombstone is parsed at the boundary into an always-valid domain value, kept
  in the `Bookmarks` collection separately from live records, and serialized to
  both Drive JSONL and the local cache so the deletion propagates and is not
  resurrected before the next sync confirms it.
- Tombstones are not part of the rendered list (`toArray`/search/filter/size);
  only the merge and persistence layers see them.

### Delete vs. update conflict rules

The collection's revision-conflict merge (`Bookmarks.mergeRemote`) resolves each
`canonicalUrl` by last-write-wins on timestamps:

- **record vs record** — latest `updatedAt` wins its field values, earliest
  `createdAt` is preserved, id breaks ties (unchanged behavior).
- **tombstone vs tombstone** — the later `deletedAt` survives.
- **record vs tombstone (delete vs update)** — the tombstone wins **unless** the
  record's `updatedAt` is *strictly* newer than the tombstone's `deletedAt`, in
  which case the newer explicit update intentionally resurrects the record. A
  tie favors the deletion, so a delete stays durable.

Re-saving a URL on the same device that deleted it supersedes the local
tombstone (the new save is the newer action). These rules are pinned by tests in
`bookmarks/collection.test.ts`, `drive/repository.test.ts`, and
`app/bookmark-app.test.ts`.

Tombstones currently accumulate indefinitely (the MVP never prunes them), which
is the safe choice: pruning risks resurrecting a record from a device that has
been offline since before the prune. Bounded tombstone garbage collection is a
possible later refinement.

### Preserving unsynced local mutations

Durable deletion makes a delete survive a *merge*, but a delete (or any local
mutation) that never reached Drive must also survive a *sync*. When a Drive write
fails — offline, auth lapse, conflict retries exhausted — the desired collection
is kept in the cache and the sync state is flagged `pending` (see "Local Cache").
The flag is the cache's record that it diverges from Drive and owes a push.

`syncFromDrive` checks the flag before pulling:

- **No pending changes** → the normal pull: download Drive, replace the cache
  with the authoritative remote snapshot.
- **Pending changes** → re-push the cached collection instead. The repository's
  conflict-safe write delegates reconciliation to the domain merge
  (`Bookmarks.mergeRemote`, tombstones included), so the local mutation is made
  durable on Drive while newer remote changes still win by the rules above. If
  Drive is still unavailable the push fails, the cache keeps the mutation and
  stays `pending`, so the change **survives the sync** and is retried next time.

This closes the offline-delete edge: a tombstone created while Drive is down is
not overwritten by a later sync that still sees the live remote record, and is
eventually written to Drive once it recovers. The same guarantee covers an
offline save/update/re-analyze. The flow is pinned by tests in
`app/bookmark-app.test.ts` ("unsynced local mutations (MIK-014)").

Scope note: the guarantee applies to mutations made by a build that writes the
`pending` flag. A cache written by an older build that recorded only `status:
"error"` (no `pending`) is treated as a plain pull, matching prior behavior;
this is acceptable because the flag is set on the very next mutation. A full
background retry queue is intentionally out of MVP scope — the cache-resident
collection plus the `pending` flag is the minimal representation that satisfies
the requirement.

## Duplicate Behavior

Duplicate saves use URL-based upsert.

- Same canonical URL updates the existing record.
- Preserve `createdAt`.
- Update `updatedAt`.
- Refresh AI analysis/status when applicable.

## UI Design

### Selected direction

Design deck selections from 2026-06-24:

- Popup: **Bookmark Receipt**.
- Options page: **Research Ledger**.
- Visual identity: **Warm Library**.

The product should feel like a warm personal knowledge shelf rather than a generic AI dashboard. Prefer paper, ledger, and library cues: warm off-white backgrounds, muted ink colors, gentle borders, readable hierarchy, and restrained accent colors. Avoid overusing neon gradients or generic AI-purple branding.

### UI language (MIK-029)

Popup and Options user-visible strings render in English or Japanese,
selected automatically from the browser UI language
(`chrome.i18n.getUILanguage()`, then `navigator.language`, falling back to
Japanese). The dictionaries are plain typed objects (`popup/i18n.ts`,
`options/i18n.ts`, shared language logic in `lib/i18n/`); no i18n framework
and no stored language preference. Domain status enums (`ready`, `synced`,
`available`, …) and controller-produced safe error text stay as their internal
spellings. Tests inject the language explicitly.

### Popup: Bookmark Receipt

Popup responsibilities:

- Show Google connection state.
- Show Prompt API availability.
- Save current tab.
- Show progress: extracting, saving pending record, analyzing, syncing.
- Detect when the current page is already bookmarked (same canonical-URL
  dedup key as save/upsert) and show an "Already bookmarked" state with a
  Remove affordance that deletes through the app's tombstone delete
  (MIK-027). Save & Analyze stays available as the documented duplicate
  upsert that refreshes the analysis.
- Show recent saved bookmarks as a compact single-line list (title + AI
  status + inline re-analyze); the full ledger stays in Options.
- Clicking a recent bookmark's title opens a compact detail overlay (MIK-028):
  a full-popup reading surface with Back/Close, the link (new tab,
  `rel="noreferrer"`), AI status, description, genre/tags, and the long-form
  `analysisMarkdown` rendered through the same safe Markdown component as
  Options (no `rehype-raw`, no `dangerouslySetInnerHTML`). It is a reading
  surface only — no delete, search, or filters — and the inline Re-analyze
  action never also opens it. The detail tracks cache refreshes: it updates in
  place and closes when the record disappears.
- Link to options page. `Manage in Options` also requests an Options Drive
  sync (MIK-026): it best-effort writes a token-free request marker (a
  timestamp only, under `bookmark-ai:options-sync-request` in
  `chrome.storage.local`) before calling `chrome.runtime.openOptionsPage()`,
  so the options page pulls Drive instead of showing stale cache. A missing or
  failing storage API never blocks opening the options page.

The popup is a compact receipt (MIK-056): its runtime resets the document
body margin to `0` and paints the body and main surface with the same Warm
Library paper color (`#faf6ee`) so no outer gutter or background mismatch
appears around the receipt; the transparent root sits on that paper. The
recent-bookmark detail overlay sits
on the same paper. Surface, card, primary button, and section spacing use
tightened density tokens (`popup/styles.ts`) while keeping the single
primary action dominant and all status text readable.

The popup should behave like a save receipt:

1. Show the current tab title and URL.
2. Provide one primary **Save & Analyze** action.
3. After click, show a compact progress trail:
   - pending record saved;
   - page excerpt extracted;
   - AI analyzing;
   - Drive synced / AI ready.
4. Show a short preview of the generated description, genre, and tags when ready.
5. If Prompt API is unavailable or fails, keep the saved bookmark visible with `unavailable` or `failed` status and a path to re-analyze later.

### Options page: Research Ledger

Options page responsibilities:

- Show full bookmark list.
- Text search over title, URL, description, genre, and tags.
- Filter by domain, genre, tags, and AI status. Domains are derived on demand
  from canonical URL hostnames (lowercased, `www.` dropped) — never stored on
  records (MIK-028).
- Delete bookmarks — via a per-row quick delete and from the detail drawer.
- Show Drive sync status and errors, with the manual sync action in the
  shared app-header sync hub (MIK-051).
- Show visible progress for slow Drive operations, distinguishing cached
  loading, a Drive pull, a Drive write, and failed-sync pending local changes
  (MIK-026).
- Manage Analysis skills from a separate top-level settings screen (MIK-025).

The Options UI does not offer re-analysis (MIK-024): the detail drawer is a
reading/opening/deletion surface. A `pending`, `unavailable`, or `failed`
record stays recoverable — saving the page again from the popup re-runs
analysis, and a later explicit re-analysis flow may return (MIK-027). Any
re-analysis remains bound by the same `activeTab` + `scripting` posture as the
save flow: re-extraction only works when the target page **is the active tab
in the current window**. The extension never reaches for an arbitrary tab (no
`tabs` permission, no host permissions). When a re-analyze is requested from
an unrelated active tab, the app surfaces a safe action error
(`Open the page in the active tab to re-analyze it from here.`) and leaves the
existing bookmark record unchanged — it is **not** flipped to `pending` or
`failed`, and no Drive write is made. A genuine extraction/AI failure *after* a
valid active-tab target still marks the bookmark `failed` so it can be retried.
This matches the manual posture documented in
[`smoke-checklist.md`](smoke-checklist.md) (section 5 and its re-analysis note);
re-analyze from the page's own tab, or save it again.

All screens render inside a shared Options shell (MIK-036): a persistent
app header carries the product title (`Bookmark AI`), the shared sync hub
(MIK-051), and the top-level screen navigation on every screen, and each
screen opens with the same screen-header rhythm — a screen title plus a
one-line user-facing subtitle (`Library` / `Research Ledger` and
`Analysis skills` / a plain-language tuning line). Every top-level screen
carries a title-adjacent help control (MIK-052, MIK-053): a small `?`
button beside the title (click/focus accessible, `aria-expanded` +
`aria-controls`, no persisted open state) opening a `position: fixed`
popover measured from the trigger — fixed positioning so an
`overflow: hidden` screen like the Ask AI chat page can never clip it. The
popover closes on Escape, outside click, and a second trigger click. Help
carries explanatory screen guidance (Library: search/filter scope, the
detail drawer, and the sync hub; Analysis skills: the
`bookmark-ai/settings.json` context; Ask AI: local-cache scope and privacy
notes), so explanations never occupy permanent side-panel space.

### Options shared UI foundation (MIK-053)

The Options screens are built on a small Options-local component foundation
under `src/options/components/` — not a global design system; it only keeps
the existing screens from drifting apart:

- `ScreenFrame.tsx` — per-screen layout variants sharing one header rhythm:
  - `library`: normal document scroll; the header spans the 1200px shell and
    the body is the two-zone workspace grid (240px rail + main content).
    Library only — rails exist only for active controls.
  - `noRail`: normal document scroll; the header and body stack inside the
    same centered 880px column, so the title can never sit wider than the
    content. Used by Analysis skills.
  - `chat`: the outer page is locked (`height: 100vh`, `overflow: hidden`);
    the header and the chat body share the same centered 880px no-rail
    width and the transcript viewport stays the only scroller with the
    composer pinned. Used by Ask AI.

  No-rail width rule (MIK-054): every screen without an active side rail
  (Analysis skills, Ask AI) renders its content at the one shared 880px max
  width so the no-rail screens never diverge. Only the Library is wider —
  its 1200px shell exists to host the 240px search/filter rail.
- `ScreenHelp.tsx` — the title-adjacent `?` trigger plus fixed popover
  described above.
- `Drawer.tsx` — the shared right drawer/backdrop foundation described
  under "Drawer behavior" below.
- `BookmarkSummaryItem.tsx` — the shared bookmark summary body used by both
  Library ledger rows and Ask AI recommendation cards: favicon (resolved
  from the original visited URL, MIK-034), title, clamped
  description/summary, metadata line (optional domain, genre, up to four
  tags, optional profile suffix), AI status pill, and per-context slots —
  the Library row adds updated time plus quick delete and selected
  highlighting; the Ask AI card adds the recommendation reason line and no
  delete. Ask AI recommendation cards therefore show the same
  favicon/fallback site icon as Library rows; the card view carries the
  original bookmark `url` for display-only favicon lookup, and the
  recommendation prompt payload allowlist still never includes any URL.

The app-header sync hub (MIK-051) is the single place for sync status and
manual sync actions on every screen: a compact glance pill whose tone/text
reads the worst state across bookmark Drive sync and analysis settings sync
(error > in-flight > pending local changes > synced), disclosing a panel with
one section per sync source — status, in-flight progress (MIK-026), pending
local changes, last-synced time, safe errors, and the manual `Sync Drive` /
`Sync settings` action. The actions dispatch the existing controller refresh
paths unchanged and are disabled while their sync is loading/syncing/writing;
the settings section renders only when the skills controller is present.
Screen bodies no longer carry sync rail panels or floating sync buttons.

Below the header, side rails exist only for active controls (MIK-052). The
Library keeps the two-zone workspace body (MIK-038) because its left rail
hosts the search and filter controls (never app branding). Screens without
active rail controls render no rail: their main content centers in a
readable no-rail column, and their explanatory guidance lives in the
title-adjacent header help instead.

The options page has top-level navigation for three screens:

- **Library** (default): the two-zone ledger and detail drawer described
  below.
- **Analysis skills**: the settings screen for analysis skills, no longer a
  panel below the bookmark list. It renders on the `noRail` frame variant
  (MIK-052, MIK-053): the settings-file context (custom skills are stored
  only in `bookmark-ai/settings.json` on Drive) is disclosed by the
  title-adjacent header help, and the centered no-rail column shows custom
  skills with create/edit/delete/enable-disable (and the `Add custom
  skill` action) followed by built-in profiles read-only. Settings sync
  status and the `Sync settings` refresh live in the shared app-header sync
  hub (MIK-051) — the hub dispatches the existing refresh path and disables
  the action while a skills action is busy. The create/edit form opens in
  the shared right drawer (MIK-053; the same `Drawer` foundation as the
  bookmark detail) that closes via its Close/Cancel buttons, the Escape
  key, or a true backdrop click, goes fullscreen on narrow viewports, and
  locks the page scroll while open. Instruction-authoring guidance sits
  under the form as collapsible tips (a native `<details>` whose summary is
  the guidance title): what the instruction changes, per-source examples
  (GitHub repository / technical article / official docs), safety warnings
  (no secrets, no raw page persistence, no external APIs/providers, no
  output schema or privacy-contract changes), and a plain-language
  explanation of domain/URL-pattern/priority matching.
- **Ask AI / AIに聞く**: the chat-style screen for asking about saved
  bookmarks. It renders on the `chat` frame variant (MIK-053): the screen
  header and chat surface share the centered 880px no-rail column
  (MIK-054), the outer page is locked, and the transcript viewport is the
  only vertical scroller while the composer stays pinned. Ask AI searches the local bookmark cache
  only, does not search the open web, and keeps chat/session state in memory
  only. Recommendation cards reuse the shared bookmark summary item and show
  the same favicon/fallback icon treatment as Library rows.

Switching screens closes the detail drawer; it never resets search/filter
state or the skill form draft.

Use a two-zone ledger layout with a row-click detail drawer:

- Left rail: two cards — Search (with the shown/total count and Clear
  filters) and one grouped Filters panel
  (MIK-028) with uniform subsections in a fixed order: Domain, Genre, Tags,
  AI status. Domain, Genre, and Tags can grow without bound, so each shows a
  capped set of chips (12) with a `Show all N domains/genres/tags` / `Show
  fewer` toggle (MIK-054) rendered as a compact pill-style native button,
  visually subordinate to the chips but still keyboard-focusable; both the
  capped and expanded lists scroll inside max-height containers (expanded is
  taller than capped) so clicking `Show fewer` can never visually grow a long
  Domain/Genre group, and the active filter value stays visible even while
  capped or collapsed.
- Center list: scannable bookmark rows with title, a short clamped AI summary,
  genre/tags/profile metadata, status, updated time, and a small quick delete
  button. Quick delete goes through the existing delete use case, is disabled
  while an action is busy, and stops event propagation so it never opens the
  detail drawer.
- Sync action: the app-header sync hub's `Sync Drive` button (MIK-051)
  triggers the existing refresh path; the hub carries the sync
  status/pending/error readout. There is no rail sync panel and no floating
  sync button. While the cache is loading or a Drive pull/write is in flight
  the button is disabled and the hub shows the in-flight progress line, and
  the controller drops duplicate refresh calls, so a slow sync can never be
  stacked into a second one (MIK-026).
- Detail drawer: clicking a row opens a right-side modal drawer (fullscreen
  on narrow viewports; the shared `Drawer` foundation, MIK-053) showing the
  full bookmark detail — description, genre,
  tags, profile, URL, timestamps, the full `analysisMarkdown` note — and the
  Open/Delete/Close actions (no Re-analyze). There is no always-visible right
  detail pane.

Detail drawer behavior (shared `Drawer` foundation, MIK-053 — the skill
create/edit drawer closes the same way):

- While the drawer is open the underlying page scroll is locked (body overflow
  hidden, restored on close); the drawer body scrolls independently.
- The drawer closes via its Close buttons, the Escape key, or a true backdrop
  click; closing only clears the selection and never resets search/filter
  state.
- The row highlight reflects the currently open drawer.
- `analysisMarkdown` is rendered through `react-markdown` + `remark-gfm` with
  raw HTML kept inert (no `rehype-raw`, no `dangerouslySetInnerHTML`); rendered
  links open in a new tab with `rel="noreferrer"`.
- While an action is busy the drawer keeps Open and Close enabled, disables
  Delete, and shows a keep-this-page-open note. Delete is immediate and closes
  the drawer once the bookmark is gone.

Drive sync progress feedback (MIK-026):

- The app-header sync hub (MIK-051) shows one explicit progress line while
  something slow is happening: `Loading cached bookmarks…` during the initial cached
  load, `Syncing with Google Drive…` while a Drive pull/merge is in flight,
  and `Writing changes to Google Drive…` while a delete/re-analyze write
  runs. When a Drive write fails, the existing pending readout (`Local
  changes pending — will retry on next sync`) plus the safe sync error stay
  visible, so the user can tell "sync failed but my change is kept" apart
  from "still working".
- The options view model exposes these as `sync.syncing` / `sync.writing`
  alongside the existing `loading`, `sync.pendingLocalChanges`, and safe
  error strings; the React layer stays a pure projection of that view.
- Manage in Options sync requests arrive through a token-free
  `chrome.storage.local` marker (`bookmark-ai:options-sync-request`, a
  request timestamp only — never a URL, title, excerpt, token, or bookmark
  data). A freshly opened options page just consumes (removes) the marker —
  its init already pulls Drive — while an already-open options page observes
  the write via `chrome.storage.onChanged` and re-runs the Drive refresh.
  There is no background durable sync queue; the marker only upgrades
  freshness of an open/opening options page.

MVP search is normal local-cache text search plus filters. Semantic search is out of scope.

## Public Release Requirements

The extension should be designed for eventual Chrome Web Store publication.

Publication-related decisions are detailed in [`publication.md`](publication.md), but core design requirements are:

- Separate dev and production OAuth client IDs.
- Inject OAuth client ID from environment variables.
- Use a Chrome Web Store draft upload to obtain the production extension ID before creating the production OAuth client.
- Keep `drive.file` as the only Drive scope in MVP.
- Maintain a privacy policy draft from the start.
- Do not store raw page excerpts persistently.

## Testing Strategy

Unit test first:

- JSONL parsing/serialization.
- Bookmark schema validation.
- URL canonicalization.
- Upsert behavior.
- Merge behavior under simulated revision conflicts.
- Excerpt builder input/output limits.
- AI response JSON parsing and fallback handling.

Integration/manual test:

- `chrome.identity` token flow.
- Drive folder/file bootstrap.
- Save current tab.
- Prompt API available/unavailable states.
- Loading unpacked extension with dev OAuth client.
- Chrome Web Store draft/prod OAuth flow before publication.

## Open Implementation Details

These can be resolved during implementation:

- Exact Prompt API TypeScript typings and availability checks.
- Exact Drive metadata field used for revision comparison.
- Canonical URL normalization rules.
- Exact genre taxonomy.
- Deletion UI placement and confirmation copy.
