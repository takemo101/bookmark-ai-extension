<!-- MEMANTO-MANAGED-SECTION -->
## MEMANTO - Your Active Memory Companion

**MEMANTO is not a passive store. It is an active companion agent that works alongside you.**
Don't treat MEMANTO like a static blob you query once and forget. It's a teammate you keep
talking to, every preference, decision, and correction flows through it. MEMANTO remembers,
recalls, and answers so you hold context across sessions, honor prior decisions, and avoid
repeating mistakes the user already corrected.

Every memory operation in this session goes through MEMANTO. There is no exception.

> **CRITICAL**: All `memanto` commands are **shell commands**. Always run them using the terminal.
> Never simulate, describe, or "pretend to call" them. If you cannot run the shell, say so explicitly instead of inventing memory state.

### NON-NEGOTIABLE RULES

These are not suggestions. Follow each one on every turn.

1. **Read `MEMORY.md` before doing anything.** It is auto-synced at session start and holds
   the user's preferences, facts, goals, instructions, decisions, and commitments from every
   prior session. You MUST honor what is written there. If you act against it, you are
   breaking continuity the user is paying for.
2. **Search memory before saying you don't know.** If the user asks about past context, an
   earlier decision, a preference, or anything you are unsure about, you MUST run `recall`
   or `answer` first. Saying "I don't have context" without searching is a failure.
3. **Store proactively. Do not wait to be asked.** The moment a memory-worthy event happens
   — a preference stated, a decision made, a fact learned, an instruction given, a goal set,
   a mistake corrected — run `memanto remember` immediately, in the same turn.
4. **Always pass full metadata to `remember`.** Every `memanto remember` call MUST include
   `--type`, `--confidence`, `--provenance`, and `--source <your_agent_name>`. Never let
   these default. Untyped, unsourced memories pollute the agent's recall quality.
5. **One memory operation goes through MEMANTO. All of them do.** Do not keep mental notes,
   in-context scratch pads, or "I'll remember this for next time" promises. If it matters
   beyond this turn, it goes into MEMANTO. If it doesn't, drop it.

### Memory Operations — Use the Right One

MEMANTO gives you three primitives. They are equal-priority. Pick by intent, not by habit.

| You want to... | Use | Why |
|---|---|---|
| Read raw memory chunks and apply them as context | `memanto recall "query"` | Best for context-building, multi-step work, comparing options |
| Get one synthesized, grounded answer to a direct question | `memanto answer "question"` | Best for "what did we decide / prefer / commit to?" — saves you reading and merging |
| Persist something memory-worthy | `memanto remember "content" --type ... --confidence ... --provenance ... --source ...` | Every preference, decision, fact, instruction, goal, lesson |
| See what changed since last time | `memanto recall --changed-since "last 7 days"` | Catching up after a break |
| See the most recent memories | `memanto recall --recent` | Fast context refresh |

Do NOT always default to `recall`. If the user asked a direct question, `answer` is usually
the right tool — it returns a grounded synthesis so you don't burn tokens re-reading raw
chunks.

### When to Call `remember` (Examples — Run Immediately)

- User says *"I prefer tabs over spaces"*:
  `memanto remember "User prefers tabs over spaces for indentation" --type preference --confidence 1.0 --provenance explicit_statement --source <your_agent_name>`
- You decide to use Library X for reason Y:
  `memanto remember "Chose Library X for reason Y; commit abc123" --type decision --confidence 0.95 --provenance inferred --source <your_agent_name>`
- User corrects an approach:
  `memanto remember "User corrected: use pytest, not unittest" --type learning --confidence 1.0 --provenance corrected --source <your_agent_name>`
- A failed approach taught you something:
  `memanto remember "Batch size > 100 fails with TimeoutError" --type error --confidence 0.95 --provenance observed --source <your_agent_name>`

### Command Reference

