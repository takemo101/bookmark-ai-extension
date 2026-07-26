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
 * `fallbackLanguage` (MIK-029; the name is historical) is the caller's current
 * UI/browser language. When present it *is* the analysis output language
 * (MIK-033); the analyzer infers a language from the page text only when it is
 * omitted, defaulting to Japanese.
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

/** The Prompt API produced the stored analysis (the normal rich path). */
export const PROMPT_ANALYSIS_MODEL = "chrome-prompt-api";
/** The Summarizer API produced a concise fallback (docs/summarizer-fallback.md). */
export const SUMMARIZER_ANALYSIS_MODEL = "chrome-summarizer-api";

/**
 * Which on-device Chrome API produced a `ready` result. Deliberately plain
 * string literals: the bookmark domain's `AiModel` is structurally identical,
 * so the AI module stays free of a `bookmarks/*` import.
 */
export type AnalysisModel =
	| typeof PROMPT_ANALYSIS_MODEL
	| typeof SUMMARIZER_ANALYSIS_MODEL;

/**
 * A Summarizer API concise fallback — usable generated content, but *not* a
 * full analysis: no genre, tags, or analysis profile (docs/summarizer-fallback.md
 * "Persisted result"). `description` is a deterministic one-line plain-text
 * join of the generated key points for compact list/receipt display.
 */
export type ConciseSummary = {
	readonly description: string;
	readonly analysisMarkdown: string;
};

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
 *   - `ready` / `chrome-prompt-api`      → apply the analysis, status `ready`.
 *                      `profileId` identifies the analysis profile selected for
 *                      the page (see ./profile.ts), independent of the AI JSON.
 *   - `ready` / `chrome-summarizer-api`  → apply the concise Summarizer fallback,
 *                      status `ready` (docs/summarizer-fallback.md). There is no
 *                      profile, genre, or tag set: the fallback never pretends to
 *                      be profile-driven structured analysis.
 *   - `unavailable`  → keep the bookmark, status `unavailable` (re-analyze later).
 *   - `failed`       → keep the bookmark, status `failed`, record the reason.
 */
export type AnalysisOutcome =
	| {
			readonly status: "ready";
			readonly model: typeof PROMPT_ANALYSIS_MODEL;
			readonly analysis: PageAnalysis;
			readonly profileId: string;
	  }
	| {
			readonly status: "ready";
			readonly model: typeof SUMMARIZER_ANALYSIS_MODEL;
			readonly summary: ConciseSummary;
	  }
	| { readonly status: "unavailable"; readonly reason: string }
	| { readonly status: "failed"; readonly error: AnalysisFailure };
