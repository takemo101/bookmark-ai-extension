# AI Analysis v2 Design Plan

Date: 2026-07-02

## Goal

AI Analysis v2 turns saved bookmarks from short labels into durable, useful
research notes. The extension should still save the current tab quickly, but the
AI output should explain what the page is, why it matters, and how to use it
later.

For example, saving a GitHub repository should preserve a useful explanation of
what kind of tool/library/project it is, what problems it solves, and when it is
worth revisiting.

## Decisions from design grilling

- Treat the work as one design theme: **AI Analysis v2**.
- Implement in phases rather than as one large change.
- Add long-form `analysisMarkdown` in addition to the existing short
  `description`, `genre`, and `tags`.
- Keep the core AI output contract fixed:
  - output is Japanese or English, auto-selected per page (MIK-029; the
    language is part of the fixed contract, never a skill instruction);
  - output is structured JSON;
  - raw page excerpts are not persisted;
  - `analysisMarkdown` is generated analysis, not copied source text.
- Add skill-like domain instructions on top of the fixed core contract.
- Match custom skills by domain plus wildcard URL patterns.
- If multiple skills match, apply only the highest-priority / most-specific one.
- Store skill settings in Google Drive as `bookmark-ai/settings.json`.
- Keep `drive.file` scope; the settings file is created and managed by the
  extension.
- Use `updatedAt` last-writer-wins for `settings.json` conflicts in the first
  implementation.
- Built-in skills are fixed. Users can add custom skills but not edit built-in
  definitions.
- Start with four built-in skills:
  - GitHub repository;
  - technical article;
  - official documentation;
  - generic page.
- Use skill-specific Markdown templates.
- Target medium-to-long analysis, roughly 800-1500 Japanese characters
  (roughly double that in characters for English output, MIK-029). This
  long-form target is a fallback: it applies only when the selected skill's
  instruction does not specify its own `analysisMarkdown` structure or length
  (MIK-030).
- Include `analysisMarkdown` in normal bookmark search.
- Render `analysisMarkdown` safely as Markdown in the options detail pane:
  headings/lists/formatting are allowed, raw HTML is escaped or disabled.
- Store only `analysisProfileId` on each bookmark record.
- If skill settings change, existing bookmarks are not automatically reanalyzed;
  the user re-runs analysis manually.
- Save captures the selected tab, then submits one worker-owned operation:
  persist a pending bookmark, extract that exact tab, analyze, and sync the
  final outcome. Popup closure does not cancel an accepted operation.
- Use existing `aiStatus: "pending"` for the persisted-but-not-yet-analyzed state.
- Raw excerpts live only in the worker operation's memory, never persistent storage.
- Worker termination loses that excerpt; the last durable bookmark remains.
  Recovery is explicit re-saving from the page, not an automatic durable queue.
- The 2026-09-30 worker integration supersedes MIK-021's UI-lifetime restriction.
  Offscreen analysis remains out of scope; see the lifecycle contract below.

## Non-goals

- Do not store raw page excerpts in `bookmarks.jsonl`, `settings.json`, or
  persistent local storage.
- Do not add external AI providers or API-key fallback.
- Do not broaden host permissions, add always-on content scripts, or add a
  crawler.
- Do not make the extension a general bookmark manager replacement.
- Do not add Offscreen analysis, persistent excerpts, or an automatic replay queue.

## Data model

### Bookmark record additions

Add optional fields to bookmark records while preserving backward compatibility:

```ts
type BookmarkRecordV1 = {
  // existing fields...
  description?: string;
  genre?: string;
  tags: string[];
  aiStatus: 'pending' | 'ready' | 'unavailable' | 'failed';

  /** Long-form generated Markdown analysis. Never raw page excerpt text. */
  analysisMarkdown?: string;

  /** ID of the analysis skill/profile used for the latest ready analysis. */
  analysisProfileId?: string;
};
```

`description` remains the short summary for compact UI. `analysisMarkdown` is
for the options detail pane and search.

### Settings file

Create a new Drive-managed file:

```txt
bookmark-ai/settings.json
```

Suggested shape:

```ts
type SettingsV1 = {
  schemaVersion: 1;
  updatedAt: string;
  analysisSkills: {
    custom: AnalysisSkill[];
  };
};

type AnalysisSkill = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  domains: string[];
  urlPatterns: string[];
  instruction: string;
  createdAt: string;
  updatedAt: string;
};
```

Built-in skills live in code and are merged with custom skills at runtime.
`settings.json` stores only custom skills in the first version.

### Conflict policy for settings

Use file-level `updatedAt` last-writer-wins for the first implementation.

Rationale:

