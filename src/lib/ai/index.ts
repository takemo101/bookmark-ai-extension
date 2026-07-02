/**
 * `ai/*` boundary.
 *
 * Owns Chrome Built-in AI / Prompt API availability checks, the Japanese
 * analysis prompt, response parsing, and analyzer orchestration. It returns
 * parsed analysis results or typed errors and must not persist data directly.
 * It depends only on its own pure types and the {@link PromptClient} port — no
 * Drive, storage, UI, or bookmark-domain imports. No external AI API / API-key
 * fallback in the MVP. See docs/design.md "AI Design" and
 * docs/implementation-principles.md.
 *
 * Surface:
 *   - {@link analyzePage}             — orchestration (port → prompt → parse).
 *   - {@link parseAnalysis}           — pure boundary parser (no Chrome needed).
 *   - {@link buildAnalysisPrompt}     — Japanese structured-JSON prompt.
 *   - {@link selectAnalysisProfile}   — built-in analysis profile selection.
 *   - {@link createChromePromptClient} — browser Prompt API adapter.
 */
export type { Result, Ok, Err } from "./result";
export { ok, err } from "./result";

export type {
	AnalysisInput,
	PageAnalysis,
	AnalysisParseErrorKind,
	AnalysisParseError,
	AnalysisClientError,
	AnalysisFailure,
	AnalysisStatus,
	AnalysisOutcome,
} from "./types";
export { MAX_TAGS } from "./types";

export type { PromptApiAvailability, PromptClient } from "./prompt-api";
export {
	PromptApiUnavailableError,
	createChromePromptClient,
} from "./prompt-api";

export {
	ANALYSIS_SYSTEM_PROMPT,
	ANALYSIS_MARKDOWN_MIN_CHARS,
	ANALYSIS_MARKDOWN_MAX_CHARS,
	buildAnalysisPrompt,
} from "./prompt";

export { parseAnalysis } from "./parse";

export type { AnalysisProfile } from "./profile";
export { BUILT_IN_PROFILES, selectAnalysisProfile } from "./profile";

export { analyzePage } from "./analyze-page";
