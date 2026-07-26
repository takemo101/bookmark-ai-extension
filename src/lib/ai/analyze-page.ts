/**
 * Analyzer orchestration: ask the Prompt API, parse the output, return a typed
 * {@link AnalysisOutcome}.
 *
 * This is the only place that wires the port, the prompt, and the parser
 * together. It contains no persistence and no UI — it returns a value the
 * save/re-analyze use-cases map onto a bookmark `aiStatus`. See
 * docs/design.md "Save Flow".
 *
 * Status mapping:
 *   - API `unavailable`               → `unavailable` (bookmark preserved).
 *   - API `downloadable`/`downloading` → proceed: `client.prompt` triggers the
 *       model download via `create({ monitor })` (user-initiated foreground
 *       flow), reporting transient setup/download detail via `onModelSetup`.
 *   - API present but `prompt` throws
 *       {@link PromptApiUnavailableError} → `unavailable`.
 *   - session creation/download fails
 *       ({@link PromptSessionCreateError}) → `failed` (client error), logged
 *       distinctly with safe fields only.
 *   - any other `prompt` throw        → `failed` (client error).
 *   - malformed output                → `failed` (recoverable parse error).
 *   - valid output                    → `ready` with the parsed analysis.
 *
 * Every terminal outcome above (`unavailable` and every `failed`) then gets one
 * concise Summarizer API attempt when a {@link SummarizerClient} is wired
 * (docs/summarizer-fallback.md). It runs only if Summarizer is *already*
 * available, never downloads a model, and yields a `ready` outcome marked
 * `chrome-summarizer-api`. If it cannot produce usable text, the original Prompt
 * outcome is returned unchanged. A Prompt *success* never reaches Summarizer.
 *
 * `customProfiles` (MIK-018, docs/ai-analysis-v2.md "Skill matching") are the
 * caller's currently-enabled Drive-synced custom skills, already converted to
 * {@link AnalysisProfile} by `ai/custom-profile.ts`. They are merged with the
 * fixed built-ins before selection, so a higher-priority/more-specific custom
 * skill can win, while the built-ins remain the fallback when nothing custom
 * matches. Omitting the argument (or passing an empty array) reproduces the
 * built-in-only Phase 1 behavior exactly.
 */
import {
	DEFAULT_LANGUAGE,
	type SupportedLanguage,
	inferOutputLanguage,
} from "../i18n/index";
import { errorLogFields, noopLogger, type Logger } from "../logging/index";
import { buildConciseSummary } from "./concise-summary";
import { parseAnalysis } from "./parse";
import { BUILT_IN_PROFILES, selectAnalysisProfile } from "./profile";
import type { AnalysisProfile } from "./profile";
import { buildAnalysisPrompt } from "./prompt";
import {
	type PromptClient,
	type PromptLifecycleEvent,
	PromptApiUnavailableError,
	PromptSessionCreateError,
} from "./prompt-api";
import type { SummarizerClient } from "./summarizer-api";
import {
	PROMPT_ANALYSIS_MODEL,
	SUMMARIZER_ANALYSIS_MODEL,
	type AnalysisInput,
	type AnalysisOutcome,
} from "./types";

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/**
 * Transient, safe model-setup detail reported while an analysis runs: the
 * model needs preparing (download required or already in flight), download
 * progress, and the moment the session is ready. Foreground-UI display only —
 * never persisted, never part of the durable bookmark `AiStatus`.
 */
export type AnalysisModelSetup =
	| { readonly kind: "model-preparing" }
	| { readonly kind: "model-downloading"; readonly ratio?: number }
	| { readonly kind: "model-ready" };

export interface AnalyzePageOptions {
	logger?: Logger;
	/** Best-effort model setup/download reporter; must never affect the result. */
	onModelSetup?: (event: AnalysisModelSetup) => void;
	/**
	 * Optional Summarizer API client used *only* as a concise fallback after a
	 * terminal Prompt API outcome (docs/summarizer-fallback.md). Omitting it
	 * reproduces the Prompt-only behavior exactly.
	 */
	summarizer?: SummarizerClient;
}

