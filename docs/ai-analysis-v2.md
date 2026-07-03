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
  - output is Japanese;
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
- Target medium-to-long analysis, roughly 800-1500 Japanese characters.
- Include `analysisMarkdown` in normal bookmark search.
- Render `analysisMarkdown` safely as Markdown in the options detail pane:
  headings/lists/formatting are allowed, raw HTML is escaped or disabled.
- Store only `analysisProfileId` on each bookmark record.
- If skill settings change, existing bookmarks are not automatically reanalyzed;
  the user re-runs analysis manually.
- On save, return quickly once a pending bookmark is persisted. AI analysis runs
  through a queue instead of blocking the save UX.
- Use existing `aiStatus: "pending"` for analysis waiting/processing states in
  the initial implementation.
- Raw page excerpts for queued analysis are only held temporarily in memory or a
  non-durable session-level queue. They are not saved to Drive or persistent
  local storage.
- Initial queue processing runs while popup/options are open. If the UI closes,
  pending bookmarks remain and can be analyzed when the user revisits the page or
  manually re-analyzes from a valid active tab.
- Service-worker background Prompt API processing should be investigated in a
  separate experiment issue before committing to it.

## Non-goals

- Do not store raw page excerpts in `bookmarks.jsonl`, `settings.json`, or
  persistent local storage.
- Do not add external AI providers or API-key fallback.
- Do not broaden host permissions, add always-on content scripts, or add a
  crawler.
- Do not make the extension a general bookmark manager replacement.
- Do not implement service-worker background analysis until the Prompt API
  behavior is verified in real Chrome.

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

1. **Core contract** (fixed): JSON-only, Japanese, schema, no copied raw excerpt.
2. **Built-in or custom skill instruction**: domain-specific analysis emphasis.
3. **Page input**: title, URL, structured excerpt.

The core contract must not be user-editable. Custom skill instructions can change
analysis emphasis but cannot override output schema or privacy rules.

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

## Queue behavior

### Initial implementation

- Save creates/updates a `pending` bookmark and returns quickly.
- The current page excerpt is captured and placed in an in-memory queue while the
  popup/options page is alive.
- The queue analyzes entries sequentially to avoid overlapping Prompt API work.
- On success, the bookmark is updated to `ready` with description, genre, tags,
  analysisMarkdown, and analysisProfileId.
- If Prompt API is unavailable, the bookmark remains saved with
  `aiStatus: "unavailable"`.
- If analysis fails, the bookmark becomes `failed` with a safe error message.
- If the UI closes before analysis finishes, the queued excerpt is lost and the
  bookmark remains `pending` or `failed`; the user can re-run analysis later from
  a valid active tab.

### Service worker experiment

Before implementing background processing, create an experiment to verify whether
real Chrome supports the needed Prompt API operations from an MV3 service worker:

- availability probe;
- session creation;
- prompt execution;
- lifecycle behavior during a slow prompt.

See [`prompt-api-service-worker-experiment.md`](./prompt-api-service-worker-experiment.md) for the real-Chrome run protocol and run-record table for this experiment.

Only if that experiment passes should a later issue add durable background queue
processing.

## UI behavior

### Popup

- Save returns after pending bookmark persistence.
- Show that AI analysis is queued/running separately from bookmark saved state.
- Keep recent bookmark display compact using `description`.

### Options

- Detail pane renders `analysisMarkdown` safely as Markdown.
- Search includes `analysisMarkdown`.
- Show which `analysisProfileId` generated the current analysis.
- Provide custom skill CRUD:
  - add;
  - edit;
  - delete;
  - enable/disable;
  - domain list;
  - wildcard URL patterns;
  - instruction textarea.
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

### Phase 3: Queue UX

- Split bookmark save completion from AI analysis completion.
- Add an in-memory analysis queue for extracted page analysis.
- Keep raw excerpts out of persistent storage.
- Preserve pending bookmarks if the UI closes before analysis completes.

### Phase 4: Service worker Prompt API experiment

- Verify real Chrome service worker Prompt API support.
- Record whether background queue processing is viable.
- Decide whether to implement a later background processing issue.
