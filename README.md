# Bookmark AI Extension

Chrome extension idea for saving the current tab as an AI-enriched bookmark, stored as portable JSONL in the user's own Google Drive.

## Current status

This project is intentionally minimal. No implementation scaffold has been chosen yet.

Start here:

- [`docs/handoff.md`](docs/handoff.md) — original conversation summary, decisions, MVP scope, open questions, and suggested next steps.
- [`docs/design.md`](docs/design.md) — refined MVP design for implementation.
- [`docs/implementation-principles.md`](docs/implementation-principles.md) — implementation principles adapted from okite-ai skills.
- [`docs/publication.md`](docs/publication.md) — Chrome Web Store publication and OAuth plan.
- [`docs/privacy-policy.md`](docs/privacy-policy.md) — privacy policy draft for MVP/publication.

## Agreed direction

- Chrome extension, not CLI-first.
- Google Drive as user-owned storage.
- Visible Drive folder, likely `bookmark-ai/`.
- `bookmarks.jsonl` as the primary data file.
- Save current tab in the MVP.
- Generate AI description and genre.
- Prefer Chrome Built-in AI when available.
- Fallback to user-provided AI API key later.

## Next step

Finalize the implementation plan and choose the extension stack:

- Vite + TypeScript + React, or
- Plain TypeScript Manifest V3.
