# Popup-independent built-in AI experiment

Date: 2026-09-30

> Archived experiment record. The user requested removal of the standalone
> `experiments/` harness after worker integration. The files and commands below
> describe the historical trial and are no longer present/runnable. For current
> extension testing, use the manual checklist in
> [`background bookmark save`](superpowers/plans/2026-09-30-background-bookmark-save.md).

## Scope and current decision

The user requested analysis that continues after closing the popup. This
reopens the feasibility question previously set aside in MIK-020/MIK-021;
those records are a product decision, not proof that every background context
is unsupported.

The former `experiments/popup-independent-ai/` was a **separate, manually loaded
extension**. It was not imported into `src/`, included in `dist/`, or used by the
production Save action. The experiment itself did not change production behavior
or permissions; subsequent worker integration is described in `ai-analysis-v2.md`.

**2026-09-30 result:** the user-provided v0.0.2 report confirms that both
already-available Japanese APIs generated nonblank output in the service worker
and delivered a stored result, with the initiating UI absent at the observed
start/end boundaries, on Chrome 153.0.0.0. Prefer the service worker as the next
production-design candidate; no Offscreen permission or testing switch is
needed for that candidate. This is bounded feasibility evidence, not approval
or verification of production background saving (see Production gate).

The experiment tests:

1. Foreground controls for Prompt API and Summarizer, separately for `ja`/`en`.
2. Generation in a service worker after the popup closes, without a heartbeat.
   Version 0.0.2 adds finite diagnostic writes; these reset the idle clock and
   therefore must not be described as an uninstrumented lifecycle test.
3. Generation in an offscreen document after the popup closes.
4. Result delivery through the experiment worker to its own local storage,
   readable after reopening the popup.

Only a hardcoded fictional library paragraph is used. There are no host,
activeTab, scripting, identity, Drive, or real bookmark permissions. Stored
reports contain API availability, safe allowlisted error names, execution
stage, timestamps, elapsed times, UI-open booleans, and output character counts;
never prompts, raw model output, page text, URLs, or arbitrary error strings.
No Google authentication is needed.

## Why not claim offscreen support yet?

- [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api)
  describes document/permissions-policy constraints and currently says the web
  API is unavailable in Web Workers. Extension exposure must be tested rather
  than inferred from web-only documentation.
- The current Chromium [LanguageModel IDL](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/ai/language_model.idl)
  has separately gated `Window AIPromptAPI` / `Worker AIPromptAPIForWorkers`
  exposure. Moving upstream source is not evidence of the user's Chrome build.
