# Privacy Policy Draft

Date: 2026-06-24

> **Public source of truth:** the published privacy policy lives at
> [`site/privacy/index.html`](../site/privacy/index.html), deployed to
> <https://takemo101.github.io/bookmark-ai-extension/privacy/>. This document
> remains an internal reference draft; user-facing policy changes must be made
> in the public page.

> This is a draft for the MVP and future Chrome Web Store publication. It should be reviewed and adapted before public release.

## Summary

Bookmark AI Extension helps you save the current browser tab as an AI-enriched bookmark. The bookmark data is stored in your own Google Drive in a visible folder named `bookmark-ai`.

The extension does not use a custom backend database in the MVP.

## Data the Extension Uses

When you click Save, the extension may process:

- Current tab URL.
- Current tab title.
- Page metadata such as description and headings.
- A temporary excerpt of visible page text.
- AI-generated bookmark information:
  - Description (Japanese or English, auto-selected per page).
  - Genre.
  - Tags.
  - Long-form Markdown analysis (Japanese or English).
  - AI generation status.

## Data Stored in Google Drive

The extension stores bookmark records in:

```txt
bookmark-ai/bookmarks.jsonl
```

Each record may include:

- URL.
- Canonical URL.
- Page title.
- AI-generated description (Japanese or English).
- Genre.
- Tags.
- A long-form, AI-generated Markdown analysis in Japanese or English (never a
  copy of the page's raw text) and the ID of the analysis profile used to
  generate it.
- Creation/update timestamps.
- AI status such as `pending`, `ready`, `unavailable`, or `failed`.

If you define custom analysis skills (optional, user-initiated), the extension
also stores them in:

```txt
bookmark-ai/settings.json
```

This file contains only your custom skill definitions — name, enabled/disabled
state, priority, domains, wildcard URL patterns, instruction text, and
creation/update timestamps. It never contains page excerpts, bookmark records,
or any other browsing data. Built-in analysis profiles are fixed in the
extension's code and are never written to this file.

## Page Text Excerpts

The extension may temporarily extract page text to generate an AI description.

MVP privacy rule:

- Raw page text excerpts are not stored in `bookmarks.jsonl`.
- Raw page text excerpts are not intentionally persisted by the extension.
- If re-analysis is needed, the extension re-extracts content from the live page.

## Site Favicons

The extension shows website favicons next to saved bookmarks in its popup and
options pages.

- Favicons are resolved by Chrome itself, at display time, through Chrome's
  extension-local favicon endpoint (the `favicon` permission).
- The favicon lookup is derived from the saved bookmark URL only.
- No external favicon service is used.
- Favicon image data is never stored in `bookmarks.jsonl`, `settings.json`,
  the local browser cache, or Google Drive.

## AI Processing

The MVP uses Chrome Built-in AI / Prompt API when available.

- AI analysis is intended to run locally through Chrome's built-in AI capability.
- The MVP does not include external Gemini API, OpenAI API, or other API-key fallback.
- If Chrome Built-in AI is unavailable, the extension can still save the bookmark without AI-generated fields.

## Ask AI Chat

The options page includes an "Ask AI" chat screen for asking about your saved
bookmarks.

- Ask AI searches only the locally cached bookmark list; it does not search
  the open web.
- Recommendation prompts sent to Chrome's built-in AI include only compact
  bookmark fields (an internal candidate ID, title, site domain, genre, capped
  tags, and a capped short description) — never full URLs, long-form analysis
  text, raw page excerpts, or Drive metadata.
- Chat questions, answers, and follow-up context are kept in memory only.
  They are never written to Google Drive, `chrome.storage.local`, or any
  external service, and are discarded when the chat is cleared or the page
  closes.

## Google Drive Access

The extension uses Google OAuth through Chrome's identity API.

Requested Drive scope:

```txt
https://www.googleapis.com/auth/drive.file
```

This scope allows the extension to create and manage files it creates or files opened/shared with it. The MVP uses this to create and manage its own visible folder/file:

```txt
bookmark-ai/bookmarks.jsonl
```

The extension should not request full Drive access in the MVP.

## Local Browser Storage

The extension may use `chrome.storage.local` to cache:

- Bookmark list snapshot.
- Google Drive file/folder IDs.
- Drive file metadata needed for sync.
- Last sync status and error messages.

This cache is used to make popup/options pages faster. Google Drive remains the source of truth.

## Data Sharing

MVP intent:

- Bookmark data is stored in the user's own Google Drive.
- The extension does not operate a custom server for bookmark storage.
- The extension does not sell personal data.
- The extension does not intentionally share bookmark data with third parties.
- The extension does not send page excerpts to external AI providers in MVP.

Google services and Chrome APIs are used for authentication, Drive storage, and built-in AI capabilities. Their use is subject to Google's terms and privacy policies.

## User Control

Users can:

- Delete bookmark records from the extension UI.
- Delete or inspect `bookmark-ai/bookmarks.jsonl` directly in Google Drive.
- Revoke the extension's Google account access from their Google Account settings.
- Remove the extension from Chrome.

## Data Retention

Bookmark records remain in the user's Google Drive until the user deletes them through the extension or directly from Drive.

Local cache remains in Chrome extension storage until cleared by the extension, browser data clearing, or extension removal.

## Security Notes

- OAuth client IDs are not secrets and may be embedded in the extension manifest.
- Client secrets, API keys, refresh tokens, and access tokens must not be committed to the repository.
- Development and production OAuth client IDs should be separated.
- Production OAuth configuration should use the Chrome Web Store extension ID.

## Contact and Policy URL

Before publication, replace this section with:

- Support/contact email.
- Published privacy policy URL.
- Application/site URL if available.

## Change History

- 2026-06-24: Initial MVP draft.
- 2026-07-04: Added the Site Favicons section (Chrome-resolved, display-only,
  never persisted).
- 2026-07-05: Added the Ask AI Chat section (local-cache-only retrieval,
  full-URL-free compact prompt payload, memory-only chat state).
