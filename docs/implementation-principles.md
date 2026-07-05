# Implementation Principles

Date: 2026-06-24

This document captures the implementation direction for Bookmark AI Extension. It adapts relevant principles from `j5ik2o/okite-ai` skills to this Chrome extension project.

## Selected principles

The following okite-ai principles match this project and should guide implementation:

| Principle | How it applies here |
|---|---|
| Package design | Boundaries should stop change from leaking across Drive, AI, extraction, bookmark schema, cache, and UI modules. |
| Domain/model first | Implement pure bookmark/schema/merge/excerpt behavior before wiring Chrome, Drive, or Prompt API. |
| Parse, don't validate | Parse external inputs into typed, trusted values at module boundaries instead of validating and continuing with raw strings/objects. |
| Domain primitives / wrap primitives deliberately | Wrap high-risk values such as bookmark IDs, canonical URLs, Drive file IDs, AI status, and timestamps when invariants or mix-up risk justify it. |
| Always-valid model | Once a bookmark record exists as a domain value, it should satisfy schema and invariant rules. Invalid Drive/JSON/AI data must not leak inward. |
| Error classification / error handling | Treat recoverable conditions as typed results; treat programmer defects as assertions/invariants; keep user-visible failures explicit. |
| First-class collection | Put bookmark-list operations such as URL upsert, merge, filtering, and search into a collection/domain module, not scattered UI loops. |
| Intent-based deduplication | Do not extract shared helpers just because code looks similar. Share code only when the purpose and change reason are the same. |
| Tell, don't ask / Law of Demeter | Prefer methods that express intent (`bookmarks.upsertSavedTab`, `record.markAiUnavailable`) over UI code inspecting nested state and deciding everything itself. |
| Repository design | Drive repository code should be I/O-focused. Bookmark behavior belongs in bookmark/domain modules, not in the Drive client. |

## Module boundary rules

Keep the design boundaries from `docs/design.md` and treat them as change boundaries:

- `bookmarks/*` owns bookmark records, schema parsing, URL canonicalization, upsert, merge, search/filter logic, and collection invariants.
- `drive/*` owns Google auth token use, Drive folder/file bootstrap, metadata/revision reads, download, and upload.
- `extraction/*` owns current-page extraction and structured excerpt building.
- `ai/*` owns Prompt API availability, prompting, response parsing, and Japanese/English AI output.
- `storage/*` owns `chrome.storage.local` cache and cache metadata.
- `popup/*` owns save-current-tab UX orchestration.
- `options/*` owns library/search/filter/delete UX (the Options UI offers no
  re-analyze action, MIK-024; re-analysis runs from the popup flow).

Rules:

- UI modules may orchestrate use cases, but must not contain JSONL merge algorithms, Drive revision conflict logic, Prompt API parsing details, or page extraction algorithms.
- Drive modules must not decide bookmark business behavior such as duplicate handling, AI status transitions, or search semantics.
- AI modules must not persist data directly; they return parsed analysis results or typed errors.
- Extraction modules must not store raw excerpts.
- Avoid `utils`, `helpers`, or `common` unless the shared code has a single clear intent and change reason.

## Model-first implementation order

Build from pure logic outward:

1. Bookmark schema and typed constructors.
2. JSONL parse/serialize.
3. Canonical URL and ID handling.
4. `Bookmarks` collection operations: upsert, delete, merge, search, filter.
5. Excerpt builder from extracted page data.
6. AI response parser and status transitions.
7. Fake/in-memory repository and cache ports.
8. Drive repository implementation.
9. Chrome extraction/Prompt API integration.
10. Popup/options UI.

Do not start with Drive API or React UI before the core bookmark behavior is tested.

## Parse, don't validate

At every external boundary, convert raw data into trusted types once.

External boundaries include:

- JSONL lines from Drive.
- Drive API responses.
- `chrome.tabs` results.
- injected page extraction results.
- Prompt API raw text.
- `chrome.storage.local` cache.
- environment variables used for manifest configuration.

Guidelines:

- Parsing returns typed domain values or typed recoverable errors.
- After parsing, internal code should not repeat the same defensive checks everywhere.
- Invalid records from Drive should be reported and skipped/quarantined according to an explicit policy, not silently accepted.
- AI JSON output must be parsed into a structured analysis type before it can update a bookmark.

## Primitive wrapping policy

Wrap primitives when at least one is true:

- the value has an invariant;
- two values with the same primitive type are easy to mix up;
- the value crosses several module boundaries;
- related behavior belongs with the value.

Likely wrappers/brands:

