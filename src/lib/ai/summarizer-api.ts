/**
 * Summarizer API port + Chrome Built-in AI adapter (docs/summarizer-fallback.md).
 *
 * This is the *fallback* path only: the Prompt API remains the normal
 * rich-analysis path, and the analyzer reaches for this port solely after a
 * Prompt API terminal failure. Like `prompt-api.ts`, the analyzer depends on the
 * small {@link SummarizerClient} port rather than a browser global, so it stays
 * testable without Chrome.
 *
 * ## Assumptions about the browser API (isolated here on purpose)
 *
 *   - A summarizer namespace is exposed as `globalThis.Summarizer` (current
 *     Chrome) or `globalThis.ai.summarizer` (older builds).
 *   - `namespace.availability(options)` resolves to one of
 *     `"unavailable" | "downloadable" | "downloading" | "available"`.
 *   - `namespace.create(options)` resolves to a session with
 *     `summarize(text): Promise<string>` and an optional `destroy()`.
 *   - `create()` accepts `sharedContext`, `type`, `format`, `length`,
 *     `preference`, and `outputLanguage`.
 *
 * ## Deliberate non-goals
 *
 *   - **No model download.** `create()` is called without a `monitor`, and the
 *     analyzer only calls `summarize` when availability is already `available`.
 *     A Prompt failure must never kick off a Summarizer download.
 *   - **No profile input.** Only the fixed generic
 *     {@link CONCISE_SUMMARY_SHARED_CONTEXT} is passed — never a profile name,
 *     custom-skill instruction, or raw prompt.
 *   - **No content in errors.** Browser failures are wrapped in
 *     {@link SummarizerRunError}, which keeps only the cause's error *name*, so
 *     no browser-provided text can reach logs or `aiError`.
 */
import type { SupportedLanguage } from "../i18n/index";

/** Normalized availability reported by the adapter. */
export type SummarizerAvailability =
	| "available"
	| "downloadable"
	| "downloading"
	| "unavailable";

/**
 * Fixed concise-summary options (docs/summarizer-fallback.md "Summary
 * configuration"). Not configurable: the fallback is a generic bookmark
 * summary, never a profile-driven analysis.
 */
export const CONCISE_SUMMARY_OPTIONS = {
	type: "key-points",
	length: "short",
	format: "markdown",
	preference: "auto",
} as const;

/**
 * The only context handed to Summarizer. Generic and fixed on purpose — it
 * names the *situation* (a saved bookmark), never an analysis profile, a
 * custom skill, or an output contract.
 */
export const CONCISE_SUMMARY_SHARED_CONTEXT =
	"A web page the reader saved as a bookmark for later reference.";

/**
 * The port the analyzer talks to. A fake implementing this interface is all a
 * test needs; the real Chrome global never appears in analyzer tests.
 */
export interface SummarizerClient {
	/**
	 * Whether the Summarizer API can currently summarize. `language`, when given,
	 * is the target output language the probe should request (default Japanese).
	 */
	availability(language?: SupportedLanguage): Promise<SummarizerAvailability>;
	/**
	 * Produce one concise summary and return the raw generated text. `language`,
	 * when given, is the output language requested (default Japanese).
	 */
	summarize(input: string, language?: SupportedLanguage): Promise<string>;
}

/**
 * Thrown by the adapter's {@link SummarizerClient.summarize} when the Summarizer
 * API is not present at all. The analyzer keeps the original Prompt API outcome.
 */
export class SummarizerApiUnavailableError extends Error {
	constructor(message = "Chrome Summarizer API is unavailable") {
		super(message);
		this.name = "SummarizerApiUnavailableError";
	}
}

/**
 * Thrown when `create()` or `summarize()` rejects. The message carries only the
 * cause's error *name*, never its message, so nothing the browser embedded can
 * reach a log or a user-visible string.
 */
export class SummarizerRunError extends Error {
	/** The rejecting error's name (e.g. `"NotSupportedError"`), for safe logs. */
	readonly causeName: string;
	constructor(cause: unknown) {
		const causeName =
			cause instanceof Error && cause.name.length > 0
				? cause.name
				: typeof cause;
		super(`Summarizer API run failed (${causeName})`);
		this.name = "SummarizerRunError";
		this.causeName = causeName;
	}
}

// --- Structural view of the browser globals (see file header assumptions) ---

export interface SummarizerSession {
	summarize(input: string, options?: { signal?: AbortSignal }): Promise<string>;
	destroy?(): void;
}

export interface SummarizerNamespace {
	availability(options?: unknown): Promise<string>;
	create(options?: unknown): Promise<SummarizerSession>;
}

/** Locate the summarizer namespace, tolerating both known global shapes. */
export function resolveSummarizerNamespace(): SummarizerNamespace | null {
	const scope = globalThis as {
		Summarizer?: SummarizerNamespace;
		ai?: { summarizer?: SummarizerNamespace };
	};
	if (scope.Summarizer && typeof scope.Summarizer.availability === "function") {
		return scope.Summarizer;
	}
	const legacy = scope.ai?.summarizer;
	if (legacy && typeof legacy.availability === "function") {
		return legacy;
	}
	return null;
}

/** Map any reported availability string onto the normalized union. */
function normalizeAvailability(value: unknown): SummarizerAvailability {
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
 * Build a {@link SummarizerClient} backed by the browser Summarizer API. The
 * namespace is resolved from `globalThis` by default but can be injected (tests,
 * or a future relocation of the global).
 *
 * Availability never throws — a missing or throwing API resolves to
 * `"unavailable"`. A `summarize` call against a missing API throws
 * {@link SummarizerApiUnavailableError}; any browser rejection becomes a
 * {@link SummarizerRunError}. Either way the analyzer keeps the Prompt outcome.
 */
export function createChromeSummarizerClient(
	namespace: SummarizerNamespace | null = resolveSummarizerNamespace(),
	options: { signal?: AbortSignal } = {},
): SummarizerClient {
	return {
		async availability(
			language: SupportedLanguage = "ja",
		): Promise<SummarizerAvailability> {
			if (!namespace) {
				return "unavailable";
			}
			try {
				return normalizeAvailability(
					await namespace.availability({
						...CONCISE_SUMMARY_OPTIONS,
						outputLanguage: language,
					}),
				);
			} catch {
				return "unavailable";
			}
		},
		async summarize(
			input: string,
			language: SupportedLanguage = "ja",
		): Promise<string> {
			if (!namespace) {
				throw new SummarizerApiUnavailableError();
			}
			// No `monitor`: the fallback must never start a model download after a
			// Prompt failure (docs/summarizer-fallback.md "Trigger and availability").
			let session: SummarizerSession;
			try {
				options.signal?.throwIfAborted();
				session = await namespace.create({
					...CONCISE_SUMMARY_OPTIONS,
					sharedContext: CONCISE_SUMMARY_SHARED_CONTEXT,
					outputLanguage: language,
					...(options.signal ? { signal: options.signal } : {}),
				});
			} catch (cause) {
				throw new SummarizerRunError(cause);
			}
			const destroy = () => {
				try {
					session.destroy?.();
				} catch {
					/* Best-effort cleanup. */
				}
			};
			options.signal?.addEventListener("abort", destroy, { once: true });
			try {
				options.signal?.throwIfAborted();
				return await (options.signal
					? session.summarize(input, { signal: options.signal })
					: session.summarize(input));
			} catch (cause) {
				throw new SummarizerRunError(cause);
			} finally {
				options.signal?.removeEventListener("abort", destroy);
				destroy();
			}
		},
	};
}
