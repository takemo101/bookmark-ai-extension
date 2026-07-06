/**
 * `ai/*` boundary.
 *
 * Owns Chrome Built-in AI / Prompt API availability checks, the
 * English/Japanese analysis prompt (MIK-029), response parsing, and analyzer
 * orchestration. It returns
 * parsed analysis results or typed errors and must not persist data directly.
 * It depends on pure types and ports only: no Drive, storage, or UI imports,
 * and no external AI API / API-key fallback in the MVP. Ask AI recommendation
 * helpers may reference bookmark candidate types with type-only imports. See
 * docs/design.md "AI Design" and docs/implementation-principles.md.
 *
 * Surface:
 *   - {@link analyzePage}             — orchestration (port → prompt → parse),
 *                                        optionally merging Drive-synced custom
 *                                        profiles with the built-ins (MIK-018).
 *   - {@link parseAnalysis}           — pure boundary parser (no Chrome needed).
 *   - {@link buildAnalysisPrompt}     — English/Japanese structured-JSON prompt.
 *   - {@link selectAnalysisProfile}   — built-in analysis profile selection.
 *   - {@link toAnalysisProfile}       — converts a settings-domain `CustomSkill`
 *                                        into an `AnalysisProfile`.
 *   - {@link createChromePromptClient} — browser Prompt API adapter.
 *   - {@link buildAskAiRecommendationPrompt} / {@link parseAskAiRecommendation}
 *                                     — pure Ask AI recommendation prompt
 *                                        builder and output parser (MIK-044).
 *   - {@link buildAskAiKeywordExtractionPrompt} /
 *     {@link parseAskAiKeywordExtraction}
 *                                     — pure Ask AI keyword-extraction prompt
 *                                        builder (question + language only) and
 *                                        capped/deduped output parser (MIK-047).
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

export type {
	AskAiPromptRequest,
	AskAiPromptSessionFactory,
	AskAiPromptSessionHandle,
	AskAiRecommendationRunner,
	PromptApiAvailability,
	PromptClient,
} from "./prompt-api";
export {
	PromptApiUnavailableError,
	createChromeAskAiPromptSessionFactory,
	createChromeAskAiRecommendationRunner,
	createChromePromptClient,
} from "./prompt-api";

export {
	ANALYSIS_SYSTEM_PROMPT,
	ANALYSIS_MARKDOWN_MIN_CHARS,
	ANALYSIS_MARKDOWN_MAX_CHARS,
	ANALYSIS_MARKDOWN_CHAR_RANGE,
	analysisSystemPrompt,
	buildAnalysisPrompt,
} from "./prompt";

export { parseAnalysis } from "./parse";

export type {
	AskAiPromptCandidate,
	AskAiRecommendation,
	AskAiRecommendationOutput,
	AskAiRecommendationParseError,
	AskAiRecommendationParseErrorKind,
	AskAiRecommendationPrompt,
	AskAiRecommendationPromptInput,
} from "./ask-ai-recommendation";
export {
	MAX_ASK_AI_CANDIDATE_DESCRIPTION_CHARS,
	MAX_ASK_AI_CANDIDATE_TAGS,
	MAX_ASK_AI_CANDIDATE_TITLE_CHARS,
	MAX_ASK_AI_MESSAGE_CHARS,
	MAX_ASK_AI_PROMPT_CANDIDATES,
	MAX_ASK_AI_REASON_CHARS,
	MAX_ASK_AI_RETRY_PROMPT_CANDIDATES,
	MAX_ASK_AI_RECOMMENDATIONS,
	buildAskAiRecommendationPrompt,
	parseAskAiRecommendation,
} from "./ask-ai-recommendation";

export type {
	AskAiKeywordExtractionOutput,
	AskAiKeywordExtractionParseError,
	AskAiKeywordExtractionParseErrorKind,
	AskAiKeywordExtractionPrompt,
	AskAiKeywordExtractionPromptInput,
} from "./ask-ai-keywords";
export {
	MAX_ASK_AI_INTENT_CHARS,
	MAX_ASK_AI_KEYWORD_CHARS,
	MAX_ASK_AI_KEYWORDS,
	buildAskAiKeywordExtractionPrompt,
	parseAskAiKeywordExtraction,
} from "./ask-ai-keywords";

export type {
	AnalysisProfile,
	AnalysisProfileDisplay,
	AnalysisProfileDisplayKind,
	CustomProfileName,
} from "./profile";
export {
	BUILT_IN_PROFILES,
	resolveAnalysisProfileDisplay,
	selectAnalysisProfile,
} from "./profile";

export { toAnalysisProfile } from "./custom-profile";

export { analyzePage } from "./analyze-page";
