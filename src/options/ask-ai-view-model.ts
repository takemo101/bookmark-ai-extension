/**
 * The Ask AI screen controller (MIK-045 shell, MIK-046 integration, MIK-048
 * chat session): a framework-agnostic state machine holding the ephemeral chat
 * state the "Ask AI" / "AIに聞く" options screen renders. Chat state is
 * in-memory only — nothing here persists the transcript, the Prompt API
 * session, extracted keywords, or the narrowed candidate context (MIK-042
 * design: chat history is never persisted), so the whole conversation vanishes
 * with the page.
 *
 * MIK-048 turns the latest-result panel into a chat session:
 *
 *   - Every {@link AskAiController.submit} appends a user turn and then an
 *     assistant turn to the in-memory transcript ({@link AskAiView.messages}).
 *   - When {@link AskAiDeps.createRecommendationSession} is provided, ONE
 *     volatile Prompt API session (pinned to the recommendation system
 *     instruction) answers every recommendation prompt of the chat session, so
 *     the model keeps conversational context across turns. A failed creation
 *     degrades to the per-turn {@link AskAiDeps.runRecommendationPrompt}
 *     without retrying until the next chat session; a session that dies
 *     mid-chat is destroyed and dropped so the turn falls back to local cards.
 *   - Follow-up retrieval is HYBRID: a follow-up first tries to narrow within
 *     the previous turn's candidate set; when that narrowed match is weak or
 *     empty, a refinement-like question (`絞って`, "narrow those down", …,
 *     MIK-055) stays inside the previous recommendation/context candidates —
 *     preferring the cards actually shown last — and never broadens, while a
 *     new-topic question falls back to ALL cached bookmarks. A turn that
 *     finds nothing anywhere keeps the previous narrowed context.
 *   - {@link AskAiController.clearSession} is the explicit hard reset: it
 *     discards the transcript, the draft input, the narrowed candidate
 *     context, the previous recommendation context, and destroys the Prompt
 *     API session; any in-flight answer is silently dropped and the next
 *     submit starts a fresh session.
 *
 * The per-turn recommendation flow itself is unchanged from MIK-046/047:
 *
 *   deps.loadBookmarks() — ALL locally cached records, never a Drive pull and
 *     never the Library's filtered view
 *   → findAskAiCandidates (local deterministic scoring)
 *   → buildAskAiKeywordExtractionPrompt + deps.runKeywordExtractionPrompt
 *     (MIK-047) — question and language only, NEVER bookmark data — whose
 *     parsed keywords expand a second local scoring pass; any extraction
 *     failure keeps the direct scoring result
 *   → buildAskAiRecommendationPrompt + session prompt or one-shot runner
 *   → parseAskAiRecommendation, mapping ids back to app-owned candidates
 *   → up to {@link MAX_ASK_AI_RESULT_CARDS} recommendation cards.
 *
 * Safe statuses short-circuit before any Prompt API call: too-short questions
 * and an empty library render clarifying copy without touching extraction or
 * recommendation; weak/no candidates (after any keyword expansion) do the same.
 * Extracted keywords live only inside one `submit` call — never in state, never
 * persisted. A recommendation failure (Prompt API unavailable, parser failure,
 * or all-hallucinated ids) falls back to the local scored candidates with
 * their deterministic fallback reasons.
 *
 * Observable via `subscribe`/`getView` exactly like `OptionsController` and
 * `SkillsController`, so React binds it with `useSyncExternalStore`.
 */
import {
	type AskAiKeywordExtractionPrompt,
	type AskAiRecommendationPrompt,
	MAX_ASK_AI_RETRY_PROMPT_CANDIDATES,
	type PromptLifecycleEvent,
	type PromptLifecycleObserver,
	buildAskAiKeywordExtractionPrompt,
	buildAskAiRecommendationPrompt,
	parseAskAiKeywordExtraction,
	parseAskAiRecommendation,
} from "../lib/ai/index";
import {
	type AiStatus,
	type AskAiCandidate,
	type AskAiCandidateSearchOptions,
	type AskAiMatchedField,
	type BookmarkRecord,
	DEFAULT_ASK_AI_MIN_QUESTION_LENGTH,
	findAskAiCandidates,
} from "../lib/bookmarks/index";
import type { SupportedLanguage } from "../lib/i18n/index";
import { errorLogFields, noopLogger, type Logger } from "../lib/logging/index";

