# Handoff: Google Drive + Chrome Built-in AI Bookmark Extension

## Purpose
Continue this idea in a new project: a Chrome extension that lets the user save the current tab as an AI-enriched bookmark, shared across PCs through the user's own Google Drive.

## Current conversation summary
The user started by asking for lightweight bookmark sharing across multiple PCs without a database. We explored:

- Plain text / Markdown / JSONL files
- SSH-based sharing
- GitHub private repositories and other free file-sharing services
- Google Drive as a simple shared backing store
- CLI versus Chrome extension

The idea evolved from a CLI into a Chrome extension.

## Product direction agreed so far
Build a Chrome extension with this MVP flow:

1. User installs the extension.
2. User authenticates with Google.
3. User clicks the extension while viewing a page.
4. Extension reads the current tab URL/title, and optionally page text later.
5. Extension generates:
   - short AI description
   - genre/category
   - possibly tags later
6. Extension stores the bookmark in the user's Google Drive in a visible folder.
7. The same Google account can access the same bookmark data from other PCs.

## Key decisions

### Platform
- Use a Chrome extension, not a CLI, for the first product.
- CLI compatibility is still desirable later because JSONL is portable.

### Storage
- Use Google Drive as the backing store.
- Store data in a visible Drive folder, not `appDataFolder`.
- Proposed folder: `bookmark-ai/` under My Drive.
- Preferred storage format: `bookmarks.jsonl`.

### Data format
Use one JSON object per line, roughly:

```jsonl
{"id":"...","url":"https://example.com","title":"Example","description":"AI explanation","genre":"Tech","tags":["web"],"createdAt":"2026-06-21T..."}
```

MVP operations can rewrite the whole JSONL file when adding/updating/deleting. This is acceptable for a personal bookmark tool and simple to implement.

Potential later improvement: append-only event log JSONL with `create`, `update`, `delete` operations.

### AI
Preferred AI strategy after discussion:

1. Primary: Chrome Built-in AI / Prompt API when available.
2. Fallback: user-provided AI API key stored in extension settings.

Rationale:
- Chrome Built-in AI can make the experience close to "Google auth only" / no external AI key.
- It is environment-dependent, so fallback is needed for reliability.
- User chose earlier that storing a user's AI API key in the extension is acceptable as a fallback approach.

### MVP input path
- User selected: save the current tab.
- Not in MVP: bulk import/classification of existing Chrome bookmarks.

## Technical notes discovered

### Chrome extension + Drive access
Chrome extensions can access Google Drive API using:

- `chrome.identity`
- OAuth client configured in Google Cloud Console
- Drive API enabled
- Manifest OAuth config
- host permission for `https://www.googleapis.com/*`

Suggested manifest permissions:

```json
{
  "permissions": ["identity", "storage", "activeTab", "scripting"],
  "host_permissions": ["https://www.googleapis.com/*"],
  "oauth2": {
    "client_id": "<REDACTED_CLIENT_ID>.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/drive.file"]
  }
}
```

Use `drive.file` rather than broad full-Drive access if possible.

### Chrome Built-in AI
Chrome has Built-in AI APIs, including Prompt API support for Chrome extensions in current Chrome documentation/status. It is not universally available on all environments. Plan runtime capability detection and fallback.

### Google Drive + JSONL caveat
Drive API does not offer convenient remote append semantics for this use case. MVP should:

1. Download/read `bookmarks.jsonl`.
2. Parse existing lines.
3. Add/update/delete in memory.
4. Upload the full file content back.

Add conflict protection later using Drive revision/ETag/modifiedTime.

## Existing similar tools found
There are related tools, but the proposed combination still has a distinct angle.

Related categories:

- Google Drive bookmark sync:
  - BookDrive (`nightcodex7/bookdrive-extension`)
  - syncmarx (`Cleod9/syncmarx-webext`)
- AI bookmark organizers:
  - MarkMind
  - Smart Bookmarks AI
  - TidyMark
  - AI Bookmark Manager variants
  - allistera/Bookmark-AI

Differentiation for this idea:

- Serverless
- No database
- User-owned Google Drive storage
- Visible, portable `bookmarks.jsonl`
- Chrome Built-in AI first
- External AI key only as fallback
- Simple one-click save-current-tab workflow

## Suggested MVP scope

### Include
- Manifest V3 Chrome extension scaffold
- Popup UI with:
  - Google sign-in/connect state
  - Save current tab button
  - AI availability indicator
  - Recent saved bookmarks
- Google Drive folder/file bootstrap:
  - create/find `bookmark-ai/`
  - create/find `bookmarks.jsonl`
- Save current tab:
  - URL
  - title
  - timestamp
  - AI description
  - AI genre/category
- JSONL parser/serializer
- Basic duplicate detection by URL
- Settings page for fallback AI API key/provider

### Exclude initially
- Bulk Chrome bookmark import
- Browser bookmark tree mutation
- Full semantic search
- Multi-user collaboration
- Mobile support
- Complex conflict resolution beyond simple warning/retry
- Publishing to Chrome Web Store

## Open questions for the next session

1. What should the new project directory/name be?
   - Suggested: `bookmark-ai-extension`
2. Which stack should be used?
   - Suggested: Vite + TypeScript + React or plain TypeScript Manifest V3.
3. Which fallback AI providers should be supported first?
   - Suggested: Gemini API first, because the product already centers on Google, then OpenAI later.
4. Should saved bookmark list/search be in the popup, an options page, or both?
5. How much page content should be sent to AI in MVP?
   - Suggested: start with title + URL only, then add content script extraction later.

## Recommended architecture for first implementation

```txt
extension/
  manifest.json
  src/
    background/
      service-worker.ts
    popup/
      Popup.tsx
    options/
      Options.tsx
    lib/
      drive.ts
      bookmarks-jsonl.ts
      ai.ts
      chrome-ai.ts
      fallback-ai.ts
      tabs.ts
      ids.ts
```

Possible modules:

- `drive.ts`: OAuth token, Drive folder/file lookup/create, download/upload JSONL.
- `bookmarks-jsonl.ts`: parse/serialize/add/update/delete bookmark records.
- `ai.ts`: chooses Chrome Built-in AI if available, otherwise fallback provider.
- `chrome-ai.ts`: Prompt API wrapper and availability detection.
- `fallback-ai.ts`: user API key provider wrapper.
- `tabs.ts`: current tab title/url retrieval.

## Suggested skills for the next agent

- `brainstorming`: if the next session needs to finalize design before implementation.
- `ask-user`: for architecture/security decisions such as OAuth scope, AI fallback provider, or project stack.
- `writing-plans`: after the design is accepted, create a concrete implementation plan.
- `test-driven-development` or `tdd`: when implementing parser/storage logic and Drive API wrappers.
- `systematic-debugging`: when Chrome extension auth/Drive API or Built-in AI availability behaves unexpectedly.
- `code_search` / web research: verify current Chrome Built-in AI and `chrome.identity` implementation details.
- `requesting-code-review`: before considering the MVP complete.

## Sensitive info
No API keys, OAuth client IDs, passwords, tokens, or personal secrets were provided in the conversation. Any placeholder credentials in examples are redacted.
