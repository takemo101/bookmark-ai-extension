/**
 * Prompt API port + Chrome Built-in AI adapter.
 *
 * The analyzer depends only on the small {@link PromptClient} port, never on a
 * concrete browser global, so it stays testable without Chrome. The concrete
 * adapter ({@link createChromePromptClient}) wraps the browser Prompt API and
 * maps it to safe, typed results.
 *
 * ## Assumptions about the browser API (isolated here on purpose)
 *
 * The exact Chrome Built-in AI / Prompt API surface is still moving, so this
 * adapter pins its assumptions in one place behind the port:
 *   - A language-model namespace is exposed as `globalThis.LanguageModel`
 *     (current Chrome) or `globalThis.ai.languageModel` (older builds).
 *   - `namespace.availability()` resolves to one of
 *     `"unavailable" | "downloadable" | "downloading" | "available"`.
 *   - `namespace.create(options)` resolves to a session with
 *     `prompt(text): Promise<string>` and an optional `destroy()`.
 * If a future Chrome changes these, only this file moves — callers keep using
 * {@link PromptClient}. The namespace can also be injected for tests.
 */
import { ANALYSIS_SYSTEM_PROMPT } from "./prompt";

/** Normalized availability reported by the adapter. */
export type PromptApiAvailability =
	| "available"
	| "downloadable"
	| "downloading"
	| "unavailable";

/**
 * The port the analyzer talks to. A fake implementing this interface is all a
 * test needs; the real Chrome global never appears in analyzer tests.
 */
export interface PromptClient {
	/** Whether the Prompt API can currently run a prompt. */
	availability(): Promise<PromptApiAvailability>;
	/** Run one prompt and return the raw model text. */
	prompt(input: string): Promise<string>;
}

/**
 * Thrown by the adapter's {@link PromptClient.prompt} when the Prompt API is not
 * present at all. The analyzer treats this as `unavailable` (not `failed`) so
 * the bookmark is preserved for later re-analysis.
 */
export class PromptApiUnavailableError extends Error {
	constructor(message = "Chrome Built-in AI / Prompt API is unavailable") {
		super(message);
		this.name = "PromptApiUnavailableError";
	}
}

// --- Structural view of the browser globals (see file header assumptions) ---

type RawAvailability =
	| "unavailable"
	| "downloadable"
	| "downloading"
	| "available";

interface PromptSession {
	prompt(input: string): Promise<string>;
	destroy?(): void;
}

interface PromptModelNamespace {
	availability(options?: unknown): Promise<RawAvailability | string>;
	create(options?: unknown): Promise<PromptSession>;
}

/** Locate the language-model namespace, tolerating both known global shapes. */
function resolveNamespace(): PromptModelNamespace | null {
	const scope = globalThis as {
		LanguageModel?: PromptModelNamespace;
		ai?: { languageModel?: PromptModelNamespace };
	};
	if (
		scope.LanguageModel &&
		typeof scope.LanguageModel.availability === "function"
	) {
		return scope.LanguageModel;
	}
	const legacy = scope.ai?.languageModel;
	if (legacy && typeof legacy.availability === "function") {
		return legacy;
	}
	return null;
}

/** Map any reported availability string onto the normalized union. */
function normalizeAvailability(value: unknown): PromptApiAvailability {
	switch (value) {
		case "available":
		case "downloadable":
		case "downloading":
			return value;
		// "no" / "readily" / "after-download" were earlier spellings; collapse
		// anything unrecognized to a safe "unavailable".
		case "readily":
			return "available";
		case "after-download":
			return "downloadable";
		default:
			return "unavailable";
	}
}

/**
 * Build a {@link PromptClient} backed by the browser Prompt API. The namespace
 * is resolved from `globalThis` by default but can be injected (tests, or a
 * future relocation of the global).
 *
 * Availability never throws — a missing or throwing API resolves to
 * `"unavailable"`. A `prompt` call against a missing API throws
 * {@link PromptApiUnavailableError}; the analyzer maps that to `unavailable`.
 */
export function createChromePromptClient(
	namespace: PromptModelNamespace | null = resolveNamespace(),
): PromptClient {
	return {
		async availability(): Promise<PromptApiAvailability> {
			if (!namespace) {
				return "unavailable";
			}
			try {
				return normalizeAvailability(await namespace.availability());
			} catch {
				return "unavailable";
			}
		},
		async prompt(input: string): Promise<string> {
			if (!namespace) {
				throw new PromptApiUnavailableError();
			}
			const session = await namespace.create({
				initialPrompts: [{ role: "system", content: ANALYSIS_SYSTEM_PROMPT }],
			});
			try {
				return await session.prompt(input);
			} finally {
				session.destroy?.();
			}
		},
	};
}