- `BookmarkId`
- `CanonicalUrl`
- `BookmarkUrl`
- `DriveFolderId`
- `DriveFileId`
- `DriveRevision`
- `AiStatus`
- `IsoTimestamp`
- `Genre`
- `Tag`

Do not wrap everything mechanically. Temporary display strings, local loop counters, and one-off UI labels can remain primitives.

## Always-valid bookmark records

A `BookmarkRecord` created inside `bookmarks/*` must always satisfy:

- `schemaVersion` is supported.
- `id` is present and valid.
- `canonicalUrl` is present and parseable.
- `url` is present and parseable.
- `title` is present, even if it falls back to URL.
- `tags` is an array, possibly empty.
- `aiStatus` is one of the known statuses.
- `createdAt` and `updatedAt` are valid timestamps.
- `updatedAt` is not earlier than `createdAt`.
- raw page excerpt is absent.

Use smart constructors/parsers to enforce these rules.

## Error handling policy

Classify failures before choosing implementation style.

| Category | Meaning in this project | Handling |
|---|---|---|
| Recoverable error | Prompt API unavailable, Drive token missing, network failure, conflict detected, malformed remote record | Typed result/error; show actionable UI; keep bookmark pending/failed when appropriate. |
| Defect | Unsupported `aiStatus` created by internal code, missing required injected dependency, impossible state transition | Assertion/throw in development; fix code. Do not silently recover. |
| Fault | Google Drive outage, Chrome API failure outside expected contract, storage corruption | Surface clear failure, preserve local state when possible, avoid data loss. |

Avoid catch-all handlers that convert defects into vague user errors.

## First-class bookmark collection

Create a collection/domain module for bookmark-list behavior. It should own:

- URL-based upsert preserving `createdAt`.
- deletion by ID/canonical URL.
- revision-conflict merge by canonical URL.
- text search over title, URL, description, genre, and tags.
- genre/tag filtering.
- AI status filtering.
- sorting by updated/created time.

UI should call named operations rather than duplicating array filters and reducers across popup/options.

## Intent-based deduplication

Before extracting shared code, ask:

1. Do these two pieces of code have the same purpose?
2. Would they change for the same reason?
3. Can the shared function have a specific name that makes sense in both contexts?

If not, keep them separate even if they look similar.

Examples:

- Drive revision merge and local cache refresh may both compare timestamps, but they have different purposes. Do not force a generic `syncByTime` helper.
- Page excerpt trimming and UI text truncation both shorten text, but they serve different domains. Keep separate names and policies.
- Bookmark tag filtering and Drive file query filtering both filter lists, but their semantics differ. Do not share one generic filter builder unless the intent is truly shared.

## Tell, don't ask / Demeter guidance

Prefer intent-revealing operations:

```ts
bookmarks.upsertPending(savedTab)
bookmarks.applyAiAnalysis(canonicalUrl, analysis)
bookmarks.markAiUnavailable(canonicalUrl, reason)
bookmarks.mergeRemote(remoteBookmarks)
```

Avoid UI code that digs through nested records and manually coordinates state transitions:

```ts
// Avoid this shape in UI code
if (record.aiStatus === 'pending' && record.driveMeta.version !== latest.version) {
  // merge and mutate many fields here...
}
```

Display-only data access is acceptable. Decision-making based on internal state should live near the data/behavior owner.

## Repository / Drive client rules

Drive repository methods should be I/O oriented and should not contain bookmark-domain decisions.

Good responsibilities:

- find or create folder;
- find or create JSONL file;
- download file content and metadata;
- upload new content with metadata;
- report revision/modified metadata;
- map Drive API errors into typed repository errors.

Avoid:

- `driveRepository.upsertBookmark` if it embeds bookmark merge rules;
- `driveRepository.analyzeAndSave` if it mixes AI, extraction, and persistence;
- returning raw Drive response shapes to UI components.

## Review checklist

Before accepting implementation, check:

- [ ] Core bookmark behavior is tested without Chrome/Drive/Prompt API.
- [ ] Raw external data is parsed at boundaries.
- [ ] Invalid bookmark states cannot be constructed internally.
- [ ] Recoverable errors are typed and visible to callers.
- [ ] Defects are not swallowed as generic failures.
- [ ] Bookmark collection behavior is centralized.
- [ ] Shared helpers are based on shared intent, not visual similarity.
- [ ] UI does not contain Drive conflict logic, JSONL merge logic, or Prompt API parsing.
- [ ] Drive client does not contain bookmark-domain decisions.
- [ ] No raw page excerpt is persisted.
