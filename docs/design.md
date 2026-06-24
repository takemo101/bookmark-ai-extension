# Bookmark AI Extension Design

Date: 2026-06-24

## Purpose

Bookmark AI Extension is a Chrome extension for saving the current tab as an AI-enriched bookmark. Bookmarks are stored in the user's own Google Drive as portable JSONL, so the same Google account can share bookmarks across PCs without a custom backend or database.

The product's differentiator is not just bookmark sync. The key feature is using Chrome's built-in Gemini / Prompt API to analyze the current page content and save a useful Japanese explanation of what the page is about. For example, saving a GitHub repository should produce a human-readable explanation of what the repository does.

## MVP Goals

- Chrome extension, not CLI-first.
- Save the current tab from the popup.
- Extract page content only when the user explicitly saves the tab.
- Analyze the page with Chrome Built-in AI / Prompt API.
- Save a Japanese AI-generated description, genre, and tags.
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
| `ai/*` | Prompt API availability and Japanese AI output generation. |
| `storage/*` | `chrome.storage.local` cache of bookmarks and Drive metadata. |
| `popup/*` | Save current tab flow and status display. |
| `options/*` | List/search/filter/delete/re-analyze management UI. |

## Permissions and Manifest

MVP permissions:

```json
{
  "permissions": ["identity", "storage", "activeTab", "scripting"],
  "host_permissions": ["https://www.googleapis.com/*"],
  "oauth2": {
    "client_id": "<injected from env>",
    "scopes": ["https://www.googleapis.com/auth/drive.file"]
  }
}
```

Use `activeTab` + `scripting` for page extraction. Do not use always-on content scripts or broad host permissions in the MVP.

## Google Drive Storage

Use Google Drive as source of truth.

- Folder: `bookmark-ai/`
- File: `bookmarks.jsonl`
- OAuth scope: `https://www.googleapis.com/auth/drive.file`
- Folder is visible in the user's My Drive.
- The extension creates and manages this folder/file itself.
- Do not use `appDataFolder` for MVP because portability and visibility are product goals.

`drive.file` is intentionally minimal. It allows the extension to create and manage files it owns, rather than requesting broad Drive access.

## Local Cache

Use `chrome.storage.local` as a cache, not the source of truth.

Cache:

- Last known bookmark snapshot.
- Drive folder ID.
- Drive file ID.
- Last known Drive revision/version/modified metadata.
- Last sync status and errors.

Popup/options should render from local cache first, then sync with Drive when needed.

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
};
```

Notes:

- `canonicalUrl` is the upsert key.
- `createdAt` is preserved across duplicate saves.
- `updatedAt` changes when the same URL is saved or re-analyzed.
- `tags` are generated by AI in MVP; manual tag editing can come later.
- Raw page excerpt is not stored.

## Save Flow

1. User opens popup on a page.
2. Popup shows Google connection state, Prompt API availability, and Save button.
3. User clicks Save.
4. Extension gets current tab URL/title.
5. Extension injects an extractor into the current tab using `activeTab` + `scripting`.
6. Extractor returns general page content.
7. Extension builds a structured excerpt with a character cap of roughly 8k-12k characters.
8. Extension writes or updates a pending bookmark record in Drive/local cache.
9. Popup runs Prompt API analysis while the popup remains open.
10. Extension updates the bookmark record with Japanese `description`, `genre`, `tags`, `aiStatus`, and analysis timestamps.

If AI is unavailable or fails:

- Still save the bookmark with URL/title and metadata.
- Set `aiStatus` to `unavailable` or `failed`.
- Allow later re-analysis from the options page.

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
- Generated output language: Japanese.
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

## Drive Write and Conflict Strategy

MVP write operation rewrites the full JSONL file, but with lightweight conflict protection.

Write flow:

1. Download current `bookmarks.jsonl` and file metadata.
2. Parse records.
3. Upsert by `canonicalUrl`.
4. Before upload, check whether Drive metadata/revision changed.
5. If changed, re-download latest file.
6. Merge records by `canonicalUrl`.
7. Upload full JSONL.
8. Update local cache with new file metadata and records.

This avoids many accidental overwrites across PCs while keeping MVP simpler than an append-only event log.

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

### Popup: Bookmark Receipt

Popup responsibilities:

- Show Google connection state.
- Show Prompt API availability.
- Save current tab.
- Show progress: extracting, saving pending record, analyzing, syncing.
- Show recent saved bookmarks.
- Link to options page.

The popup should behave like a save receipt:

1. Show the current tab title and URL.
2. Provide one primary **Save & Analyze** action.
3. After click, show a compact progress trail:
   - pending record saved;
   - page excerpt extracted;
   - AI analyzing;
   - Drive synced / AI ready.
4. Show a short preview of the generated Japanese description, genre, and tags when ready.
5. If Prompt API is unavailable or fails, keep the saved bookmark visible with `unavailable` or `failed` status and a path to re-analyze later.

### Options page: Research Ledger

Options page responsibilities:

- Show full bookmark list.
- Text search over title, URL, description, genre, and tags.
- Filter by genre and tags.
- Delete bookmarks.
- Re-analyze bookmarks with `pending`, `unavailable`, or `failed` status.
- Show Drive sync status and errors.

Use a ledger layout:

- Left rail: search, genre filters, tag filters, sync state.
- Center list: dense bookmark rows with title, short AI summary, status, and updated time.
- Right detail pane: selected bookmark description, genre, tags, URL, timestamps, open/delete/re-analyze actions.

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
