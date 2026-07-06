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
 *   - API not `available`            → `unavailable` (bookmark preserved).
 *   - API present but `prompt` throws
 *       {@link PromptApiUnavailableError} → `unavailable`.
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
import { type PromptClient, PromptApiUnavailableError } from "./prompt-api";
import type { AnalysisInput, AnalysisOutcome } from "./types";

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export interface AnalyzePageOptions {
	logger?: Logger;
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
	if (availability !== "available") {
		logger.log("warn", "ai.analysis.unavailable", {
			availability,
			language,
		});
		return { status: "unavailable", reason: `Prompt API ${availability}` };
	}

	const profiles =
		customProfiles.length > 0
			? [...BUILT_IN_PROFILES, ...customProfiles]
			: BUILT_IN_PROFILES;
	const profile = selectAnalysisProfile(input.url, profiles);

	let raw: string;
	try {
		raw = await client.prompt(
			buildAnalysisPrompt(input, profile, language),
			language,
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