/** Cards shown per answer, AI-ranked or local fallback alike (MIK-042 plan). */
export const MAX_ASK_AI_RESULT_CARDS = 5;

/** One recommendation card: app-owned bookmark data plus a display reason. */
export type AskAiCardView = {
	readonly canonicalUrl: string;
	/**
	 * The original visited URL for the card favicon (MIK-053) — resolved by
	 * Chrome at render time exactly like Library rows (MIK-034), never stored.
	 */
	readonly url: string;
	readonly title: string;
	readonly domain: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly description?: string;
	readonly aiStatus: AiStatus;
	/** Model-written reason (`source: "ai"`) or deterministic local reason. */
	readonly reason: string;
};

/** One answer: recommendation cards or a safe status to phrase in UI. */
export type AskAiResultView =
	| { readonly kind: "too-short-question" }
	| { readonly kind: "empty-library" }
	| { readonly kind: "weak-candidates" }
	| { readonly kind: "error" }
	| {
			readonly kind: "recommendations";
			/** Whether the cards came from the AI ranker or the local fallback. */
			readonly source: "ai" | "local";
			/** The model's short answer message; absent on local fallback. */
			readonly message?: string;
			readonly cards: readonly AskAiCardView[];
	  };

/**
 * One turn of the in-memory Ask AI transcript (MIK-048): the user's submitted
 * question or the assistant's answer. Never persisted anywhere.
 */
export type AskAiChatMessage =
	| { readonly id: string; readonly role: "user"; readonly text: string }
	| {
			readonly id: string;
			readonly role: "assistant";
			readonly result: AskAiResultView;
	  };

/** The immutable snapshot the Ask AI screen renders. */
export type AskAiModelSetupView =
	| { readonly downloading: false }
	| { readonly downloading: true; readonly percent?: number };

export type AskAiView = {
	/** The draft question exactly as typed (trimming happens only for policy). */
	readonly question: string;
	/**
	 * Whether the question may be submitted: trimmed length meets the shared
	 * Ask AI minimum (the local candidate scorer's policy) and no answer is in
	 * flight.
	 */
	readonly canSubmit: boolean;
	/** An answer is in flight (non-streaming). */
	readonly answering: boolean;
	/** The chat transcript, oldest first. Empty before the first submit. */
	readonly messages: readonly AskAiChatMessage[];
	/** Transient local-model setup/download state. Never persisted. */
	readonly modelSetup?: AskAiModelSetupView;
	/** Whether clear-session has anything to discard. */
	readonly canClear: boolean;
};

/**
 * A volatile Prompt API session owned by one Ask AI chat session (MIK-048).
 * Created lazily on the first recommendation prompt, reused across turns, and
 * destroyed on clear. Never persisted; no session id ever leaves memory.
 */
export type AskAiPromptSession = {
	prompt(input: string): Promise<string>;
	destroy(): void;
};

/**
 * The only surface the Ask AI controller touches. No Drive sync, no storage
 * writes, no transcript persistence — a cache-snapshot read and prompt runs.
 */