- settings edits are comparatively rare;
- per-skill merge is more complex;
- the project already has heavier merge logic in bookmarks where it matters
  most.

## Skill matching

Each analysis run selects one profile:

1. Build the candidate set from enabled built-in and custom skills.
2. Match by domain and wildcard URL patterns.
3. Pick the highest-priority candidate.
4. If tied, pick the most-specific URL pattern.
5. If no skill matches, use the generic built-in profile.

Wildcard examples:

```txt
https://github.com/*/*
https://zenn.dev/*/articles/*
https://developer.mozilla.org/*
```

The implementation should parse external skill settings before internal use and
ignore/report invalid skill definitions safely.

## Prompt composition

Use a layered prompt model:

1. **Core contract** (fixed): JSON-only, target output language (Japanese or
   English, following the current UI/browser language — MIK-033), schema, no
   copied raw excerpt.
2. **Built-in or custom skill instruction**: domain-specific analysis emphasis.
3. **Page input**: title, URL, structured excerpt.

The core contract must not be user-editable. Custom skill instructions can change
analysis emphasis but cannot override the output language, schema, or privacy
rules. The target language is the current browser UI language (MIK-033); only
when no supported UI/browser language is available is it inferred
deterministically from the page title/excerpt script counts, then Japanese.
`LanguageModel.availability()` / `create()` request the same language
via `expectedOutputs`. The JSON keys are identical in both languages.

### Output-shape priority (MIK-030)

Within that layered model, the prompt makes the priority explicit:

1. **Non-overridable fixed contract**: JSON-only output; exactly the keys
   `description` / `genre` / `tags` / `analysisMarkdown`; the tags maximum;
   the auto-selected output language; no copied raw excerpt; no raw HTML; no
   external APIs/providers, API keys, or model selection.
2. **Selected skill instruction**: may control the `analysisMarkdown` heading
   structure, sections, length, and level of detail — including concise
   custom shapes (e.g. a YouTube skill requesting only `## 動画概要` and
   `## コメントピックアップ` with a short overview) — in addition to analysis
   emphasis.
3. **Default long-form fallback**: the roughly 800-1500 Japanese character
   (double for English) detailed analysis with `##` headings and bullet lists
   applies only when the selected skill's instruction does not specify a
   structure or length.

The prompt states the fixed contract as always taking precedence over the
skill instruction, and states the long-form default as conditional on the
instruction being silent about shape, so a concise skill is never forced back
into generic long-form sections.

Suggested output JSON:

```json
{
  "description": "短い概要",
  "genre": "開発ツール",
  "tags": ["GitHub", "CLI", "自動化"],
  "analysisMarkdown": "## このリポジトリは何か\n\n..."
}
```

## Built-in skills

### GitHub repository

Match examples:

```txt
github.com/*/*
```

Focus:

- what tool/library/application it is;
- what problem it solves;
- main features;
- expected users;
- adoption/use-case notes;
- caveats visible from the page.

### Technical article

Match examples:

```txt
zenn.dev/*
qiita.com/*
dev.to/*
medium.com/*
```

Focus:

- article thesis;
- problem/context;
- implementation/design ideas;
- reusable lessons;
- why it is worth saving.

### Official documentation

Match examples:

```txt
developer.mozilla.org/*
docs.*
*.dev/docs/*
```

Focus:

- API/feature being documented;
- core concepts;
- common operations;
- constraints and warnings;
- implementation reference points.

### Generic page

Fallback for unmatched pages.

Focus:

- what the page is;
- key points;
- why it may be worth revisiting;
- useful keywords.

## Popup-independent analysis behavior

### Current implementation (2026-09-30)

- Save creates/updates a `pending` bookmark and persists it durably first, so
  nothing is lost if the flow is interrupted.
- The popup sends a captured tab ID/URL/title; the worker never queries a later
  active tab. Extraction verifies that the tab has not navigated. Keep the page
  open until extraction finishes, but the popup may close after acceptance.
- The worker owns the existing application flow through final Drive/cache
  persistence. Acknowledgment means accepted, not yet durably saved.
- All bookmark mutations (including Options sync/delete) share one worker lock.
  Concurrent requests return `busy` and require retry; they are not queued.
  Cache reads remain immediate. This prevents stale collection writes or a
  late analysis resurrecting a deleted record.
- No job/excerpt is persisted. Short status messages expose in-memory progress;
  reopening the popup attaches to a running save without submitting it again.
- Worker Prompt runs only when already available. The explicit **Prepare AI
  model** button downloads/prepares Prompt in the foreground without page input;
  keep that popup open during preparation. Summarizer fallback never downloads.
