# Popup-independent bookmark save — first production slice

## Basis and bounds

The isolated Chrome 153 trial succeeded for already-prepared Prompt and Summarizer APIs with the popup closed. It does not prove long-running production reliability. Implement worker ownership now; keep manual Chrome acceptance explicit.

## Contract

- Capture the clicked tab's ID/URL/title in the popup. Send only that target, never query a later active tab. Worker injects the existing extractor into that exact tab. Re-analysis verifies the selected page before mutation.
- Reuse `BookmarkApp`: pending cache/Drive write, extraction, analysis/fallback, final Drive/cache update. No raw excerpt persistence, new permission, external AI, or durable work queue.
- Worker accepts a job independently of the UI's lifetime. Short status requests expose in-memory progress and the result. Reopening a popup can observe the active save. Restart loses the job/excerpt, not durable bookmarks; re-save explicitly, never replay automatically.
- Route ALL bookmark mutations (including Options sync/delete) through the worker. One operation at a time; reject conflicting requests with a retryable busy error, not an unbounded queue. Reads remain local and immediate.
- Use already-available models only in the worker. Add explicit foreground Prompt model preparation; this is the sole analysis-model download path. Summarizer fallback never downloads.
- Bound analysis to three minutes, abort native sessions and suppress late results. During an explicit operation only, use Chrome's documented exceptional long-operation `getPlatformInfo` call every 25 seconds, stopping at completion and after four minutes even if an underlying API hangs. No idle/startup heartbeat, alarms, or Offscreen document. Worker termination always remains possible.
- Do not release the mutation lock merely because the UI disconnects or a keepalive deadline expires. Preserve serialization until the underlying operation settles or Chrome terminates the worker.

Reference: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive

## Implementation / validation

1. Test command parsing, detached ownership, progress/reconnection, busy duplicate/delete/sync rejection, restart loss, safe exceptions, and bounded keepalive with fakes.
2. Wire the existing app into the worker and replace UI bookmark compositions with a small messaging adapter. Test fixed-tab extraction and pending cache preservation on Drive failure.
3. Add explicit foreground preparation and resume UI behavior with tests; update canonical lifecycle/privacy documentation.
4. Run complete unit/type/format/build checks and inspect the manifest diff. Manual acceptance: no DevTools, popup closed during >30s inference, completion on Drive, reopening progress, worker termination, first download, Drive failure/recovery, and competing mutations. Do not claim these manual cases passed from unit tests alone.

## Implementation evidence

- Progress-badge and user-stop follow-up: `just validate` PASS — formatting, TypeScript, 62 files / 974 tests, and build. Fake tests cover ID-scoped stop, reopen, native signal/destroy hooks, ignored late outcomes/progress, final-write lock retention, Drive-failure recovery, and stopped UI/badges. Configured `dist/` rebuilt; DOM-free startup/idle-stop smoke and unchanged manifest checks pass. This is not real Chrome cancellation/Drive evidence; manual case 7 remains pending.
- Final `just validate` after experiment cleanup: PASS — format check, TypeScript, 60 files / 926 tests, and build. The previous 935-test run included nine tests for the now-removed MIK-020 harness. Existing CRX `rollupOptions`/`rolldownOptions` warning only.
- Before removal, all 17 isolated-experiment native tests passed. At the user's request, the standalone `experiments/` harness and the obsolete `src/background/experiments/` harness/tests/message entry point were removed. Production regression tests remain; experiment records are explicitly archived.
- Built-worker Node smoke: imports without DOM globals, registers message handlers, returns idle status, starts no startup keepalive. This is a packaging check, not Chrome AI evidence.
- Generated manifest: unchanged five permissions, Google APIs host permission and `drive.file`; no Offscreen permission. Local unpacked build uses the existing configured OAuth client ID (not the validation placeholder).
- Active LSP probes produced auxiliary import-style warnings consistent with this Vite repository's extensionless imports and existing nested-ternary warnings; the push-only server cannot confirm a clean recheck. Full `tsc --noEmit` passes.
- Source diff whitespace check: PASS. Real-Chrome acceptance remains pending independently of PR integration.

## Manual acceptance — still pending

Use the normal extension's rebuilt `dist/`, not the isolated experiment folder. Reload it at `chrome://extensions/`; do not restart Chrome or enable Offscreen testing flags.

1. With models already available and DevTools closed, Save & Analyze a page, close only the popup, leave the target page open through extraction, then reopen to observe progress/result. Confirm the generated record reaches Drive, not just local cache. Include one real inference longer than 30 seconds.
2. On an unprepared model, use **Prepare AI model** and keep the popup open. Saving without preparation must still preserve the bookmark without attempting a hidden download. Summarizer fallback must never download.
3. While analysis runs, try another save and an Options deletion/sync: expect a busy error, no second job and no lost updates. Retry the deletion after completion; confirm later sync does not resurrect it.
4. Test interruption separately from no-DevTools lifetime testing: stop the worker/reload the extension after the pending record is durable. Reopen: no automatic replay, pending/last durable bookmark remains, explicit re-save recovers.
5. Simulate Drive failure, confirm the generated result remains locally with pending sync, restore connectivity and explicitly sync.
6. Navigate the captured tab before extraction; confirm no analysis of the replacement page is attached to the original bookmark. Switching active tabs alone must never retarget the job.
7. During Prompt and Summarizer inference, use **Stop analysis**, including after closing/reopening the popup. Confirm native work stops, no fallback/new result appears afterward, the bookmark remains, and final Drive/cache persistence settles before another mutation is accepted. Check the amber `STOP` → blue `SYNC` → amber `STOP` badge, or stopped/local-only `!` on Drive failure. The stop control must not interrupt pending writes, extraction, final sync, or foreground model preparation. Retry AI explicitly from the page.