export type AskAiDeps = {
	/** Snapshot of ALL locally cached bookmark records. Must not touch Drive. */
	loadBookmarks(): Promise<readonly BookmarkRecord[]>;
	/**
	 * Run the keyword-extraction prompt (built from the question and language
	 * only, MIK-047) through the Prompt API and return the raw model text.
	 * Throws when the Prompt API is unavailable or fails; the controller then
	 * scores the original question directly.
	 */
	runKeywordExtractionPrompt(
		request: AskAiKeywordExtractionPrompt,
		observer?: PromptLifecycleObserver,
	): Promise<string>;
	/**
	 * Run the compact recommendation prompt through the Prompt API and return
	 * the raw model text. Throws when the Prompt API is unavailable or fails;
	 * the controller then falls back to local candidate cards. Used per turn
	 * whenever no chat session is available (MIK-048 degradation path).
	 */
	runRecommendationPrompt(
		request: AskAiRecommendationPrompt,
		observer?: PromptLifecycleObserver,
	): Promise<string>;
	/**
	 * Optional (MIK-048): open a volatile Prompt API session pinned to the
	 * given recommendation system instruction, kept for the lifetime of one Ask
	 * AI chat session. Throws when the Prompt API cannot hold a session right
	 * now; the controller then degrades to {@link runRecommendationPrompt}
	 * without retrying until the next chat session.
	 */
	createRecommendationSession?(
		systemInstruction: string,
		observer?: PromptLifecycleObserver,
	): Promise<AskAiPromptSession>;
	/** Structured diagnostic logging. Must not receive raw question/bookmark/page text. */
	logger?: Logger;
	/** The UI/output language for the recommendation prompt (MIK-029). */
	language: SupportedLanguage;
};

export interface AskAiController {
	getView(): AskAiView;
	subscribe(listener: () => void): () => void;
	setQuestion(value: string): void;
	/** Fill the input from a clicked example prompt. */
	useExample(example: string): void;
	/** Answer the current question. Drops calls while an answer is in flight. */
	submit(): Promise<void>;
	/**
	 * Hard reset (MIK-048): discard the transcript, draft input, narrowed
	 * candidate context, and destroy the Prompt API session. An in-flight
	 * answer is silently dropped; the next submit starts a fresh session.
	 */
	clearSession(): void;
}

/** The key shape the composer needs to decide Enter-to-send (MIK-048). */
export type AskAiComposerKeyEvent = {
	readonly key: string;
	readonly shiftKey: boolean;
	/** True while an IME composition is in progress; Enter then never sends. */
	readonly isComposing?: boolean;
};

/** Enter sends, Shift+Enter inserts a newline, IME composition never sends. */
export function isAskAiComposerSubmitKey(
	event: AskAiComposerKeyEvent,
): boolean {
	return event.key === "Enter" && !event.shiftKey && event.isComposing !== true;
}

/**
 * Refinement hints (MIK-055): substrings marking a follow-up that refers back
 * to the previous suggestions ("narrow those down", `絞って`) rather than
 * opening a new topic. Japanese hints match as plain substrings; English hints
 * only at word boundaries so e.g. "whose" never reads as "those". Deliberately
 * a local heuristic — no extra AI call, nothing persisted.
 */
const JAPANESE_REFINEMENT_HINTS: readonly string[] = [
	"絞",
	"その中",
	"この中",
	"上記",
	"さっき",
	"もう少し",
	"具体",
];
const ENGLISH_REFINEMENT_HINTS =
	/\b(?:narrow|refine|from those|among them|these|those|previous|more specific)\b/;

/** Whether a question reads as a refinement of the previous answer (MIK-055). */
function isRefinementFollowUp(question: string): boolean {
	const lowered = question.toLowerCase();
	return (
		JAPANESE_REFINEMENT_HINTS.some((hint) => lowered.includes(hint)) ||
		ENGLISH_REFINEMENT_HINTS.test(lowered)
	);
}

function toCard(candidate: AskAiCandidate, reason: string): AskAiCardView {
	return {
		canonicalUrl: candidate.canonicalUrl,
		url: candidate.url,
		title: candidate.title,
		domain: candidate.domain,
		genre: candidate.genre,
		tags: candidate.tags,
		description: candidate.description,
		aiStatus: candidate.aiStatus,
		reason,
	};
}

const JAPANESE_FALLBACK_FIELD_LABELS: Readonly<
	Record<AskAiMatchedField, string>
> = {
	title: "タイトル",
	tags: "タグ",
	genre: "ジャンル",
	description: "説明",
	domain: "ドメイン",
};

