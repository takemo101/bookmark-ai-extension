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
 *   - `namespace.availability(options)` and `namespace.create(options)` accept
 *     `expectedOutputs`; this adapter requests text output in the caller's
 *     target language (Japanese by default, MIK-029) to match the product's AI
 *     contract and avoid Chrome's missing-output-language warning.
 * If a future Chrome changes these, only this file moves — callers keep using
 * {@link PromptClient}. The namespace can also be injected for tests.
 */
import type { SupportedLanguage } from "../i18n/index";
import { errorLogFields, noopLogger, type Logger } from "../logging/index";
import { analysisSystemPrompt } from "./prompt";

/** Normalized availability reported by the adapter. */
export type PromptApiAvailability =
	| "available"
	| "downloadable"
	| "downloading"
	| "unavailable";

/**
 * Safe, metadata-only lifecycle events the adapter emits while running one
 * prompt: model download progress (numbers only, never content) and the moment
 * the session exists. `create({ monitor })` starts or joins the built-in model
 * download when availability is `downloadable`/`downloading`, so these events
 * are what a foreground UI needs to show "downloading the model" honestly.
 */
export type PromptLifecycleEvent =
	| { readonly kind: "download-required" }
	| {
			readonly kind: "download-progress";
			/** Raw `loaded` from the browser event (a 0..1 fraction or a byte count). */
			readonly loaded: number;
			readonly total?: number;
			/** Normalized 0..1 completion when derivable from `loaded`/`total`. */
			readonly ratio?: number;
	  }
	| { readonly kind: "session-created" };

/** Best-effort lifecycle observer; a throwing observer never breaks the flow. */
export type PromptLifecycleObserver = (event: PromptLifecycleEvent) => void;

/**
 * The port the analyzer talks to. A fake implementing this interface is all a
 * test needs; the real Chrome global never appears in analyzer tests.
 */
