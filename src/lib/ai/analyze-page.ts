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
 */
import { parseAnalysis } from "./parse";
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
): Promise<AnalysisOutcome> {
	let availability: Awaited<ReturnType<PromptClient["availability"]>>;
	try {
		availability = await client.availability();
	} catch (error) {
		// A throwing availability probe means we cannot run AI — preserve the
		// bookmark rather than marking it failed.
		return { status: "unavailable", reason: describeError(error) };
	}
	if (availability !== "available") {
		return { status: "unavailable", reason: `Prompt API ${availability}` };
	}

	let raw: string;
	try {
		raw = await client.prompt(buildAnalysisPrompt(input));
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
	return { status: "ready", analysis: parsed.value };
}