/**
 * The concise Summarizer input: the same in-memory title and excerpt the Prompt
 * path already received. Deliberately *not* the analysis prompt — no profile
 * instruction, no output contract, no system prompt reaches Summarizer.
 */
function buildSummarizerInput(input: AnalysisInput): string {
	return `${input.title}\n\n${input.excerpt}`.trim();
}

/**
 * One concise-summary attempt after the Prompt API reached a terminal outcome.
 *
 * Returns a ready fallback outcome only when Summarizer is *already* available
 * and produced nonblank text; every other path returns `null` so the caller
 * keeps the original Prompt outcome unchanged. Never starts a model download,
 * and logs safe metadata only (no excerpt, URL, output, or browser error text).
 */
async function summarizerFallback(
	summarizer: SummarizerClient | undefined,
	input: AnalysisInput,
	language: SupportedLanguage,
	logger: Logger,
): Promise<AnalysisOutcome | null> {
	if (!summarizer) {
		return null;
	}

	let availability: Awaited<ReturnType<SummarizerClient["availability"]>>;
	try {
		availability = await summarizer.availability(language);
	} catch (error) {
		logger.log("warn", "ai.analysis.summarizer-fallback-failed", {
			...errorLogFields(error),
			language,
		});
		return null;
	}
	// Availability is independent of the Prompt API's: only an already-prepared
	// model may run here. A `downloadable`/`downloading` model is skipped rather
	// than downloaded (docs/summarizer-fallback.md "Trigger and availability").
	if (availability !== "available") {
		logger.log("info", "ai.analysis.summarizer-fallback-skipped", {
			availability,
			language,
		});
		return null;
	}

	let raw: string;
	try {
		raw = await summarizer.summarize(buildSummarizerInput(input), language);
	} catch (error) {
		logger.log("warn", "ai.analysis.summarizer-fallback-failed", {
			...errorLogFields(error),
			language,
		});
		return null;
	}

	const summary = buildConciseSummary(raw);
	if (!summary) {
		// Blank output is unusable — keep the Prompt outcome rather than storing
		// an empty "ready" summary.
		logger.log("warn", "ai.analysis.summarizer-fallback-blank", { language });
		return null;
	}

	logger.log("info", "ai.analysis.summarizer-fallback-ready", { language });
	return { status: "ready", model: SUMMARIZER_ANALYSIS_MODEL, summary };
}

/**
 * Select the analysis output language for one input (MIK-033).
 *
 * The caller's current UI/browser language (`fallbackLanguage` — the name is
 * historical from MIK-029) wins whenever it resolved to a supported language,
 * so a Japanese-UI user gets Japanese analysis even on an all-English page
 * (e.g. a GitHub repository). Page-text inference remains only as a defensive
 * fallback when no UI/browser language was provided, keeping the historical
 * behavior: infer from title + excerpt, then Japanese.
 */
export function selectOutputLanguage(input: AnalysisInput): SupportedLanguage {
	return (
		input.fallbackLanguage ??
		inferOutputLanguage(`${input.title}\n${input.excerpt}`, DEFAULT_LANGUAGE)
	);
}

