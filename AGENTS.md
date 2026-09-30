## Project entry points

Use durable docs as the source of truth. Before changing behavior, architecture, storage, OAuth scopes, permissions, AI behavior, publication/privacy semantics, or user-visible terminology, read the relevant docs first:

1. `docs/design.md` — canonical MVP design and architecture.
2. `docs/ai-analysis-v2.md` — AI Analysis v2 plan for long-form Markdown
   analysis, analysis skills, and foreground analysis behavior.
3. `docs/summarizer-fallback.md` — approved on-device Summarizer fallback
   contract for Prompt API terminal failures.
4. `docs/implementation-principles.md` — implementation principles adapted from okite-ai skills.
5. `docs/publication.md` — Chrome Web Store and OAuth publication plan.
6. `docs/privacy-policy.md` — privacy constraints and policy draft.
7. `docs/local-unpacked-setup.md` — detailed local unpacked-extension
   setup and dev OAuth guide.
8. `docs/handoff.md` — historical handoff only.

If `docs/handoff.md` conflicts with newer durable docs, trust
`docs/design.md`, `docs/ai-analysis-v2.md`,
`docs/summarizer-fallback.md`, `docs/implementation-principles.md`,
`docs/publication.md`, `docs/privacy-policy.md`, and
`docs/local-unpacked-setup.md`.

## MVP scope guard

This project is a Chrome extension for AI-enriched current-tab bookmarks stored in the user's Google Drive. Do not silently expand the MVP into:

- a general bookmark manager replacement;
- a multi-user collaboration service;
- a custom backend/database service;
- a semantic search engine;
- a Chrome bookmark tree synchronizer;
- a generic web clipping/archive system;
- a site-specific crawler or adapter framework;
- an external AI provider aggregator.

Before adding any of those concepts, stop and re-check `docs/design.md` with the user.

## Architecture boundaries

Keep responsibilities separated:

- `drive/*` owns Google auth, Drive folder/file bootstrap, download/upload, and revision metadata.
- `bookmarks/*` owns schema, JSONL parsing/serialization, URL upsert, and merge behavior.
- `extraction/*` owns current-page extraction and structured excerpt construction.
- `ai/*` owns Prompt API availability and Japanese analysis output.
- `storage/*` owns `chrome.storage.local` cache.
- `popup/*` owns save-current-tab UX.
- `options/*` owns list/search/filter/delete/re-analyze UX.

Do not mix Drive API details, Prompt API prompting, JSONL merge logic, and React UI state in one module.

## Testability rules

Follow `docs/implementation-principles.md` for model-first implementation, parsing at boundaries, typed errors, first-class bookmark collections, and intent-based deduplication.

Default tests should not require real Chrome, Google Drive, or Prompt API access. Use fake/injected dependencies for:

- Drive client;
- OAuth token provider;
- Prompt API client;
- tab/page extractor;
- local cache;
- clock;
- ID generator;
- logger/redactor.

Unit test JSONL parsing, schema validation, URL canonicalization, upsert behavior, conflict merge handling, excerpt building, and AI response parsing before broad integration work.

## Security and privacy rules

- Use only `https://www.googleapis.com/auth/drive.file` in the MVP.
- Do not request broad host permissions in the MVP.
- Use `activeTab` + `scripting`; inject page extraction only after the user clicks Save.
- Do not persist raw page excerpts.
- Do not commit OAuth client secrets, API keys, access tokens, refresh tokens, or private credentials.
- OAuth client IDs are not secrets, but dev/prod client IDs must be separated.
- Keep Google Drive as the source of truth and `chrome.storage.local` as cache only.
- Redact tokens and sensitive values from logs, errors, reports, and test fixtures.

## GitButler / but workflow

Use the `but` GitButler workflow for version-control mutations in this repository.

- Use `but status -fv` before version-control mutations when branch, stack, commit, conflict, or history context matters.
- Use `but diff` first when selecting dirty files or hunks for a commit.
- Use `but` instead of git write commands.
- Do not run `git add`, `git commit`, `git push`, `git checkout`, `git merge`, `git rebase`, or `git stash` for write operations.
- Use IDs reported by `but status -fv`, `but diff`, or `but show`; do not hardcode IDs.
- Add `--status-after` to `but` mutation commands when available.
- Read-only git inspection is acceptable when needed.
- If `but` cannot perform a requested GitHub push/PR step because repository target metadata is not configured, explain the limitation before using a narrowly scoped fallback.
