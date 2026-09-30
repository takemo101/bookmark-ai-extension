# Summarizer API fallback design

## Purpose

Chrome Prompt API remains Bookmark AI's normal analysis path. This design adds
an on-device Summarizer API fallback only when Prompt analysis reaches a
terminal failure, so a saved page can still receive a useful, clearly degraded
summary.

This is a resilience feature, not a speed optimization. It does not replace
Prompt API, preprocess Prompt input, or use an external provider. It runs in
the same worker-owned operation as Prompt; it does not start a separate job
or Offscreen document (see `ai-analysis-v2.md`).

## Trigger and availability

1. Extract the existing bounded page excerpt in the worker for the explicitly selected tab.
2. Run the Prompt API analysis as today.
3. If Prompt returns `unavailable` or any `failed` outcome—including session
   creation, inference, or JSON parsing failure—probe Summarizer. Explicit user
   stop or the worker's analysis deadline ends the attempt instead; it must not
   start a fallback session after cancellation.
4. Run Summarizer only when it is already `available`. Do not create or download
   a Summarizer model after Prompt fails.
5. If Summarizer is unavailable, fails, or returns blank output, keep the
   original Prompt terminal outcome unchanged.

The excerpt remains in memory throughout this sequence and is never written to
Drive, `chrome.storage.local`, logs, or an error message.

## Summary configuration

The fallback uses fixed, generic options:

- `type: "key-points"`
- `length: "short"`
- `format: "markdown"`
- `preference: "auto"`
- the same resolved `ja` or `en` output language as the Prompt request
- fixed bookmark-summary `sharedContext` only

Do not pass a profile name, custom-skill instruction, raw prompt, or an
expectation that Summarizer obeys the structured-analysis contract. The result
requests three key points, but any nonblank Markdown output is accepted because
the API does not provide a schema guarantee.

## Persisted result

A successful fallback is a usable but distinct ready result:

```ts
{
  aiStatus: "ready",
  aiModel: "chrome-summarizer-api",
  description: "One-line plain-text join of the generated key points",
  analysisMarkdown: "Generated Markdown key points",
  genre: undefined,
  tags: [],
  analysisProfileId: undefined,
  aiError: undefined,
}
```

`aiModel` is the only additional distinction needed; do not add an
`analysisMode`, `partial`, or `degraded` status. The existing JSONL parser must
accept the new model marker while retaining compatibility with records whose
model is Prompt or absent.

A successful fallback replaces a prior rich analysis for the same URL, clearing
old genre, tags, profile ID, and error. This prevents stale structured metadata
from appearing current. Re-saving the page later through the existing **Save &
Analyze** action always tries Prompt first and can upgrade the record again. No
dedicated retry control is added.

## User experience

Popup and Options views show normal ready status plus a localized explanation:

- English: **Concise summary — detailed analysis was unavailable**
- Japanese: **簡易要約 — 詳細分析を取得できなかったため**

Do not show the normal profile label, genre, tags, or raw Prompt/browser error
for a fallback record. The original Prompt error remains only as safe,
metadata-only diagnostic logging when fallback does not succeed.

## Privacy and scope

The fallback preserves the current privacy posture:

- Chrome-managed on-device APIs only; no Gemini API, Vertex AI, API key, or
  backend.
- No new permission, OAuth scope, host permission, or offscreen document.
  Reuse the existing Service Worker save operation.
- No raw excerpt, prompt, summary input, raw output, URL, token, or browser
  error text in logs.
- Google Drive remains the source of truth and `chrome.storage.local` remains a
  cache.

## Validation

Implementation must unit-test Prompt success bypassing Summarizer; all terminal
Prompt failures falling back once; already-available-only behavior; language
propagation; normal and irregular nonblank Markdown; blank output; record
round-trips; stale-field clearing; fallback labels; and preservation of the
original Prompt result when fallback cannot succeed.