- [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
  permits hidden documents, with only `chrome.runtime` among extension APIs.
  It requires a declared reason and justification. This experimental extension
  uses `TESTING`, which is appropriate **only for testing**, not permission to
  ship AI background work under that reason. Do not substitute unrelated
  `AUDIO_PLAYBACK`, `WORKERS`, or `DOM_SCRAPING` reasons to keep a process alive.
  **Correction after the first manual run:** Chromium's
  [offscreen implementation](https://github.com/chromium/chromium/blob/main/extensions/browser/api/offscreen/offscreen_api.cc)
  rejects `TESTING` without the `--offscreen-document-testing` command-line
  switch. The original setup instructions missed this prerequisite. The API's
  enum listing alone is insufficient evidence that it works in normal Chrome.
- [Built-in AI setup](https://developer.chrome.com/docs/ai/get-started) documents
  user activation for downloading/preparing models. A worker message is not a
  user gesture in an offscreen document. Hidden trials only call `create` when
  availability is already `available`; model preparation is a separate trusted
  foreground click with an explicit download warning.

Sources inspected on 2026-09-30. Real Chrome/version-specific evidence remains
required for both APIs and the target output language.

## Historical Chrome procedure (harness removed)

1. Keep the normal Bookmark AI extension installed and unchanged. In
   `chrome://extensions`, enable Developer mode if needed, choose **Load
   unpacked**, and select this repository's `experiments/popup-independent-ai`
   directory (not `dist/` or the repository root).
2. Pin **Bookmark AI — Popup lifecycle experiment** so its badge is visible.
   Close any DevTools inspecting the experiment's popup, service worker, or
   offscreen document. Debugger attachment changes lifecycle behavior.
   When updating an existing install, click its Reload button and confirm the
   popup says **v0.0.2**. Existing results are retained; only new trials have
   `trial.harnessVersion: 2` and incremental diagnostics.
3. Open the experiment popup. Leave language at Japanese, matching normal
   Japanese use. Click **Promptを準備・対照実行（DLあり）**. This explicitly allows
   Chrome's local model download if necessary; it can be large. Keep the popup
   open until `controls.prompt.status` is `pass`.
4. Run **Summarizerを準備・対照実行（DLあり）** the same way. `missing`, `skipped`,
   or failed foreground controls are evidence to record, not permission to
   assume the hidden path will work. These preparation buttons belong only to
   this experiment; production Summarizer fallback still never downloads.
5. Click **Service Workerで開始**, wait for the accepted message, and immediately
   close the popup by clicking the ordinary browser page. Within 10 seconds the
   trial checks that no `popup.html` document remains open. If it remains open,
   the trial reports `ui-still-open` and makes no AI calls.
6. Do not reopen the popup until its badge changes from `WAIT` to `END`. Do not
   attach DevTools. API calls have a 120-second deadline each, run sequentially.
   If no `END` appears within five minutes, reopen and record the waiting state
   as **incomplete**, not as an API pass or a proven worker termination.
7. Copy the metadata JSON shown in the popup. Then repeat steps 5–6 with
   **Offscreenで開始**, but only after starting Chrome with the testing switch
   described below. Without it, `create-document` / `testing-switch-required`
   is an expected setup failure, not an AI failure.
   Reports for the two contexts are stored separately;
   another run of the same context replaces only that context's report.
8. Optional: repeat in English, saving the Japanese report before overwriting
   it. Also record the Chrome version/channel and whether the browser was
   foreground, another tab selected, or minimized. Successful foreground Chrome
   execution does not prove minimized-browser behavior.
9. Remove the experimental extension when finished. Its local diagnostic
   storage is separate from the real extension and its Google Drive data.

The experiment does not read or need a target page/tab. It tests the execution
context only. Real-page extraction, tab navigation/discard/closure, initial model
setup UX, structured output, and final Drive sync require separate integration
validation before changing the product.

### Offscreen-only prerequisite on macOS

Service Worker trials need no extra Chrome switch. Do these steps only if the
user elects to continue the Offscreen test; the agent must not close their
browser or restart it automatically.

1. Save in-progress work and fully quit Google Chrome yourself (closing one
   window is not enough). This interrupts browser activity.
2. Start Chrome from Terminal with its dedicated testing switch:

   ```sh
   open -a "Google Chrome" --args --offscreen-document-testing
   ```

3. Check `chrome://version` locally to confirm the **Command Line** includes
   that switch. Do not share the full command line or profile path. Do not
   disable any security/sandbox feature or add unrelated flags.
4. Run only the experiment extension as above, with its DevTools closed. This
   establishes behavior under a testing configuration, not production support.
5. When finished, fully quit Chrome and reopen it normally to remove the flag.

### Instrumented diagnostic checkpoints (v0.0.2)

`trial.progress` records `delay`, `checking-ui`, API `availability` / `create` /
`generate`, and completed API results, plus timestamps. This preserves Prompt
results if a subsequent Summarizer call never finishes. No timer periodically
writes state; writes occur only at these finite transitions. Nonetheless,
storage/runtime calls can reset MV3's idle clock, so any new success describes
this instrumented execution, not the lifetime of the original trial. A last
`generate` checkpoint alone cannot distinguish a stalled API from a terminated
worker. `progressFailed` means a probe could not record a checkpoint.

## Reading results

- `status: complete` means the trial finished, **not that AI succeeded**. Each
  API has its own `results[].status` and `stage`.
- `pass` requires nonblank output; the text itself is immediately discarded.
- `missing`: API is absent in that context.
- `skipped`: availability is not already `available`; no create/download ran.
- `error` / `timeout` / `blank`: generation was not successful.
- `uiOpenBefore: false` and `uiOpenAfter: false` record the two observed
  boundaries. They do not prove that the UI was never reopened in between;
  follow the no-reopen protocol for a valid lifetime observation.
- `dispatch-error` / `harness-error` / an unchanged `waiting` record require
  investigation. They are not automatically evidence that Chrome AI is
  unsupported. A worker can die or a message/storage operation can fail.
- An `ERR` badge indicates failure while storing/cleaning up a worker result;
  reopen the popup and share the last checkpoint, rather than waiting for END.
- `cleanupFailed` is a probe disposal failure, not a clean success.

The offscreen document closes after results are stored. A new run is rejected
while a run is pending for less than five minutes. After that deadline, an
explicit new run may replace it and close a leftover offscreen document. Save
an incomplete report before rerunning. There is no retry queue or heartbeat.

## Historical automated validation (harness removed)

```sh
node --test experiments/popup-independent-ai/*.test.mjs
just validate
git diff --check
```

Native tests use fake namespaces/Chrome APIs; they do not download models or
prove real Chrome behavior. The manifest test checks permission isolation.
The production Vitest suite remains separate from the experiment's native tests.

## Run record

| Check | Result | Evidence |
| --- | --- | --- |
| Native harness tests | PASS | 17 tests; red runs observed for new stage diagnostics and testing-switch classification before fixes. |
| Production validation | PASS | `just validate`: formatting, typecheck, 57 test files / 912 tests, build; existing CRX rollupOptions/rolldownOptions warning only. |
| Static checks | PASS | LSP diagnostics on five experiment runtime modules: zero findings; `git diff --check` passed. |
| Foreground Prompt control | PASS (user report) | `ja`, available, generate/pass, 9,469 ms, 207 output characters. |
| Foreground Summarizer control | PASS (user report) | `ja`, available, generate/pass, 12,149 ms, 428 output characters. |
| Popup closed → worker generation | INCONCLUSIVE (v0.0.1 user report) | `trial.status: waiting`; no worker result. Time since start and reason for incompletion are not established by the snapshot. |
| Popup closed → offscreen generation | NOT REACHED (v0.0.1 user report) | `reports.offscreen.status: dispatch-error`; generic handler discarded the precise cause. Consistent with the confirmed Chromium testing-switch gate, but the original JSON does not prove the exact error. |
| Popup closed → worker Prompt (v0.0.2) | PASS (user report) | Chrome 153.0.0.0, `ja`, available, generate/pass, 5,676 ms, 225 output characters; UI absent at both boundaries. |
| Popup closed → worker Summarizer (v0.0.2) | PASS (user report) | Same run, available, generate/pass, 17,633 ms, 645 output characters. |
| Report saved after popup closure (v0.0.2) | PASS (user report) | `reports.service-worker.status: complete` and `trial.status: finished`; results retrieved by the user. |
| Offscreen creation (v0.0.2) | BLOCKED BY TEST SETUP | `dispatch-error`, `stage: create-document`, `code: testing-switch-required`. No AI call took place; no Offscreen generation capability conclusion. |
| Final bookmark/Drive update | OUT OF SCOPE | No production integration or Drive access in this experiment. |

The user supplied both versions' reports on 2026-09-30. The v0.0.2 worker
report has `startedAt: 2026-09-30T14:21:01.236Z` and
`completedAt: 2026-09-30T14:21:24.549Z` (23.313 seconds across both API probes),
`harnessVersion: 2`, and `uiOpenBefore: false` / `uiOpenAfter: false`.
Its user agent reports Chrome 153.0.0.0; the browser channel, exact macOS version,
and whether DevTools were closed are not independently established by that
string or report. In particular, do not infer the real OS version from the
reduced `Mac OS X 10_15_7` user-agent token.

The original uninstrumented v0.0.1 waiting state remains unexplained. The
successful run used finite progress writes that reset idle timing, and neither
individual AI call lasted 30 seconds. It does not prove uninterrupted long
inference, survival through worker termination, minimized-browser operation,
or support on older Chrome versions. The two UI observations are not a trace
of all UI activity between them.

Offscreen retesting with a Chrome restart is not needed for the current
service-worker-first investigation. Keep its result as a confirmed setup block,
not an API failure or success.

Automation preflight: `surf tab.list` successfully connected to the user's
Chrome. An operation on the agent-created `chrome://extensions/` page was
rejected: `Cannot control this page. Chrome restricts automation on chrome://,
extensions, and web store pages.` No capability result is inferred from this
automation restriction; manual loading and clicks are required.

## Production gate

The bounded synthetic feasibility experiment is complete with a viable
service-worker candidate and a documented Offscreen setup block. The subsequent
worker integration is tracked in
[`2026-09-30-background-bookmark-save.md`](superpowers/plans/2026-09-30-background-bookmark-save.md)
and `ai-analysis-v2.md`. Its acceptance criteria are:

1. Freeze the target tab identity and extract in the worker only after explicit
   Save; never re-query a different active tab later or persist raw excerpts.
2. Persist a pending bookmark and acknowledge accepted work independently of
   popup lifetime; finish through the existing analysis/fallback and Drive
   boundaries, not new UI-owned persistence code.
3. Validate long real inference (including a single call beyond 30 seconds),
   worker interruption/restart, and recoverable pending-state behavior without
   assuming an in-memory queue can survive termination. Do not silently add an
   artificial heartbeat based on this short instrumented run.
4. Keep initial model preparation user-initiated and foreground; probe the
   actual worker at runtime rather than treating Chrome 153 as a proven minimum
   supported version. Summarizer's production no-download contract still holds.
5. Test duplicate starts, bookmark deletion during analysis, final Drive failure,
   and popup reopening/progress display before promising background completion.

The integration now changes the normal extension on this working branch, but
must not be advertised as fully validated before the manual gates pass.
Acknowledgment explicitly means accepted, not yet durably saved; the pending
bookmark is persisted before extraction/analysis. The implementation uses a
bounded, operation-only keepalive per Chrome's official migration guidance,
not an idle heartbeat. Real long inference and Drive completion after closure
remain manual acceptance checks, separate from this synthetic experiment.
Failure recovery must preserve a pending bookmark without pretending that
Chrome/browser restart can resume an in-memory excerpt. If no supported hidden
context is viable, evaluate a dedicated visible extension page/side panel as a
different UX, not as equivalent to fully background analysis.
