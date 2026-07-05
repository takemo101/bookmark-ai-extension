# Bookmark AI Extension

Chrome extension idea for saving the current tab as an AI-enriched bookmark, stored as portable JSONL in the user's own Google Drive.

Public site: <https://takemo101.github.io/bookmark-ai-extension/>

## Current status

The MV3 extension is wired end-to-end (Vite + TypeScript + React + `@crxjs/vite-plugin` + Vitest, managed with Bun). The popup (save current tab) and options page (research ledger) run on real adapters: `chrome.identity` + Google Drive for storage, `chrome.scripting` for page extraction, the Chrome Built-in AI / Prompt API for analysis, and `chrome.storage.local` as cache. The runtime can be loaded as an unpacked extension and exercised with the [manual smoke checklist](docs/smoke-checklist.md).

Start here:

- [`docs/handoff.md`](docs/handoff.md) — original conversation summary, decisions, MVP scope, open questions, and suggested next steps.
- [`docs/design.md`](docs/design.md) — refined MVP design for implementation.
- [`docs/ai-analysis-v2.md`](docs/ai-analysis-v2.md) — AI Analysis v2 plan for long-form Markdown analysis, analysis skills, and queue behavior.
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
bun run check          # format check + typecheck + test (the gate automation wraps)
bun run validate       # check + production build (the full local baseline)
bun run build          # production extension build into dist/
```

### Task automation (just) and git hooks (lefthook)

A root [`justfile`](justfile) wraps the package scripts so humans and AI workers
share one command surface, and [`lefthook.yml`](lefthook.yml) runs the same
baseline as a pre-commit hook. Both call the package scripts above — they do not
duplicate their internals.

```sh
just                   # list all recipes (alias for `just --list`)
just install           # bun install
just hooks-install     # install the lefthook git hooks for this checkout
just hooks-run         # run the pre-commit baseline without committing
just typecheck         # bun run typecheck
just test              # bun run test
just check             # format check + typecheck + test
just format-check      # check repository formatting without writing changes
just fix               # apply Biome formatting fixes (bun run fix)
just build             # bun run build (needs VITE_GOOGLE_OAUTH_CLIENT_ID)
just validate          # format check + typecheck + test + build — the default final check
```

`just validate` is the documented local validation baseline and the default
final check for AI-worker implementation Issues. For its compile-only build it
supplies a non-functional dummy `VITE_GOOGLE_OAUTH_CLIENT_ID` unless one is
already set in the environment, so it runs without real OAuth values. To
validate against your real dev client ID, export `VITE_GOOGLE_OAUTH_CLIENT_ID`
(or keep it in `.env.local`) and run `bun run validate`.

The lefthook pre-commit hook runs `format:check`, `typecheck`, then `test`
sequentially (`parallel: false`) to avoid duplicated concurrent runs. It does
not run the build, which needs an OAuth client ID; use `just validate` for that.
After cloning, run `just install && just hooks-install` once to enable the hook.

### OAuth client ID

The Google OAuth client ID is injected into the manifest from the environment.

1. Copy [`.env.example`](.env.example) to `.env.local` (git-ignored).
2. Set `VITE_GOOGLE_OAUTH_CLIENT_ID` to your **development** OAuth client ID.

`bun run build` fails with a clear error if `VITE_GOOGLE_OAUTH_CLIENT_ID` is missing — production/extension builds never fall back to a placeholder. `bun run dev` and the tests use a documented non-functional placeholder when it is unset. The client ID is not a secret, but dev and production must use separate client IDs (see [`docs/publication.md`](docs/publication.md)). Never commit `.env.local` or any secret/token.

### Load the unpacked extension

The development OAuth client is bound to the unpacked extension ID, so first
builds use a dummy client ID just to obtain that ID:

```sh
# 1. Build the bundle with any non-empty client ID (dummy is fine to just load it):
VITE_GOOGLE_OAUTH_CLIENT_ID=dummy.apps.googleusercontent.com bun run build

# 2. Load the generated dist/ folder via chrome://extensions
#    (Developer mode → Load unpacked), then copy the extension ID shown there.

# 3. In Google Cloud Console, create an OAuth client of type "Chrome Extension"
#    bound to that extension ID (see docs/publication.md "Development Setup"),
#    put the real dev client ID in .env.local, then rebuild and reload:
bun run build          # reads VITE_GOOGLE_OAUTH_CLIENT_ID from .env.local
```

The dummy-env build above is also the quick way to confirm the bundle compiles
and `dist/manifest.json` keeps only the MVP permissions and the `drive.file`
scope, without needing a real OAuth client.

### Manual smoke test

After loading the unpacked build with a real dev client ID, run the
[manual smoke checklist](docs/smoke-checklist.md) to verify sign-in, Drive
folder/file creation, save (AI available and unavailable), and the options
list/search/delete flows (re-analysis runs from the popup's recent list;
the Options UI offers no re-analyze action).

### Source layout

```txt
config/                  build-time config (OAuth client ID resolution)
manifest.config.ts       MV3 manifest (permissions, OAuth scope)
src/
  background/            service worker
  popup/                 Bookmark Receipt save-current-tab UI
  options/               Research Ledger management UI (Library / Analysis skills / Ask AI)
  lib/
    bookmarks/           schema, JSONL, upsert/merge, search (domain)
    settings/            analysis-skill settings domain (settings.json schema/CRUD)
    drive/               Google auth + Drive I/O
    extraction/          page extraction + excerpt building
    ai/                  Prompt API availability + analysis + Ask AI recommendation
    favicon/             Chrome _favicon URL resolution (display-only)
    i18n/                browser-UI-language selection shared by popup/options
    storage/             chrome.storage.local cache
    app/                 use cases (ports + orchestration, Chrome-free)
    runtime/             extension composition: chrome.scripting + Drive adapters
```

## MVP direction

- Chrome extension, not CLI-first.
- Google Drive as user-owned storage.
- Visible Drive folder: `bookmark-ai/`.
- `bookmarks.jsonl` as the primary data file.
- Save current tab in the MVP.
- Generate an AI description, genre, and tags in Japanese or English
  (auto-selected from the browser UI language).
- Use Chrome Built-in AI / Prompt API only in the MVP.
- Do not add external AI API fallback in the MVP.

## Next step

Continue with the mikan implementation plan from the remaining open issues. The core domain, extraction, AI, Drive, cache/use-case, popup, options, and runtime-wiring slices have been merged; final MVP QA and release-readiness checks remain.
