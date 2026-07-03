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
import { DEFAULT_LANGUAGE, inferOutputLanguage } from "../i18n/index";
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

export async function analyzePage(
	client: PromptClient,
	input: AnalysisInput,
	customProfiles: readonly AnalysisProfile[] = [],
): Promise<AnalysisOutcome> {
	// The output language is inferred from the page's own text (title +
	// excerpt), falling back to the caller's UI/browser language, then Japanese
	// (MIK-029). Resolved before the availability probe so the probe can request
	// the same language-specific expected outputs the session will use.
	const language = inferOutputLanguage(
		`${input.title}\n${input.excerpt}`,
		input.fallbackLanguage ?? DEFAULT_LANGUAGE,
	);

	let availability: Awaited<ReturnType<PromptClient["availability"]>>;
	try {
		availability = await client.availability(language);
	} catch (error) {
		// A throwing availability probe means we cannot run AI — preserve the
		// bookmark rather than marking it failed.
		return { status: "unavailable", reason: describeError(error) };
	}
	if (availability !== "available") {
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
			return { status: "unavailable", reason: error.message };
		}
		return {
			status: "failed",
			error: { kind: "client-error", message: describeError(error) },
		};
	}

	const parsed = parseAnalysis(raw);
	if (!parsed.ok) {
		return { status: "failed", error: parsed.error };
	}
	return { status: "ready", analysis: parsed.value, profileId: profile.id };
}