```bash
# Store — ALWAYS pass full metadata
memanto remember "content" --type <type> --confidence <0.0-1.0> --provenance <provenance> --source <agent_name>

# Recall raw context
memanto recall "query"                              # semantic search
memanto recall "query" --type <type> --limit 10     # filtered search
memanto recall --recent --limit 10                  # newest first, no query
memanto recall --as-of "2026-01-15"                 # state at a point in time
memanto recall --changed-since "last 7 days"        # what changed since

# Synthesized answer (grounded RAG over memories)
memanto answer "question"

# Re-sync MEMORY.md (project-local cache)
memanto memory sync --project-dir .
```

**Memory types** (use the closest fit, do not invent new ones):
`fact`, `preference`, `instruction`, `decision`, `event`, `goal`, `commitment`,
`observation`, `learning`, `relationship`, `context`, `artifact`, `error`.

**Provenance values**: `explicit_statement`, `inferred`, `observed`, `corrected`,
`validated`, `imported`.

**Confidence**: `1.0` for explicit user statements; `0.9-0.95` for strong consensus;
`0.8-0.85` for observed patterns (3+ times); `0.6-0.75` for emerging patterns.

> **Note**: The `memanto-memory` skill in `.agents/skills/memanto/` contains detailed reference guidelines (best practices, confidence levels, tagging).
<!-- /MEMANTO-MANAGED-SECTION -->
<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:

- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Project entry points

Use durable docs as the source of truth. Before changing behavior, architecture, storage, OAuth scopes, permissions, AI behavior, publication/privacy semantics, or user-visible terminology, read the relevant docs first:

1. `docs/design.md` — canonical MVP design and architecture.
2. `docs/publication.md` — Chrome Web Store and OAuth publication plan.
3. `docs/privacy-policy.md` — privacy constraints and policy draft.
4. `docs/handoff.md` — historical handoff only.

If `docs/handoff.md` conflicts with newer durable docs, trust `docs/design.md`, `docs/publication.md`, and `docs/privacy-policy.md`.

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

## ASEM delegated development workflow

Use asem Sessions for non-trivial implementation work in this project. The parent Session keeps final judgment; child Sessions implement or review and report back. In this repository, the local `.asem.yaml` maps claude-code to the `claude` Agent Template, so use `--agent claude` for claude-code children.

### Default loop

1. Parent Session reads the relevant durable docs (`docs/design.md`, `docs/publication.md`, `docs/privacy-policy.md`) and prepares a bounded prompt with acceptance criteria.
2. Launch a claude-code implementation child with the `worker` profile:

   ```sh
   asem session create <slice>-worker --agent claude --profile worker --json --prompt '<bounded implementation prompt>'
   ```

3. Wait for the worker Report:

   ```sh
   asem message wait --to "$AS_SESSION_ID" --from <worker-session-id> --kind report
   ```

4. Launch a separate claude-code review child with the `reviewer` profile:

   ```sh
   asem session create <slice>-reviewer --agent claude --profile reviewer --json --prompt '<review prompt with changed files, acceptance criteria, and docs to check>'
   ```

5. Wait for the reviewer Report:

   ```sh
   asem message wait --to "$AS_SESSION_ID" --from <reviewer-session-id> --kind report
   ```

6. If the reviewer reports blockers, send the blocker summary back to the worker Session:

   ```sh
   asem message send <worker-session-id> --body '<specific repair request>'
   ```

   Then wait for another worker Report and run review again.
7. Continue only after review approval and parent validation. Parent runs final checks and decides what to merge or document.
8. Close child Sessions after their Reports are no longer needed; do not delete them unless explicitly cleaning history.

### Report expectations

Worker Reports should include:

- changed files;
- implementation summary;
- tests/checks run and their results;
- known risks or skipped checks;
- follow-up questions if blocked.

Reviewer Reports should include one of:

- `APPROVE` with evidence; or
- `BLOCK` with concrete required fixes.

Do not treat this as product task orchestration. It is the development workflow for using asem Sessions, Messages, and Reports while building this extension.
