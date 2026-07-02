# Privacy Policy Draft

Date: 2026-06-24

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
  - Japanese description.
  - Genre.
  - Tags.
  - Long-form Japanese Markdown analysis.
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
- AI-generated Japanese description.
- Genre.
- Tags.
- A long-form, AI-generated Japanese Markdown analysis (never a copy of the
  page's raw text) and the ID of the built-in analysis profile used to
  generate it.
- Creation/update timestamps.
- AI status such as `pending`, `ready`, `unavailable`, or `failed`.

## Page Text Excerpts

The extension may temporarily extract page text to generate an AI description.

MVP privacy rule:

- Raw page text excerpts are not stored in `bookmarks.jsonl`.
- Raw page text excerpts are not intentionally persisted by the extension.
- If re-analysis is needed, the extension re-extracts content from the live page.

## AI Processing

The MVP uses Chrome Built-in AI / Prompt API when available.

- AI analysis is intended to run locally through Chrome's built-in AI capability.
- The MVP does not include external Gemini API, OpenAI API, or other API-key fallback.
- If Chrome Built-in AI is unavailable, the extension can still save the bookmark without AI-generated fields.

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
