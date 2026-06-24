# Bookmark AI Extension

Chrome extension idea for saving the current tab as an AI-enriched bookmark, stored as portable JSONL in the user's own Google Drive.

## Current status

The MV3 extension scaffold is in place (Vite + TypeScript + React + `@crxjs/vite-plugin` + Vitest, managed with Bun). Popup and options pages currently render minimal placeholders; Drive sync and AI analysis are not implemented yet.

Start here:

- [`docs/handoff.md`](docs/handoff.md) — original conversation summary, decisions, MVP scope, open questions, and suggested next steps.
- [`docs/design.md`](docs/design.md) — refined MVP design for implementation.
- [`docs/implementation-principles.md`](docs/implementation-principles.md) — implementation principles adapted from okite-ai skills.
- [`docs/publication.md`](docs/publication.md) — Chrome Web Store publication and OAuth plan.
- [`docs/privacy-policy.md`](docs/privacy-policy.md) — privacy policy draft for MVP/publication.

## Development

This project uses [Bun](https://bun.sh) as the package manager.

```sh
bun install            # install dependencies
bun run dev            # start Vite dev build (uses a dev placeholder OAuth client ID if unset)
bun run typecheck      # tsc --noEmit
bun run test           # run the Vitest suite once
bun run test:watch     # run Vitest in watch mode
bun run check          # typecheck + test (the gate later automation wraps)
bun run build          # production extension build into dist/
```

### OAuth client ID

The Google OAuth client ID is injected into the manifest from the environment.

1. Copy [`.env.example`](.env.example) to `.env.local` (git-ignored).
2. Set `VITE_GOOGLE_OAUTH_CLIENT_ID` to your **development** OAuth client ID.

`bun run build` fails with a clear error if `VITE_GOOGLE_OAUTH_CLIENT_ID` is missing — production/extension builds never fall back to a placeholder. `bun run dev` and the tests use a documented non-functional placeholder when it is unset. The client ID is not a secret, but dev and production must use separate client IDs (see [`docs/publication.md`](docs/publication.md)). Never commit `.env.local` or any secret/token.

### Load the unpacked extension

```sh
bun run build          # with VITE_GOOGLE_OAUTH_CLIENT_ID set in .env.local
# then load the generated dist/ folder via chrome://extensions (Developer mode → Load unpacked)
```

### Source layout

```txt
config/                  build-time config (OAuth client ID resolution)
manifest.config.ts       MV3 manifest (permissions, OAuth scope)
src/
  background/            service worker
  popup/                 save-current-tab UI (placeholder)
  options/               library management UI (placeholder)
  lib/
    bookmarks/           schema, JSONL, upsert/merge, search (domain)
    drive/               Google auth + Drive I/O
    extraction/          page extraction + excerpt building
    ai/                  Prompt API availability + Japanese analysis
    storage/             chrome.storage.local cache
```

## MVP direction

- Chrome extension, not CLI-first.
- Google Drive as user-owned storage.
- Visible Drive folder: `bookmark-ai/`.
- `bookmarks.jsonl` as the primary data file.
- Save current tab in the MVP.
- Generate Japanese AI description, genre, and tags.
- Use Chrome Built-in AI / Prompt API only in the MVP.
- Do not add external AI API fallback in the MVP.

## Next step

Continue with the mikan implementation plan, starting from `MIK-002` after this scaffold is merged.
