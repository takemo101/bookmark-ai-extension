# Prompt API Service Worker Experiment (MIK-020)

Date: 2026-07-03

## Purpose

This experiment checks whether Chrome Built-in AI / Prompt API works from an
MV3 extension **service worker** (see [`ai-analysis-v2.md`](./ai-analysis-v2.md)
"Service worker experiment (concluded)" under "Foreground analysis behavior").
Per MIK-021 the MVP uses UI-open foreground analysis and this direction is not
being pursued now; see "Recommendation" at the end of this document.

It checks four points:

- service worker availability probe;
- service worker session creation;
- service worker prompt execution;
- service worker lifecycle behavior during/after a slower prompt.

This is **experiment-only**. It is not production background queue processing,
it does not change how bookmarks are saved or analyzed, and it is inert unless
explicitly triggered from the extension's own service worker DevTools console.
No production UX depends on it.

## Prerequisites

1. A built and loaded unpacked extension. Follow
   [`local-unpacked-setup.md`](./local-unpacked-setup.md) through **Step 9:
   Reload the unpacked extension** at minimum.
2. A Chrome channel/configuration where Chrome Built-in AI / Prompt API is
   available (see `local-unpacked-setup.md` Prerequisites item 6).

## Steps to run

1. Build and load the unpacked extension (see Prerequisites above).
2. Open `chrome://extensions`, find the Bookmark AI Extension card, and click
   **service worker** (sometimes shown as **Inspect views: service worker**) to
   open its dedicated DevTools console.
3. In that console, run:

   ```js
   chrome.runtime.sendMessage(
     { action: "bookmark-ai:prompt-api-service-worker-experiment" },
     (response) => console.log(JSON.stringify(response, null, 2)),
   );
   ```

4. Copy only the JSON response into the run record below. The response is
   already safe/redacted: it contains no page content and no raw model output
   text, only status/detail/error strings, a timestamp, and the user agent.
5. For the **slowPromptLifecycle** point specifically: also watch the
   extension's card on `chrome://extensions` during the call for the service
   worker **Inactive**/active indicator, and note in the run record whether the
   worker appeared to go idle mid-call or only after the response returned.
   This visual observation cannot be encoded in the JSON report and must be
   recorded by the human running the test.
6. Optional deeper lifecycle check: wait 30+ seconds after the service worker
   goes idle (shown inactive in `chrome://extensions`), then re-run the same
   command. Note whether a fresh invocation still works after the worker was
   presumably terminated and restarted. This indicates whether state persists
   across idle/restart, which matters for any future background queue design.

## Report field reference

The JSON response has the shape:

```ts
{
  ok: boolean;
  report?: {
    timestamp: string;       // ISO timestamp
    userAgent: string | null;
    availability: { status: "pass" | "fail" | "partial" | "n/a"; detail?: string; error?: string };
    sessionCreation: { status: "pass" | "fail" | "partial" | "n/a"; detail?: string; error?: string };
    promptExecution: { status: "pass" | "fail" | "partial" | "n/a"; detail?: string; error?: string };
    slowPromptLifecycle: { status: "pass" | "fail" | "partial" | "n/a"; detail?: string; error?: string };
  };
  error?: string; // present only if ok is false
}
```

## Expected console messages / troubleshooting

Chrome may print this informational message when the experiment reaches the
Built-in AI API:

```txt
This page uses Chrome's Built-In AI features (LanguageModel)! We're always improving our models; please submit your feedback here: https://issues.chromium.org/issues/new?component=1583624
```

This is Chrome's own feedback notice and is not by itself a failed experiment
point.

The extension explicitly requests text output languages for both LanguageModel
availability probes and session creation. The production analyzer requests
Japanese (`ja`) output; this service-worker experiment uses English (`en`)
because its synthetic prompts are English. If Chrome still prints
`No output language was specified`, rebuild and reload the unpacked extension
before re-running the experiment.

## Run record

Record each real run here. Do not mark a row `PASS`/`FAIL`/`PARTIAL` unless the
point was actually exercised against real Chrome with a loaded unpacked
extension.

| Date | Experiment point | Result | Notes |
|---|---|---|---|
| 2026-07-03 | Availability probe | NOT EXECUTED | This repository change only adds the harness + docs; no real Chrome run has been performed by an agent in this session. |
| 2026-07-03 | Session creation | NOT EXECUTED | Same as above. |
| 2026-07-03 | Prompt execution | NOT EXECUTED | Same as above. |
| 2026-07-03 | Slow-prompt / lifecycle behavior | NOT EXECUTED | Same as above; also requires manual observation of the `chrome://extensions` service worker status indicator, which cannot be captured by an agent. |

## Recommendation

**Concluded — not pursued (MIK-021).** The experiment was never executed in
real Chrome, and per the MIK-020/MIK-021 decision the MVP explicitly uses
UI-open foreground analysis: save/re-analyze runs extraction and Prompt API
analysis in the initiating popup/options flow while the screen stays open.
Service-worker/background/offscreen Prompt API processing is not being pursued
now; do not create a production background-queue issue. This document is kept
for historical reference in case the question is revisited later.
