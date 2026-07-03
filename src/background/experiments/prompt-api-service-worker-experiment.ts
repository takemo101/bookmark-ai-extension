/**
 * MIK-020 experiment-only harness.
 *
 * This module exists to answer one question with real Chrome evidence:
 * does the Chrome Built-in AI / Prompt API work from an MV3 extension service
 * worker (availability, session creation, prompt execution, and lifecycle
 * behavior around a slower prompt)? It is not production background queue
 * processing and must never be reached by normal bookmark save/re-analyze
 * flows. It is inert unless a caller explicitly sends the message action
 * exported below.
 *
 * All prompt text used here is synthetic and hardcoded — never derived from a
 * real page — and the report never includes raw model output or prompt input
 * text, only status/duration/count metadata, to stay safe if ever pasted into
 * an issue or doc.
 *
 * See docs/prompt-api-service-worker-experiment.md for the real-Chrome run
 * protocol and run record.
 */
import {
	type PromptModelNamespace,
	type PromptSession,
	resolveNamespace,
} from "../../lib/ai/prompt-api";

export type ExperimentStatus = "pass" | "fail" | "partial" | "n/a";

export interface ExperimentPointResult {
	status: ExperimentStatus;
	detail?: string;
	error?: string;
}

export interface PromptApiServiceWorkerExperimentReport {
	timestamp: string;
	userAgent: string | null;
	availability: ExperimentPointResult;
	sessionCreation: ExperimentPointResult;
	promptExecution: ExperimentPointResult;
	slowPromptLifecycle: ExperimentPointResult;
}

/** Unmistakable message action name used to trigger this experiment manually. */
export const PROMPT_API_EXPERIMENT_MESSAGE_ACTION =
	"bookmark-ai:prompt-api-service-worker-experiment";

const SKIPPED_NO_NAMESPACE: ExperimentPointResult = {
	status: "n/a",
	detail: "skipped: no Prompt API namespace",
};

const SKIPPED_NO_AVAILABILITY: ExperimentPointResult = {
	status: "n/a",
	detail: "skipped: availability check did not pass",
};

const SKIPPED_NO_SESSION: ExperimentPointResult = {
	status: "n/a",
	detail: "skipped: session creation did not pass",
};

const ENGLISH_TEXT_OUTPUT = [{ type: "text", languages: ["en"] }] as const;

/** Synthetic, non-sensitive system prompt for the experiment session(s). */
const SYSTEM_PROMPT = "You are a test assistant. Reply concisely.";
/** Synthetic, non-sensitive fast prompt for the promptExecution check. */
const FAST_PROMPT = "Reply with exactly one word: OK";
/** Synthetic, non-sensitive longer prompt for the slowPromptLifecycle check. */
const SLOW_PROMPT =
	"Count from one to ten. Write each number on its own line as a plain synthetic placeholder, with no real-world content.";

function safeErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run the MIK-020 experiment against the given Prompt API namespace (or the
 * real `globalThis` namespace by default). Never rejects — every failure is
 * captured as a `fail` result in the returned report.
 */
export async function runPromptApiServiceWorkerExperiment(
	namespace: PromptModelNamespace | null = resolveNamespace(),
): Promise<PromptApiServiceWorkerExperimentReport> {
	const timestamp = new Date().toISOString();
	const userAgent =
		typeof navigator !== "undefined" ? navigator.userAgent : null;

	if (!namespace) {
		return {
			timestamp,
			userAgent,
			availability: {
				status: "fail",
				error:
					"LanguageModel/ai.languageModel not found in this service worker global scope",
			},
			sessionCreation: SKIPPED_NO_NAMESPACE,
			promptExecution: SKIPPED_NO_NAMESPACE,
			slowPromptLifecycle: SKIPPED_NO_NAMESPACE,
		};
	}

	const availability = await checkAvailability(namespace);
	if (availability.status === "fail") {
		return {
			timestamp,
			userAgent,
			availability,
			sessionCreation: SKIPPED_NO_AVAILABILITY,
			promptExecution: SKIPPED_NO_AVAILABILITY,
			slowPromptLifecycle: SKIPPED_NO_AVAILABILITY,
		};
	}
	if (availability.status === "partial") {
		return {
			timestamp,
			userAgent,
			availability,
			sessionCreation: SKIPPED_NO_AVAILABILITY,
			promptExecution: SKIPPED_NO_AVAILABILITY,
			slowPromptLifecycle: SKIPPED_NO_AVAILABILITY,
		};
	}

	const { result: sessionCreation, session } =
		await checkSessionCreation(namespace);
	if (sessionCreation.status !== "pass" || !session) {
		return {
			timestamp,
			userAgent,
			availability,
			sessionCreation,
			promptExecution: SKIPPED_NO_SESSION,
			slowPromptLifecycle: SKIPPED_NO_SESSION,
		};
	}

	const promptExecution = await checkPromptExecution(session);

	const slowPromptLifecycle = await checkSlowPromptLifecycle(namespace);

	return {
		timestamp,
		userAgent,
		availability,
		sessionCreation,
		promptExecution,
		slowPromptLifecycle,
	};
}

async function checkAvailability(
	namespace: PromptModelNamespace,
): Promise<ExperimentPointResult> {
	try {
		const raw = await namespace.availability();
		if (raw === "unavailable") {
			return {
				status: "partial",
				detail: "Prompt API namespace present but reports unavailable",
			};
		}
		return { status: "pass", detail: `raw availability: ${String(raw)}` };
	} catch (error) {
		return { status: "fail", error: safeErrorMessage(error) };
	}
}

async function checkSessionCreation(
	namespace: PromptModelNamespace,
): Promise<{ result: ExperimentPointResult; session: PromptSession | null }> {
	try {
		const session = await namespace.create({
			initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
			expectedOutputs: ENGLISH_TEXT_OUTPUT,
		});
		return { result: { status: "pass" }, session };
	} catch (error) {
		return {
			result: { status: "fail", error: safeErrorMessage(error) },
			session: null,
		};
	}
}

async function checkPromptExecution(
	session: PromptSession,
): Promise<ExperimentPointResult> {
	try {
		const start = Date.now();
		await session.prompt(FAST_PROMPT);
		const elapsed = Date.now() - start;
		return { status: "pass", detail: `responded in ${elapsed}ms` };
	} catch (error) {
		return { status: "fail", error: safeErrorMessage(error) };
	} finally {
		session.destroy?.();
	}
}

async function checkSlowPromptLifecycle(
	namespace: PromptModelNamespace,
): Promise<ExperimentPointResult> {
	let session: PromptSession | null = null;
	try {
		session = await namespace.create({
			initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
			expectedOutputs: ENGLISH_TEXT_OUTPUT,
		});
	} catch (error) {
		return { status: "fail", error: safeErrorMessage(error) };
	}

	try {
		const start = Date.now();
		await session.prompt(SLOW_PROMPT);
		const elapsed = Date.now() - start;
		return {
			status: "pass",
			detail:
				`second session completed in ${elapsed}ms; note: true MV3 idle/30s-termination ` +
				"behavior can only be confirmed by a human observing the chrome://extensions " +
				"service worker status during/after this call — see docs",
		};
	} catch (error) {
		return { status: "fail", error: safeErrorMessage(error) };
	} finally {
		session.destroy?.();
	}
}
