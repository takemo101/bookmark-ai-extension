---
name: mikan
description: Use mikan as a local-first Markdown Issue board. Trigger when the user wants to inspect, create, update, move, annotate, or mirror mikan Issues; manage workspace Repository Issues; or decide what to work on next. Use MCP-first with CLI fallback.
---

# mikan

Use mikan as this project's local-first Markdown Issue board. Issues live in
`.mikan/`; MCP, CLI, TUI, and watch operate on the same files.

## Default workflow

1. Read the board or target Issue first.
2. Check warnings and unmet_dependencies before choosing or changing work.
3. Move substantial work to the board's active work column when starting.
4. Append Reports for findings, validation, blockers, and review results.
5. Move to the done column only after acceptance criteria and validation pass.

Use the board's configured Status columns; defaults are `active` for started
work and `completed` for done work.

## Tools

Prefer MCP tools:

- Read: `get_board`, `list_issues`, `get_issue`
- Change: `create_issue`, `update_issue`, `move_issue`, `append_issue`
- Publish: `mirror_issue_to_github`

Use CLI only when MCP is unavailable:

```sh
mikan list
mikan show MIK-123
mikan add "Title" --repository backend --affects frontend
mikan update MIK-123 --label automation --depends-on MIK-122
mikan move MIK-123 active --log "Starting implementation"
mikan append MIK-123 --section Reports --source agent --body "Validation passed"
mikan github mirror MIK-123
```

Do not edit `.mikan/**/*.md` directly unless the user explicitly asks or both
MCP and CLI are unavailable. If a command fails, report the error exactly.

## Workspace mode

If config has top-level `repositories`, every Issue needs a primary `repository`.
Use `affects` only for additional Repositories touched by the Issue; never
repeat the primary `repository` in `affects`.

Examples:

- MCP: `create_issue({ title, repository: "backend", affects: ["frontend"] })`
- CLI: `mikan add "Title" --repository backend --affects frontend`

Mirror target rules:

- New Mirrors use `Issue.repository -> repositories[].github.repo`.
- Labels and `affects` never choose the Mirror target.
- Existing Mirrors keep the stored `github_issue.repo`.
- top-level `github.repo` is not a workspace fallback.
- `github.auto_push_mirrors` only controls `mikan watch` auto-push for Issues
  that already have `github_issue` frontmatter.

Without top-level `repositories`, mikan is in single-project mode: Issues do
not need `repository`/`affects`, and new Mirrors use top-level `github.repo`.

## Boundaries

Dependencies are advisory, not a scheduler or transition lock. GitHub Mirror is one-way publication; Markdown remains the source of truth. Use Issue, not Task or ticket. Avoid profile, role, team, scheduler, and workflow-engine framing.