- Analysis has a three-minute deadline, aborts native sessions on expiry, and
  ignores late outcomes. During accepted work only, a trivial extension API call
  every 25 seconds follows Chrome's exceptional long-operation guidance. It stops
  at completion or four minutes, even if an API hangs. There is no idle/startup
  heartbeat. UI polling also stops at four minutes, and does not release a still
  running mutation lock. Chrome can still terminate the worker unexpectedly.
  Source: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
- The current page excerpt is held only in the in-memory scope of that
  operation.
- On success, the bookmark is updated to `ready` with description, genre, tags,
  analysisMarkdown, and analysisProfileId.
- If Prompt API is unavailable or analysis fails, the analyzer may produce an
  on-device Summarizer API concise fallback as specified in
  [`summarizer-fallback.md`](summarizer-fallback.md). A successful fallback is
  `ready` but visibly marked as a concise summary; if it cannot run, the
  original `unavailable` or `failed` result is retained.
- If Chrome terminates/restarts the worker, the in-memory job and excerpt are
  lost, not replayed. The bookmark remains at its last durable status (usually
  `pending`). Re-save from the original page to retry. Failed Drive writes keep
  the existing unsynced-cache flag and can be retried via normal sync.

### User-requested analysis stop

- **Stop analysis** is available only during AI analysis, including an active
  Summarizer fallback, and also after reopening the popup onto that save.
- The command targets the observed job ID. Missing/stale IDs and saving,
  extraction, or final-sync stages reject stop without affecting another job.
- Worker stop aborts Prompt/Summarizer creation and inference and destroys
  sessions. Late results and AI progress are ignored; stop does not start a
  fallback session or move final-sync progress back to analysis.
- This stops AI, not saving: the bookmark remains, and the normal final
  cache/Drive write records `failed` with a fixed, content-free stopped reason.
  No new durable status, job flag, queue, permission, or excerpt storage is added.
- A stop acknowledgment is not a finished save. The popup keeps observing and
  the mutation lock remains held through final persistence. A failed Drive write
  retains the existing pending-sync recovery. Re-save from the page to retry AI.
- A live receipt labels the result as stopped rather than an AI failure. A worker
  restart still loses volatile receipts; cache retains the saved bookmark/reason.
  Real Chrome native-abort and Drive checks remain manual.

### Service worker experiment (concluded)

MIK-020 prepared an experiment harness to verify whether real Chrome supports
the needed Prompt API operations from an MV3 service worker (see
[`prompt-api-service-worker-experiment.md`](./prompt-api-service-worker-experiment.md)).
MIK-021 originally selected UI-open foreground analysis. That historical
conclusion has been superseded by the 2026-09-30 recheck below.

### Popup-independent feasibility recheck (2026-09-30)

The user requested revisiting popup-independent analysis. A separate,
synthetic-only extension tested service-worker and offscreen execution.
The harness was removed at the user's request after integration; its record remains:
[`popup-independent-ai-experiment.md`](./popup-independent-ai-experiment.md).
The user's v0.0.2 report confirms Japanese Prompt and Summarizer generation in
an extension service worker on Chrome 153.0.0.0, with the initiating UI absent
at the observed start/end boundaries and the result stored independently.
The worker is now the implemented integration candidate; Offscreen testing
remains deferred. This short run used diagnostic writes that reset idle timing.
Long inference, forced worker interruption, initial setup, and final Drive
persistence still require manual production-extension validation. Unit tests
and this feasibility run do not satisfy those gates. Permissions are unchanged.

## UI behavior

### Toolbar badge

The global extension icon reports the latest accepted Save/Re-analyze operation,
independently of whether the popup is open:

- Blue `SAVE` → saving the pending bookmark; `READ` → extracting the page;
  `AI` → analysis (including Summarizer fallback); `SYNC` → final Drive sync.
- Amber `STOP` → stopping analysis or a stopped result synced to Drive; final
  persistence still shows blue `SYNC`. A stopped but unsynced result shows amber
  `!` with a stopped/local-only tooltip, never a green success.
- Green `✓` → AI result is ready (full analysis or concise fallback) and its
  final write reached Drive. Merely accepting or finishing a job is not success.
- Amber `!` → AI unavailable/pending, or saved locally without confirmed Drive
  sync; red `!` → save/analysis failure. Open the popup to inspect the bookmark.
- The icon's tooltip explains the state in the browser UI language (ja/en),
  using fixed text only: no page title, URL, excerpt, or raw browser error.

