/**
 * The Ask AI screen controller (MIK-045 shell, MIK-046 integration): a
 * framework-agnostic state machine holding the ephemeral chat state the
 * "Ask AI" / "AIに聞く" options screen renders. Chat state is in-memory only —
 * nothing here persists a transcript (MIK-042 design: chat history is never
 * persisted), so the whole conversation vanishes with the page.
 *
 * {@link AskAiController.submit} runs the recommendation flow over injected
 * dependencies (testable with fakes, wired to the real cache/Prompt API in
 * `./runtime`):
 *
 *   deps.loadBookmarks() — ALL locally cached records, never a Drive pull and
 *     never the Library's filtered view
 *   → findAskAiCandidates (local deterministic scoring)
 *   → buildAskAiKeywordExtractionPrompt + deps.runKeywordExtractionPrompt
 *     (MIK-047) — question and language only, NEVER bookmark data — whose
 *     parsed keywords expand a second local scoring pass; any extraction
 *     failure keeps the direct scoring result
 *   → buildAskAiRecommendationPrompt + deps.runRecommendationPrompt
 *   → parseAskAiRecommendation, mapping ids back to app-owned candidates
 *   → up to {@link MAX_ASK_AI_RESULT_CARDS} recommendation cards.
 *
 * Safe statuses short-circuit before any Prompt API call: too-short questions
 * and an empty library render clarifying copy without touching extraction or
 * recommendation; weak/no candidates (after any keyword expansion) do the same.
 * Extracted keywords live only inside one `submit` call — never in state, never
 * persisted. A recommendation runner throw (Prompt API unavailable), parser
 * failure, or all-hallucinated ids falls back to the local scored candidates
 * with their deterministic fallback reasons.
 *
 * Observable via `subscribe`/`getView` exactly like `OptionsController` and
 * `SkillsController`, so React binds it with `useSyncExternalStore`.
 */
import {
	type AskAiKeywordExtractionPrompt,
	type AskAiRecommendationPrompt,
	buildAskAiKeywordExtractionPrompt,
	buildAskAiRecommendationPrompt,
	parseAskAiKeywordExtraction,
	parseAskAiRecommendation,
} from "../lib/ai/index";
import {
	type AiStatus,
	type AskAiCandidate,
	type AskAiMatchedField,
	type BookmarkRecord,
	DEFAULT_ASK_AI_MIN_QUESTION_LENGTH,
	findAskAiCandidates,
} from "../lib/bookmarks/index";
import type { SupportedLanguage } from "../lib/i18n/index";

/** Cards shown per answer, AI-ranked or local fallback alike (MIK-042 plan). */
export const MAX_ASK_AI_RESULT_CARDS = 5;

/** One recommendation card: app-owned bookmark data plus a display reason. */
export type AskAiCardView = {
	readonly canonicalUrl: string;
	readonly title: string;
	readonly domain: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly description?: string;
	readonly aiStatus: AiStatus;
	/** Model-written reason (`source: "ai"`) or deterministic local reason. */
	readonly reason: string;
};

/** The latest answer: recommendation cards or a safe status to phrase in UI. */
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

/** The immutable snapshot the Ask AI screen renders. */
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
	/** The trimmed question the latest result answered; undefined before any. */
	readonly askedQuestion?: string;
	/** The latest answer; undefined until the first submit resolves. */
	readonly result?: AskAiResultView;
};

/**
 * The only surface the Ask AI controller touches. No Drive sync, no storage
 * writes, no transcript persistence — a cache-snapshot read and one prompt run.
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
	): Promise<string>;
	/**
	 * Run the compact recommendation prompt through the Prompt API and return
	 * the raw model text. Throws when the Prompt API is unavailable or fails;
	 * the controller then falls back to local candidate cards.
	 */
	runRecommendationPrompt(request: AskAiRecommendationPrompt): Promise<string>;
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
}

function toCard(candidate: AskAiCandidate, reason: string): AskAiCardView {
	return {
		canonicalUrl: candidate.canonicalUrl,
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
	let question = "";
	let answering = false;
	let askedQuestion: string | undefined;
	let result: AskAiResultView | undefined;

	const listeners = new Set<() => void>();

	function render(): AskAiView {
		return {
			question,
			canSubmit:
				!answering &&
				question.trim().length >= DEFAULT_ASK_AI_MIN_QUESTION_LENGTH,
			answering,
			askedQuestion,
			result,
		};
	}

	let view = render();

	function notify(): void {
		view = render();
		for (const listener of listeners) {
			listener();
		}
	}

	/**
	 * AI reranking over the strong local candidates. Any failure — runner throw
	 * (Prompt API unavailable), unparseable output, or no surviving valid ids —
	 * degrades to the local fallback cards rather than an error.
	 */
	async function recommend(
		asked: string,
		candidates: readonly AskAiCandidate[],
	): Promise<AskAiResultView> {
		try {
			const request = buildAskAiRecommendationPrompt({
				question: asked,
				language: deps.language,
				candidates,
			});
			const raw = await deps.runRecommendationPrompt(request);
			const parsed = parseAskAiRecommendation(
				raw,
				request.candidatePayload.map((candidate) => candidate.id),
			);
			if (!parsed.ok) {
				return localFallback(candidates, deps.language);
			}
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
		} catch {
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
		try {
			const request = buildAskAiKeywordExtractionPrompt({
				question: asked,
				language: deps.language,
			});
			const raw = await deps.runKeywordExtractionPrompt(request);
			const parsed = parseAskAiKeywordExtraction(raw);
			return parsed.ok ? parsed.value.keywords : [];
		} catch {
			return [];
		}
	}

	async function answer(asked: string): Promise<AskAiResultView> {
		let records: readonly BookmarkRecord[];
		try {
			records = await deps.loadBookmarks();
		} catch {
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
		const search =
			keywords.length > 0
				? findAskAiCandidates(records, asked, { expandedTerms: keywords })
				: direct;
		if (search.kind !== "candidates") {
			// Weak or no matches even after expansion: ask a clarifying follow-up,
			// never the recommendation AI.
			return { kind: "weak-candidates" };
		}
		return recommend(asked, search.candidates);
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
			answering = true;
			notify();
			try {
				askedQuestion = asked;
				result = await answer(asked);
			} finally {
				answering = false;
				notify();
			}
		},
	};
}