export interface PromptClient {
	/**
	 * Whether the Prompt API can currently run a prompt. `language`, when given,
	 * is the target output language the probe should request (default Japanese).
	 */
	availability(language?: SupportedLanguage): Promise<PromptApiAvailability>;
	/**
	 * Run one prompt and return the raw model text. `language`, when given, is
	 * the output language requested from the session (default Japanese).
	 * `observer`, when given, receives safe {@link PromptLifecycleEvent}s (model
	 * download progress, session creation) while the call runs.
	 */
	prompt(
		input: string,
		language?: SupportedLanguage,
		observer?: PromptLifecycleObserver,
	): Promise<string>;
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

/**
 * Thrown by the adapter's {@link PromptClient.prompt} when `create()` — the
 * call that also performs the model download — rejects. The message carries
 * only the cause's error *name*, never its message, so downstream `aiError`
 * text and logs stay free of anything the browser might have embedded.
 */
export class PromptSessionCreateError extends Error {
	/** The rejecting error's name (e.g. `"NotSupportedError"`), for safe logs. */
	readonly causeName: string;
	constructor(cause: unknown) {
		const causeName =
			cause instanceof Error && cause.name.length > 0
				? cause.name
				: typeof cause;
		super(`Prompt API model session creation failed (${causeName})`);
		this.name = "PromptSessionCreateError";
		this.causeName = causeName;
	}
}

// --- Structural view of the browser globals (see file header assumptions) ---

type RawAvailability =
	| "unavailable"
	| "downloadable"
	| "downloading"
	| "available";

export interface PromptSession {
	prompt(input: string): Promise<string>;
	destroy?(): void;
}

export interface PromptModelNamespace {
	availability(options?: unknown): Promise<RawAvailability | string>;
	create(options?: unknown): Promise<PromptSession>;
}

/** `expectedOutputs` for one target language (MIK-029). */
function expectedTextOutputs(language: SupportedLanguage) {
	return [{ type: "text", languages: [language] }] as const;
}

/** The structural slice of the `create({ monitor })` callback argument we use. */
type PromptCreateMonitorTarget = {
	addEventListener?(type: string, listener: (event: unknown) => void): void;
};

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * Normalize one `downloadprogress` event to safe numbers, or `null` when the
 * event is malformed (design: malformed progress is ignored, the create/prompt
 * flow continues). Chrome has shipped both `loaded` as a 0..1 fraction and as
 * a byte count paired with `total`, so the ratio is derived defensively.
 */
function normalizeDownloadProgress(
	event: unknown,
): Extract<PromptLifecycleEvent, { kind: "download-progress" }> | null {
	if (typeof event !== "object" || event === null) {
		return null;
	}
	const raw = event as { loaded?: unknown; total?: unknown };
	const loaded = finiteNumber(raw.loaded);
	if (loaded === undefined || loaded < 0) {
		return null;
	}
	const total = finiteNumber(raw.total);
	const ratio =
		total !== undefined && total > 0
			? clamp01(loaded / total)
			: loaded <= 1
				? loaded
				: undefined;
	return { kind: "download-progress", loaded, total, ratio };
}

/** Invoke the observer defensively: reporting must never affect the flow. */
function notify(
	observer: PromptLifecycleObserver | undefined,
	event: PromptLifecycleEvent,
): void {
	if (!observer) {
		return;
	}
	try {
		observer(event);
	} catch {
		// Best-effort reporting only.
	}
}

/**
 * The `monitor` callback passed to `create()`: forwards normalized
 * `downloadprogress` events to the observer. Passed unconditionally — it is
 * inert when the model is already available or the browser never calls it.
 */
function downloadMonitor(observer: PromptLifecycleObserver | undefined) {
	return (target: PromptCreateMonitorTarget) => {
		if (typeof target?.addEventListener !== "function") {
			return;
		}
		target.addEventListener("downloadprogress", (event) => {
			const progress = normalizeDownloadProgress(event);
			if (progress) {
				notify(observer, progress);
			}
		});
	};
}

/**
 * Create a session, wrapping a rejecting `create()` (which includes model
 * download failures) in {@link PromptSessionCreateError} so callers can log
 * and map it distinctly from a later prompt failure.
 */
async function createSession(
	namespace: PromptModelNamespace,
	options: Record<string, unknown>,
	observer?: PromptLifecycleObserver,
): Promise<PromptSession> {
	let session: PromptSession;
	try {
		session = await namespace.create({
			...options,
			monitor: downloadMonitor(observer),
		});
	} catch (cause) {
		throw new PromptSessionCreateError(cause);
	}
	notify(observer, { kind: "session-created" });
	return session;
}

/** Locate the language-model namespace, tolerating both known global shapes. */
export function resolveNamespace(): PromptModelNamespace | null {
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
		async availability(
			language: SupportedLanguage = "ja",
		): Promise<PromptApiAvailability> {
			if (!namespace) {
				return "unavailable";
			}
			try {
				return normalizeAvailability(
					await namespace.availability({
						expectedOutputs: expectedTextOutputs(language),
					}),
				);
			} catch {
				return "unavailable";
			}
		},
		async prompt(
			input: string,
			language: SupportedLanguage = "ja",
			observer?: PromptLifecycleObserver,
		): Promise<string> {
			if (!namespace) {
				throw new PromptApiUnavailableError();
			}
			// `create({ monitor })` starts (or joins) the built-in model download
			// when availability is downloadable/downloading; the monitor relays
			// safe progress numbers to the observer.
			const session = await createSession(
				namespace,
				{
					initialPrompts: [
						{ role: "system", content: analysisSystemPrompt(language) },
					],
					expectedOutputs: expectedTextOutputs(language),
				},
				observer,
			);
			try {
				return await session.prompt(input);
			} finally {
				session.destroy?.();
			}
		},
	};
}

/**
 * The subset of an Ask AI recommendation prompt the runner needs: its own
 * system instruction (never the analysis system prompt) and the prompt text.
 * Structurally satisfied by `AskAiRecommendationPrompt` (MIK-044).
 */
export type AskAiPromptRequest = {
	readonly systemInstruction: string;
	readonly prompt: string;
};

/**
 * Runs one Ask AI recommendation prompt and returns the raw model text.
 * Throws {@link PromptApiUnavailableError} when the Prompt API cannot run
 * right now, so the caller falls back to local candidate cards (MIK-046).
 */
export type AskAiRecommendationRunner = (
	request: AskAiPromptRequest,
	language?: SupportedLanguage,
	observer?: PromptLifecycleObserver,
) => Promise<string>;

/**
 * Build an {@link AskAiRecommendationRunner} backed by the browser Prompt API.
 * Unlike {@link createChromePromptClient} — whose sessions are pinned to the
 * analysis system prompt — each run opens a session with the recommendation
 * prompt's own system instruction. A missing namespace, a throwing probe, or
 * any availability other than `"available"` (a model still downloading is not
 * usable for an interactive answer) throws {@link PromptApiUnavailableError}.
 */
export function createChromeAskAiRecommendationRunner(
	namespace: PromptModelNamespace | null = resolveNamespace(),
	options: { logger?: Logger } = {},
): AskAiRecommendationRunner {
	const logger = options.logger ?? noopLogger;
	return async (request, language = "ja", observer) => {
		if (!namespace) {
			throw new PromptApiUnavailableError();
		}
		await assertCanCreateSession(namespace, language, logger, "recommendation");
		const session = await createSession(
			namespace,
			{
				initialPrompts: [
					{ role: "system", content: request.systemInstruction },
				],
				expectedOutputs: expectedTextOutputs(language),
			},
			askAiLifecycleObserver(logger, language, "recommendation", observer),
		);
		try {
			return await session.prompt(request.prompt);
		} catch (error) {
			logger.log("warn", "ai.ask-ai.prompt-failed", {
				...errorLogFields(error),
				language,
				context: "recommendation",
			});
			throw error;
		} finally {
			session.destroy?.();
		}
	};
}