export async function analyzePage(
	client: PromptClient,
	input: AnalysisInput,
	customProfiles: readonly AnalysisProfile[] = [],
	options: AnalyzePageOptions = {},
): Promise<AnalysisOutcome> {
	const logger = options.logger ?? noopLogger;
	// The output language follows the caller's current UI/browser language, with
	// page-text inference only as a fallback (MIK-033; see selectOutputLanguage).
	// Resolved before the availability probe so the probe can request the same
	// language-specific expected outputs the session will use.
	const language = selectOutputLanguage(input);

	/**
	 * Every terminal Prompt outcome — `unavailable` or any `failed` — gets one
	 * concise Summarizer attempt; the Prompt outcome survives unchanged whenever
	 * that attempt cannot produce usable text (docs/summarizer-fallback.md).
	 */
	const withFallback = async (
		promptOutcome: AnalysisOutcome,
	): Promise<AnalysisOutcome> =>
		(await summarizerFallback(options.summarizer, input, language, logger)) ??
		promptOutcome;

	let availability: Awaited<ReturnType<PromptClient["availability"]>>;
	try {
		availability = await client.availability(language);
	} catch (error) {
		// A throwing availability probe means we cannot run AI — preserve the
		// bookmark rather than marking it failed.
		logger.log("warn", "ai.analysis.availability-threw", {
			...errorLogFields(error),
			language,
		});
		return withFallback({
			status: "unavailable",
			reason: describeError(error),
		});
	}
	if (availability === "unavailable") {
		logger.log("warn", "ai.analysis.unavailable", {
			availability,
			language,
		});
		return withFallback({
			status: "unavailable",
			reason: `Prompt API ${availability}`,
		});
	}

	// `downloadable` / `downloading` are no longer terminal: proceeding into
	// `client.prompt(...)` lets the adapter's `create({ monitor })` start (or
	// join) Chrome's model download in this user-initiated foreground flow.
	const needsDownload = availability !== "available";
	if (needsDownload) {
		logger.log("info", "ai.analysis.model-download-required", {
			availability,
			language,
		});
	}

	const profiles =
		customProfiles.length > 0
			? [...BUILT_IN_PROFILES, ...customProfiles]
			: BUILT_IN_PROFILES;
	const profile = selectAnalysisProfile(input.url, profiles);

	let reportedModelSetup = false;
	const onLifecycleEvent = (event: PromptLifecycleEvent): void => {
		if (event.kind === "download-required") {
			return;
		}
		if (event.kind === "download-progress") {
			// Safe numbers only (loaded/total/ratio) — never content.
			logger.log("debug", "ai.analysis.model-download-progress", {
				loaded: event.loaded,
				total: event.total,
				ratio: event.ratio,
				language,
				profileId: profile.id,
			});
			reportedModelSetup = true;
			options.onModelSetup?.({
				kind: "model-downloading",
				ratio: event.ratio,
			});
			return;
		}
		// session-created: the model finished downloading (or was already local).
		if (needsDownload) {
			logger.log("info", "ai.analysis.model-session-created", {
				availability,
				language,
				profileId: profile.id,
			});
		}
		if (reportedModelSetup) {
			options.onModelSetup?.({ kind: "model-ready" });
		}
	};

	let raw: string;
	try {
		raw = await client.prompt(
			buildAnalysisPrompt(input, profile, language),
			language,
			onLifecycleEvent,
		);
	} catch (error) {
		if (error instanceof PromptApiUnavailableError) {
			logger.log("warn", "ai.analysis.prompt-unavailable", {
				...errorLogFields(error),
				language,
				profileId: profile.id,
			});
			return withFallback({ status: "unavailable", reason: error.message });
		}
		if (error instanceof PromptSessionCreateError) {
			// Session creation (which includes the model download) failed — log it
			// distinctly from a prompt failure; the error's message/causeName carry
			// only error names, never browser-provided text.
			logger.log("error", "ai.analysis.session-create-failed", {
				...errorLogFields(error),
				causeName: error.causeName,
				availability,
				language,
				profileId: profile.id,
			});
			return withFallback({
				status: "failed",
				error: { kind: "client-error", message: error.message },
			});
		}
		logger.log("error", "ai.analysis.prompt-failed", {
			...errorLogFields(error),
			language,
			profileId: profile.id,
		});
		return withFallback({
			status: "failed",
			error: { kind: "client-error", message: describeError(error) },
		});
	}

	const parsed = parseAnalysis(raw);
	if (!parsed.ok) {
		logger.log("warn", "ai.analysis.parse-failed", {
			kind: parsed.error.kind,
			language,
			profileId: profile.id,
			rawLength: raw.length,
		});
		return withFallback({ status: "failed", error: parsed.error });
	}
	return {
		status: "ready",
		model: PROMPT_ANALYSIS_MODEL,
		analysis: parsed.value,
		profileId: profile.id,
	};
}
