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
import type { AnalysisInput, AnalysisOutcome } from "./types";

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
		return { status: "unavailable", reason: describeError(error) };
	}
	if (availability === "unavailable") {
		logger.log("warn", "ai.analysis.unavailable", {
			availability,
			language,
		});
		return { status: "unavailable", reason: `Prompt API ${availability}` };
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
		options.onModelSetup?.({ kind: "model-preparing" });
	}

	const profiles =
		customProfiles.length > 0
			? [...BUILT_IN_PROFILES, ...customProfiles]
			: BUILT_IN_PROFILES;
	const profile = selectAnalysisProfile(input.url, profiles);

	const onLifecycleEvent = (event: PromptLifecycleEvent): void => {
		if (event.kind === "download-required") {
			options.onModelSetup?.({ kind: "model-preparing" });
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
		options.onModelSetup?.({ kind: "model-ready" });
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
			return { status: "unavailable", reason: error.message };
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
			return {
				status: "failed",
				error: { kind: "client-error", message: error.message },
			};
		}
		logger.log("error", "ai.analysis.prompt-failed", {
			...errorLogFields(error),
			language,
			profileId: profile.id,
		});
		return {
			status: "failed",
			error: { kind: "client-error", message: describeError(error) },
		};
	}

	const parsed = parseAnalysis(raw);
	if (!parsed.ok) {
		logger.log("warn", "ai.analysis.parse-failed", {
			kind: parsed.error.kind,
			language,
			profileId: profile.id,
			rawLength: raw.length,
		});
		return { status: "failed", error: parsed.error };
	}
	return { status: "ready", analysis: parsed.value, profileId: profile.id };
}
