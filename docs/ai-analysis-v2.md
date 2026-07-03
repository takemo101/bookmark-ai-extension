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
- On save, persist a pending bookmark durably first, then run extraction and
  Prompt API analysis in the same foreground UI flow; the save/re-analyze
  operation reports completion only after the record reaches a terminal AI
  status (`ready`/`unavailable`/`failed`) and the final result is synced
  (MIK-021).
- Use existing `aiStatus: "pending"` for the persisted-but-not-yet-analyzed
  state.
- Raw page excerpts are only held temporarily in memory during the foreground
  operation. They are not saved to Drive or persistent local storage.
- Analysis runs while the popup/options page stays open. If the UI closes
  mid-operation, the in-memory excerpt is dropped; the durable pending bookmark
  remains and the user can re-run analysis later from a valid active tab (e.g.
  by saving the page again from the popup — the Options detail sheet does not
  offer Re-analyze, MIK-024).
- Service-worker/background/offscreen Prompt API processing is not pursued for
  the MVP (MIK-020 conclusion, adopted by MIK-021).

## Non-goals

- Do not store raw page excerpts in `bookmarks.jsonl`, `settings.json`, or
  persistent local storage.
- Do not add external AI providers or API-key fallback.
- Do not broaden host permissions, add always-on content scripts, or add a
  crawler.
- Do not make the extension a general bookmark manager replacement.
- Do not implement service-worker/background/offscreen analysis; the MVP uses
  UI-open foreground analysis only (MIK-021).

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
   English, auto-selected per page — MIK-029), schema, no copied raw excerpt.
2. **Built-in or custom skill instruction**: domain-specific analysis emphasis.
3. **Page input**: title, URL, structured excerpt.

The core contract must not be user-editable. Custom skill instructions can change
analysis emphasis but cannot override the output language, schema, or privacy
rules. The target language is inferred deterministically from the page
title/excerpt script counts, falling back to the browser UI language, then
Japanese; `LanguageModel.availability()` / `create()` request the same language
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

## Foreground analysis behavior

### Current implementation (MIK-021)

- Save creates/updates a `pending` bookmark and persists it durably first, so
  nothing is lost if the flow is interrupted.
- Extraction and Prompt API analysis then run in the initiating popup/options
  foreground flow while the screen stays open; the operation resolves only
  after analysis and the final sync settle. There is no analysis queue (the
  MIK-019 in-memory queue was removed by MIK-021).
- The current page excerpt is held only in the in-memory scope of that
  operation.
- On success, the bookmark is updated to `ready` with description, genre, tags,
  analysisMarkdown, and analysisProfileId.
- If Prompt API is unavailable, the bookmark remains saved with
  `aiStatus: "unavailable"`.
- If analysis fails, the bookmark becomes `failed` with a safe error message.
- If the UI closes before analysis finishes, the in-memory excerpt is dropped
  and the bookmark remains `pending` (or the last durably written status); the
  user can re-run analysis later from a valid active tab.

### Service worker experiment (concluded)

MIK-020 prepared an experiment harness to verify whether real Chrome supports
the needed Prompt API operations from an MV3 service worker (see
[`prompt-api-service-worker-experiment.md`](./prompt-api-service-worker-experiment.md)).
Per MIK-021, service-worker/background/offscreen Prompt API processing is not
being pursued now: the MVP uses UI-open foreground analysis. The experiment doc
is kept for historical reference only.

## UI behavior

### Popup

- Save keeps the popup open and walks the visible progress trail
  (saving → extracting → analyzing → syncing) until the flow finishes.
- While the flow runs, show strong foreground guidance: analysis runs in the
  foreground and may take a while — keep the popup open and stay on the saved
  page until it finishes. The receipt shows the terminal AI status, never a
  "running in the background" state.
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
- Show which `analysisProfileId` generated the current analysis.
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
