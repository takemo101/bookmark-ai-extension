/**
 * AI analysis data shapes.
 *
 * The split mirrors the rest of the codebase: raw Prompt API text is parsed once
 * at the boundary into an always-valid {@link PageAnalysis}, and recoverable
 * problems become typed {@link AnalysisFailure} values rather than exceptions.
 *
 * Nothing here imports Drive, storage, UI, or the bookmark domain. {@link
 * PageAnalysis} is deliberately structurally compatible with the bookmark
 * domain's `AiAnalysis` input (`description` / `genre` / `tags`) so a later
 * use-case can hand the result to `Bookmarks.applyAiAnalysis` without this
 * module depending on `bookmarks/*`. {@link AnalysisStatus} is likewise a subset
 * of the bookmark domain's `AiStatus`.
 */
import type { SupportedLanguage } from "../i18n/index";

/**
 * Input to a single analysis call. `excerpt` is the bounded, transient page
 * excerpt text produced by `extraction/*` (`PageExcerpt.text`). It is an AI
 * input only and is never persisted — see docs/privacy-policy.md "Page Text
 * Excerpts".
 *
 * `fallbackLanguage` (MIK-029) is the caller's UI/browser language: the
 * analyzer infers the output language from the page text itself and uses this
 * only when the text is ambiguous, defaulting to Japanese when omitted.
 */
export type AnalysisInput = {
	readonly title: string;
	readonly url: string;
	readonly excerpt: string;
	readonly fallbackLanguage?: SupportedLanguage;
};

/** Always-valid parsed analysis. Produced only by the parser. */
export type PageAnalysis = {
	readonly description: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	/** Long-form generated Markdown analysis. Generated, never copied excerpt text. */
	readonly analysisMarkdown: string;
};

/** Tags beyond this count are dropped rather than treated as malformed output. */
export const MAX_TAGS = 8;

export type AnalysisParseErrorKind =
	| "empty-output"
	| "no-json"
	| "invalid-json"
	| "not-object"
	| "missing-field"
	| "empty-description"
	| "empty-analysis-markdown"
	| "invalid-field";

/** A recoverable failure to parse raw Prompt API text into a {@link PageAnalysis}. */
export type AnalysisParseError = {
	readonly kind: AnalysisParseErrorKind;
	readonly field?: string;
	readonly message: string;
};

/** A recoverable failure while talking to the Prompt API client. */
export type AnalysisClientError = {
	readonly kind: "client-error";
	readonly message: string;
};

export type AnalysisFailure = AnalysisParseError | AnalysisClientError;

/**
 * The statuses the analyzer can resolve to. A strict subset of the bookmark
 * domain's `AiStatus` (`pending` is owned by the save flow, not the analyzer).
 */
export type AnalysisStatus = "ready" | "unavailable" | "failed";

/**
 * Outcome of {@link analyzePage}. Each variant maps onto a bookmark `aiStatus`:
 *   - `ready`        → apply the analysis, status `ready`. `profileId` identifies
 *                      the built-in analysis profile selected for the page (see
 *                      ./profile.ts), independent of the AI-produced JSON.
 *   - `unavailable`  → keep the bookmark, status `unavailable` (re-analyze later).
 *   - `failed`       → keep the bookmark, status `failed`, record the reason.
 */
export type AnalysisOutcome =
	| {
			readonly status: "ready";
			readonly analysis: PageAnalysis;
			readonly profileId: string;
	  }
	| { readonly status: "unavailable"; readonly reason: string }
	| { readonly status: "failed"; readonly error: AnalysisFailure };
