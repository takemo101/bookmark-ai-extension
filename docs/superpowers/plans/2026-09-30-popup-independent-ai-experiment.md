# Popup-independent AI Experiment Implementation Plan

> **Archived, completed experiment plan.** The standalone `experiments/`
> harness was removed at the user's request after worker integration. Paths and
> commands below are historical evidence, not current execution instructions.
> Production integration follows `2026-09-30-background-bookmark-save.md`.

**Goal:** Determine whether already-installed Chrome built-in AI can generate results after the initiating extension popup closes.

**Architecture:** A separate unpacked MV3 extension, outside the production build, compares a service worker with a `TESTING` offscreen document. Its popup starts a delayed synthetic probe; the worker stores metadata-only results in the experiment extension's own storage, independently of the initiating response channel.

**Tech Stack:** Native Chrome APIs, JavaScript ES modules, Node's built-in test runner. No new dependency or production manifest change.

## Global constraints

- No page extraction, real bookmark data, Drive access, OAuth, external AI, or host permissions.
- Only synthetic hardcoded input; never store input, model text, or browser error messages.
- Do not auto-download a model. Foreground preparation is a separate explicit button and requires a trusted user click.
- `offscreen` permission and `TESTING` reason belong only to this experiment. Chromium also requires `--offscreen-document-testing` for this reason (discovered after the first manual run). Only the human may elect to restart Chrome with this testing switch. Success does not establish a legitimate production offscreen reason.
- Do not attach DevTools to the executing worker/offscreen document: that changes lifetime evidence.
- A passing fake test is not evidence of real Chrome support. Browser/session restart, retries, durable jobs, and Drive writes are outside the experiment.

## One bounded implementation slice

Files in `experiments/popup-independent-ai/`:

- `probe.mjs`, `probe.test.mjs`: injectable API probe and native tests; accepts `kind`, `language`, and a browser namespace; returns availability, stage, result status, elapsed time, and character count only. Missing APIs, unavailable/downloadable models, exceptions, blank output, aborts, and session disposal have explicit outcomes.
- `manifest.json`: standalone experiment with only `offscreen` and `storage` permissions.
- `popup.html`, `popup.mjs`: explicit foreground model preparation, language selection, start buttons for both contexts, and a metadata report viewer.
- `worker.mjs`: dispatch/acknowledgement, per-experiment result storage, single-run guard, and offscreen lifecycle.
- `offscreen.html`, `offscreen.mjs`: message-triggered delayed probe, reports completion through runtime messaging.
- `trial.mjs`: shared delayed trial; verifies the initiating UI is closed before inference and records whether it is open again at completion.

- [x] Write native tests before probe implementation; run `node --test experiments/popup-independent-ai/probe.test.mjs` and observe the missing-module failure.
- [x] Implement the smallest metadata-only probe and trial logic, then rerun the tests.
- [x] Wire the separate extension; verify its manifest has no product/OAuth/host permissions and no externally-connectable entry.
- [x] Run `bunx biome format --write experiments/popup-independent-ai`, native tests, `just validate`, and `git diff --check`.
- [x] Record exact manual Chrome steps and results in `docs/popup-independent-ai-experiment.md`. Leave unexercised browser checks NOT EXECUTED.
- [x] Human loaded v0.0.1 and reported foreground success for both APIs; Offscreen dispatch failed and the worker result was still waiting. These do not establish background support.
- [x] Add v0.0.2 diagnostics: classify the testing-switch requirement and dispatch stage; persist finite API checkpoints and partial results without raw content. Regression tests fail before the fix, then pass.
- [x] Human reran v0.0.2 and supplied the worker report: Chrome 153.0.0.0, Japanese Prompt/Summarizer both pass, UI absent at start/end, final report stored. Offscreen confirms `testing-switch-required` before any AI call. Debugger state is not independently recorded. The bounded feasibility investigation is complete; prefer the worker candidate and defer further Offscreen testing. Production adoption remains a separate integration/validation decision.

Finite diagnostic storage/runtime calls reset MV3 idle timing. Results from the instrumented v0.0.2 trial must not be presented as evidence of an uninstrumented worker lifetime.

## Acceptance / next decision

A trial must report nonblank generation, UI absent at execution start/end, and independent result delivery after reopening the popup. The user-provided v0.0.2 worker report meets these bounded observations (Prompt 5,676 ms / 225 characters; Summarizer 17,633 ms / 645 characters). These observations establish only the tested Chrome/profile/API/language combination and boundary observations, not uninterrupted browser lifetime or production readiness. A single inference exceeding 30 seconds and actual Drive persistence remain untested. The production design must additionally establish supported execution context, proper offscreen justification if used, initial model preparation, permission implications, real tab extraction, and safe final Drive synchronization.

## Environment finding

`surf tab.list` connected to the user's Chrome. A script targeting the agent-created `chrome://extensions/` tab was rejected with `Cannot control this page. Chrome restricts automation on chrome://, extensions, and web store pages.` No attempt is made to bypass that restriction; real extension loading and popup trials require human interaction.