function isQuotaExceededError(error: unknown): boolean {
	return errorLogFields(error).errorName === "QuotaExceededError";
}

function localizedFallbackReason(
	candidate: AskAiCandidate,
	language: SupportedLanguage,
): string {
	if (language === "en") {
		return candidate.fallbackReason;
	}
	const fields = candidate.matchedFields.map(
		(field) => JAPANESE_FALLBACK_FIELD_LABELS[field],
	);
	if (fields.length === 0) {
		return "保存済みブックマークの情報に一致しました";
	}
	return `${fields.join("、")}に一致しました`;
}

/** The deterministic local-fallback answer from the scored candidates. */
function localFallback(
	candidates: readonly AskAiCandidate[],
	language: SupportedLanguage,
): AskAiResultView {
	return {
		kind: "recommendations",
		source: "local",
		cards: candidates
			.slice(0, MAX_ASK_AI_RESULT_CARDS)
			.map((candidate) =>
				toCard(candidate, localizedFallbackReason(candidate, language)),
			),
	};
}

export function createAskAiController(deps: AskAiDeps): AskAiController {
	const logger = deps.logger ?? noopLogger;
	let question = "";
	let answering = false;
	let messages: readonly AskAiChatMessage[] = [];
	let nextMessageId = 0;

	// MIK-048 chat-session state, all memory-only. `generation` fences stale
	// in-flight answers out of a cleared session.
	let session: AskAiPromptSession | null = null;
	let sessionUnavailable = false;
	let modelSetup: AskAiModelSetupView | undefined;
	let narrowedIds: ReadonlySet<string> | null = null;
	// MIK-055: the previous recommendation context — the candidates behind the
	// cards actually shown last (or the whole turn's candidate set when no card
	// maps back). A refinement-like follow-up refines these instead of
	// broadening to all bookmarks. Memory-only and generation-fenced.
	let previousContextCandidates: readonly AskAiCandidate[] = [];
	let generation = 0;

	const listeners = new Set<() => void>();

	function render(): AskAiView {
		return {
			question,
			canSubmit:
				!answering &&
				question.trim().length >= DEFAULT_ASK_AI_MIN_QUESTION_LENGTH,
			answering,
			messages,
			modelSetup,
			canClear: messages.length > 0 || question.length > 0 || answering,
		};
	}

	let view = render();

	function notify(): void {
		view = render();
		for (const listener of listeners) {
			listener();
		}
	}

	function appendMessage(
		message:
			| { role: "user"; text: string }
			| { role: "assistant"; result: AskAiResultView },
	): void {
		nextMessageId += 1;
		messages = [...messages, { id: `msg-${nextMessageId}`, ...message }];
	}

	function updateModelSetup(event: PromptLifecycleEvent): void {
		if (event.kind === "download-required") {
			modelSetup = { downloading: false };
		} else if (event.kind === "download-progress") {
			const percent =
				event.ratio !== undefined && event.ratio > 0
					? Math.round(event.ratio * 100)
					: undefined;
			modelSetup =
				percent !== undefined
					? { downloading: true, percent }
					: { downloading: true };
		} else {
			modelSetup = undefined;
		}
		notify();
	}

	function destroySession(): void {
		const active = session;
		session = null;
		if (active) {
			try {
				active.destroy();
			} catch {
				// A throwing destroy must not break the reset; the session object
				// is dropped either way.
			}
		}
	}

	/**
	 * Get the raw recommendation text for the turn started at
	 * `startedGeneration`: through the one Prompt API session per chat session
	 * when available (created lazily and reused, MIK-048), else through the
	 * per-turn runner. A stale turn (cleared mid-flight) must leave the next
	 * chat's session state untouched: it never opens, installs, or uses the
	 * shared session and never flips `sessionUnavailable`. A session that fails
	 * mid-prompt is destroyed and dropped, and the failure propagates so this
	 * turn falls back to local cards; the next turn may open a fresh session.
	 */
	async function runRecommendation(
		request: AskAiRecommendationPrompt,
		startedGeneration: number,
	): Promise<string> {
		if (
			!session &&
			deps.createRecommendationSession &&
			!sessionUnavailable &&
			startedGeneration === generation
		) {
			try {
				const created = await deps.createRecommendationSession(
					request.systemInstruction,
					updateModelSetup,
				);
				if (startedGeneration === generation) {
					session = created;
				} else {
					// The chat was cleared while the session was opening: it belongs
					// to no conversation, so it is destroyed immediately.
					try {
						created.destroy();
					} catch {
						// Dropped regardless.
					}
				}
			} catch (error) {
				// Only the chat that saw the failure degrades to the per-turn
				// runner; a cleared chat's failure must not poison the next one.
				if (startedGeneration === generation) {
					sessionUnavailable = true;
					logger.log(
						"warn",
						"ask-ai.session.create-failed",
						errorLogFields(error),
					);
				}
			}
		}
		if (startedGeneration !== generation) {
			// The chat was cleared while this turn was in flight: its result is
			// discarded by `submit`, so no Prompt API call is spent on it and the
			// next chat's session is never touched. The empty text fails parsing
			// and resolves to a (discarded) local fallback.
			return "";
		}
		const active = session;
		if (active) {
			try {
				return await active.prompt(request.prompt);
			} catch (error) {
				logger.log("warn", "ask-ai.session.prompt-failed", {
					...errorLogFields(error),
					promptLength: request.prompt.length,
				});
				if (session === active) {
					destroySession();
				}
				throw error;
			}
		}
		return deps.runRecommendationPrompt(request, updateModelSetup);
	}

	/**
	 * AI reranking over the strong local candidates. Any failure — session or
	 * runner throw (Prompt API unavailable), unparseable output, or no
	 * surviving valid ids — degrades to the local fallback cards rather than an
	 * error.
	 */
	async function recommend(
		asked: string,
		candidates: readonly AskAiCandidate[],
		startedGeneration: number,
	): Promise<AskAiResultView> {
		let request = buildAskAiRecommendationPrompt({
			question: asked,
			language: deps.language,
			candidates,
		});
		let raw: string;
		try {
			raw = await runRecommendation(request, startedGeneration);
		} catch (error) {
			if (
				isQuotaExceededError(error) &&
				request.candidatePayload.length > MAX_ASK_AI_RETRY_PROMPT_CANDIDATES
			) {
				const retryRequest = buildAskAiRecommendationPrompt({
					question: asked,
					language: deps.language,
					candidates,
					maxCandidates: MAX_ASK_AI_RETRY_PROMPT_CANDIDATES,
				});
				logger.log("warn", "ask-ai.recommendation.quota-retry", {
					...errorLogFields(error),
					candidateCount: candidates.length,
					promptCandidateCount: request.candidatePayload.length,
					promptLength: request.prompt.length,
					retryCandidateLimit: MAX_ASK_AI_RETRY_PROMPT_CANDIDATES,
					retryPromptCandidateCount: retryRequest.candidatePayload.length,
					retryPromptLength: retryRequest.prompt.length,
				});
				try {
					raw = await runRecommendation(retryRequest, startedGeneration);
					request = retryRequest;
				} catch (retryError) {
					logger.log("warn", "ask-ai.recommendation.runner-failed", {
						...errorLogFields(retryError),
						candidateCount: candidates.length,
						promptCandidateCount: retryRequest.candidatePayload.length,
						promptLength: retryRequest.prompt.length,
					});
					return localFallback(candidates, deps.language);
				}
			} else {
				logger.log("warn", "ask-ai.recommendation.runner-failed", {
					...errorLogFields(error),
					candidateCount: candidates.length,
					promptCandidateCount: request.candidatePayload.length,
					promptLength: request.prompt.length,
				});
				return localFallback(candidates, deps.language);
			}
		}
		if (startedGeneration !== generation) {
			return localFallback(candidates, deps.language);
		}
		const parsed = parseAskAiRecommendation(
			raw,
			request.candidatePayload.map((candidate) => candidate.id),
		);
		if (!parsed.ok) {
			logger.log("warn", "ask-ai.recommendation.parse-failed", {
				kind: parsed.error.kind,
				candidateCount: candidates.length,
				promptCandidateCount: request.candidatePayload.length,
				promptLength: request.prompt.length,
				rawLength: raw.length,
			});
			return localFallback(candidates, deps.language);
		}
		try {
			// The parser only keeps ids that were sent, so every id resolves here.
			const byId = new Map(
				candidates.map((candidate) => [candidate.id, candidate]),
			);
			const cards: AskAiCardView[] = [];
			for (const recommendation of parsed.value.recommendations) {
				const candidate = byId.get(recommendation.id);
				if (candidate) {
					cards.push(toCard(candidate, recommendation.reason));
				}
			}
			if (cards.length === 0) {
				return localFallback(candidates, deps.language);
			}
			return {
				kind: "recommendations",
				source: "ai",
				message: parsed.value.message,
				cards,
			};
		} catch (error) {
			logger.log("warn", "ask-ai.recommendation.mapping-failed", {
				...errorLogFields(error),
				candidateCount: candidates.length,
				promptCandidateCount: request.candidatePayload.length,
			});
			return localFallback(candidates, deps.language);
		}
	}

	/**
	 * Extract ephemeral search keywords from the question alone (MIK-047). Any
	 * failure — runner throw (Prompt API unavailable), unparseable/malformed
	 * output, or no usable keywords — yields an empty list so the caller keeps
	 * the direct question scoring result.
	 */
	async function extractKeywords(asked: string): Promise<readonly string[]> {
		const request = buildAskAiKeywordExtractionPrompt({
			question: asked,
			language: deps.language,
		});
		try {
			const raw = await deps.runKeywordExtractionPrompt(
				request,
				updateModelSetup,
			);
			const parsed = parseAskAiKeywordExtraction(raw);
			if (!parsed.ok) {
				logger.log("warn", "ask-ai.keyword-extraction.parse-failed", {
					kind: parsed.error.kind,
					promptLength: request.prompt.length,
					rawLength: raw.length,
				});
				return [];
			}
			return parsed.value.keywords;
		} catch (error) {
			logger.log("warn", "ask-ai.keyword-extraction.runner-failed", {
				...errorLogFields(error),
				promptLength: request.prompt.length,
			});
			return [];
		}
	}

	async function answer(
		asked: string,
		startedGeneration: number,
	): Promise<AskAiResultView> {
		let records: readonly BookmarkRecord[];
		try {
			records = await deps.loadBookmarks();
		} catch {
			return { kind: "error" };
		}
		if (startedGeneration !== generation) {
			// Cleared while loading: bail before touching any chat-session state.
			// The placeholder result is discarded by `submit`.
			return { kind: "error" };
		}
		const direct = findAskAiCandidates(records, asked);
		if (
			direct.kind === "too-short-question" ||
			direct.kind === "empty-library"
		) {
			// Policy short-circuits: no Prompt API call of any kind.
			return { kind: direct.kind };
		}
		// Keyword expansion only ever adds query tokens, so it can rescue a weak
		// direct match but never demote a strong one.
		const keywords = await extractKeywords(asked);
		if (startedGeneration !== generation) {
			// Cleared while extracting: same discarded bail-out as above.
			return { kind: "error" };
		}
		const options: AskAiCandidateSearchOptions =
			keywords.length > 0 ? { expandedTerms: keywords } : {};

		// Hybrid follow-up retrieval (MIK-048): a follow-up first narrows within
		// the previous turn's candidate set; a weak or empty narrowed match
		// stays inside the previous recommendation context when the question is
		// refinement-like (MIK-055) and falls back to all cached bookmarks below
		// for new topics.
		let search: {
			readonly kind: "candidates";
			readonly candidates: readonly AskAiCandidate[];
		} | null = null;
		// The previous candidates re-scored against this question — kept as the
		// refinement context of last resort when no shown card resolves.
		let narrowedWeak: readonly AskAiCandidate[] = [];
		if (narrowedIds !== null) {
			const previousRecords = records.filter((record) =>
				narrowedIds?.has(record.id),
			);
			if (previousRecords.length > 0) {
				const narrowed = findAskAiCandidates(previousRecords, asked, options);
				if (narrowed.kind === "candidates") {
					search = narrowed;
				} else if (narrowed.kind === "weak-candidates") {
					narrowedWeak = narrowed.candidates;
				}
			}
		}
		if (
			search === null &&
			(previousContextCandidates.length > 0 || narrowedIds !== null) &&
			isRefinementFollowUp(asked)
		) {
			// A refinement of the previous answer must not broaden to all
			// bookmarks (MIK-055): refine the cards shown last — dropping any
			// bookmark that has since left the cache — else the previous
			// candidates re-scored above.
			const recordIds = new Set<string>(records.map((record) => record.id));
			const shownStillCached = previousContextCandidates.filter((candidate) =>
				recordIds.has(candidate.id),
			);
			const refinement =
				shownStillCached.length > 0 ? shownStillCached : narrowedWeak;
			if (refinement.length === 0) {
				// Nothing left to refine: clarify, keeping the previous context.
				return { kind: "weak-candidates" };
			}
			search = { kind: "candidates", candidates: refinement };
		}
		if (search === null) {
			const broad =
				keywords.length > 0
					? findAskAiCandidates(records, asked, options)
					: direct;
			if (broad.kind !== "candidates") {
				// Weak or no matches even after expansion, narrowed or broad: ask a
				// clarifying follow-up, never the recommendation AI. The previous
				// narrowed context survives an unanswerable turn.
				return { kind: "weak-candidates" };
			}
			search = broad;
		}
		// This turn's candidate set becomes the next follow-up's narrowing scope —
		// unless the turn went stale, in which case the fresh chat keeps its own.
		if (startedGeneration === generation) {
			narrowedIds = new Set(search.candidates.map((candidate) => candidate.id));
		}
		const result = await recommend(asked, search.candidates, startedGeneration);
		if (startedGeneration === generation && result.kind === "recommendations") {
			// The cards shown become the next refinement's context (MIK-055),
			// mapped back to their source candidates; when none resolves the
			// turn's whole candidate set stands in.
			const byCanonicalUrl = new Map(
				search.candidates.map((candidate) => [
					candidate.canonicalUrl,
					candidate,
				]),
			);
			const shown = result.cards
				.map((card) => byCanonicalUrl.get(card.canonicalUrl))
				.filter((candidate): candidate is AskAiCandidate => Boolean(candidate));
			previousContextCandidates = shown.length > 0 ? shown : search.candidates;
		}
		return result;
	}

	return {
		getView() {
			return view;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setQuestion(value) {
			question = value;
			notify();
		},
		useExample(example) {
			question = example;
			notify();
		},
		async submit() {
			if (answering) {
				return;
			}
			const asked = question.trim();
			const startedGeneration = generation;
			answering = true;
			appendMessage({ role: "user", text: asked });
			question = "";
			notify();
			try {
				let result: AskAiResultView;
				try {
					result = await answer(asked, startedGeneration);
				} catch {
					// Defensive: `answer` handles expected failures itself, but an
					// unexpected throw must still land as a safe error turn.
					result = { kind: "error" };
				}
				if (startedGeneration !== generation) {
					// The chat was cleared mid-turn: the stale answer never lands.
					return;
				}
				appendMessage({ role: "assistant", result });
			} finally {
				// Never leave the composer stuck answering — but only for the chat
				// this turn belongs to; a cleared chat was already reset.
				if (startedGeneration === generation) {
					answering = false;
					modelSetup = undefined;
					notify();
				}
			}
		},
		clearSession() {
			generation += 1;
			messages = [];
			question = "";
			answering = false;
			modelSetup = undefined;
			narrowedIds = null;
			previousContextCandidates = [];
			sessionUnavailable = false;
			destroySession();
			notify();
		},
	};
}