The result badge remains until another save starts or the worker restarts.
A fresh worker clears the badge and restores the default tooltip because it has
no surviving in-memory job; it does not infer success from cache. Options-only
sync/delete, status polling, and rejected busy requests do not replace this
latest-save indicator. Display writes are ordered and best-effort: Chrome action
API failure cannot cancel saving, and a finished job's late progress cannot
replace a newer job's badge. No extra permission, storage, heartbeat, or timer
is added for badge display. Real Chrome icon/lifetime checks remain manual.

### Popup

- While open, Save walks the progress trail (saving → extracting → analyzing
  → syncing). It may close while the worker completes the accepted operation.
- Reopening attaches to an active save and shows progress; completed bookmarks
  are read from cache even after the worker exits. Interrupted pending records
  explain explicit re-saving. First model preparation remains foreground-only.
- **Stop analysis** is a secondary action during analysis only. After clicking,
  it is disabled while AI stops and bookmark persistence finishes; the receipt
  explains that the bookmark remains and can be analyzed again.
- Keep recent bookmark display compact: one line per bookmark (title + AI
  status + inline re-analyze), with `description` available as a tooltip.
- If the current page is already bookmarked, show that state on the current
  tab receipt with a Remove affordance (MIK-027); a repeated Save & Analyze
  is the normal duplicate upsert and refreshes the analysis.
- Clicking a recent bookmark opens a compact detail overlay (MIK-028) that
  renders the cached `analysisMarkdown` through the same safe Markdown
  component as Options: `react-markdown` + `remark-gfm` only, no
  `rehype-raw`, no `dangerouslySetInnerHTML`, links open in a new tab with
  `rel="noreferrer"`. Back/Close return to the receipt; the popup never
  becomes the full ledger.

### Options

- Clicking a bookmark row opens a detail side sheet (fullscreen on narrow
  viewports) that renders the full `analysisMarkdown` safely as Markdown via
  `react-markdown` + `remark-gfm`: no `rehype-raw`, no
  `dangerouslySetInnerHTML`, so raw HTML in AI output is never executed;
  Markdown links open in a new tab with `rel="noreferrer"`.
- The detail sheet offers Open, Delete, and Close only; it does not trigger
  re-analysis (MIK-024).
- Search includes `analysisMarkdown`.
- Show which analysis profile generated the current analysis as a readable
  name resolved from `analysisProfileId` (MIK-031): built-in profiles show
  their built-in names, custom profiles show the custom skill name from
  settings, and an unknown id falls back to the raw id. In the detail sheet a
  custom profile name is clickable and opens Analysis skills with that
  skill's edit modal; built-in and unknown labels stay read-only text. The
  popup detail shows built-in names only (custom/unknown ids fall back to the
  raw id) and offers no edit navigation.
- Provide custom skill CRUD on a dedicated top-level "Analysis skills"
  settings screen (MIK-025), not below the bookmark list:
  - add / edit via a modal form with Close/Cancel (Escape and backdrop click
    also close);
  - delete;
  - enable/disable;
  - domain list;
  - wildcard URL patterns;
  - instruction textarea with authoring guidance next to the form: what the
    instruction changes — analysis emphasis and the `analysisMarkdown` output
    shape (headings, sections, length), which takes priority over the default
    long-form format (MIK-030) — per-source examples (GitHub repository /
    technical article / official docs / concise video page), safety warnings
    (no secrets, no raw page persistence, no external APIs/providers, no
    output language or model changes, no output schema or privacy-contract
    changes), and a plain-language explanation of domain/pattern/priority
    matching.
- Built-in profiles are visible as defaults but not editable in the first
  implementation.

## Implementation phases

### Phase 1: Long-form analysis data model and display

- Add `analysisMarkdown` and `analysisProfileId` to AI parser/types and bookmark
  records.
- Update prompt output contract for long-form Markdown.
- Add built-in profiles in code and select the best match.
- Render Markdown safely in the options detail pane.
- Include analysisMarkdown in search.

### Phase 2: Drive-synced custom skills

- Add `bookmark-ai/settings.json` repository support.
- Add settings cache parsing and local state.
- Add custom skill CRUD UI in options.
- Merge built-in and custom skills at analysis time.
- Apply file-level `updatedAt` last-writer-wins conflict handling.

### Phase 3: Queue UX (superseded by MIK-021)

- Historical: MIK-019 split save completion from AI analysis completion via an
  in-memory queue. MIK-021 replaced this with the UI-open foreground flow
  described in "Foreground analysis behavior"; raw excerpts stay out of
  persistent storage and pending bookmarks still survive a UI close.

### Phase 4: Service worker Prompt API experiment (concluded)

- MIK-020 built the experiment harness; per MIK-021 the decision is to not
  pursue service-worker/background Prompt API processing now.