/**
 * Throws {@link PromptApiUnavailableError} unless the model can run NOW.
 *
 * Ask AI can start the Chrome-managed model setup flow for `downloadable` /
 * `downloading` by proceeding to `create({ monitor })`. `unavailable` still
 * falls back like before. All reported setup/download state is safe metadata
 * only: availability, language, surface, and numeric progress.
 */
async function assertCanCreateSession(
	namespace: PromptModelNamespace,
	language: SupportedLanguage,
	logger: Logger,
	context: "recommendation" | "chat-session",
): Promise<void> {
	let availability: PromptApiAvailability;
	try {
		availability = normalizeAvailability(
			await namespace.availability({
				expectedOutputs: expectedTextOutputs(language),
			}),
		);
	} catch (error) {
		logger.log("warn", "ai.ask-ai.availability-threw", {
			...errorLogFields(error),
			language,
			context,
		});
		throw new PromptApiUnavailableError();
	}
	if (availability === "unavailable") {
		logger.log("warn", "ai.ask-ai.model-unavailable", {
			availability,
			language,
			context,
		});
		throw new PromptApiUnavailableError();
	}
	if (availability === "downloadable" || availability === "downloading") {
		logger.log("info", "ai.ask-ai.model-download-required", {
			availability,
			language,
			context,
		});
	}
}

function askAiLifecycleObserver(
	logger: Logger,
	language: SupportedLanguage,
	context: "recommendation" | "chat-session",
	observer?: PromptLifecycleObserver,
): PromptLifecycleObserver {
	return (event) => {
		if (event.kind === "download-required") {
			notify(observer, event);
			return;
		}
		if (event.kind === "download-progress") {
			logger.log("debug", "ai.ask-ai.model-download-progress", {
				loaded: event.loaded,
				total: event.total,
				ratio: event.ratio,
				language,
				context,
			});
		} else {
			logger.log("info", "ai.ask-ai.session-created", { language, context });
		}
		notify(observer, event);
	};
}

/**
 * A live browser Prompt API session held open across prompts, owned by one Ask
 * AI chat session (MIK-048). Structurally satisfies the Ask AI controller's
 * `AskAiPromptSession` port. `destroy` is safe to call once the chat is
 * cleared; it tolerates browser sessions without a destroy method.
 */
export type AskAiPromptSessionHandle = {
	prompt(input: string): Promise<string>;
	destroy(): void;
};

/**
 * Opens one volatile Ask AI chat session against the browser Prompt API
 * (MIK-048). Throws {@link PromptApiUnavailableError} when the Prompt API
 * cannot run right now, so the Ask AI controller degrades to the per-turn
 * runner. Nothing about the session is persisted anywhere.
 */
export type AskAiPromptSessionFactory = (
	systemInstruction: string,
	language?: SupportedLanguage,
	observer?: PromptLifecycleObserver,
) => Promise<AskAiPromptSessionHandle>;

/**
 * Build an {@link AskAiPromptSessionFactory} backed by the browser Prompt API.
 * Unlike {@link createChromeAskAiRecommendationRunner} — which opens and
 * destroys a session per prompt — the created session stays open so follow-up
 * recommendation prompts share the model's conversational context; the caller
 * (the Ask AI controller) destroys it on clear-session.
 */
export function createChromeAskAiPromptSessionFactory(
	namespace: PromptModelNamespace | null = resolveNamespace(),
	options: { logger?: Logger } = {},
): AskAiPromptSessionFactory {
	const logger = options.logger ?? noopLogger;
	return async (systemInstruction, language = "ja", observer) => {
		if (!namespace) {
			throw new PromptApiUnavailableError();
		}
		await assertCanCreateSession(namespace, language, logger, "chat-session");
		const session = await createSession(
			namespace,
			{
				initialPrompts: [{ role: "system", content: systemInstruction }],
				expectedOutputs: expectedTextOutputs(language),
			},
			askAiLifecycleObserver(logger, language, "chat-session", observer),
		);
		return {
			async prompt(input) {
				try {
					return await session.prompt(input);
				} catch (error) {
					logger.log("warn", "ai.ask-ai.prompt-failed", {
						...errorLogFields(error),
						language,
						context: "chat-session",
					});
					throw error;
				}
			},
			destroy() {
				session.destroy?.();
			},
		};
	};
}
