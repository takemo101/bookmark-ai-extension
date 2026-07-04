/**
 * Pure local candidate scoring for the Ask AI saved-bookmark recommendation
 * flow (see docs/design.md and the MIK-042 plan).
 *
 * This is the deterministic retrieval step that runs before Prompt API
 * reranking. It scores every saved bookmark from short intentional fields only
 * — title, URL-derived domain, description, genre, tags — and never from
 * `analysisMarkdown`, raw excerpts, or full URL text. Records with non-ready
 * AI status stay eligible: their saved short fields are still useful.
 *
 * No Chrome, Drive, Prompt API, or UI imports belong here.
 */
import { recordDomain } from "./collection";
import type { AiStatus, BookmarkRecord } from "./record";
import { compareIsoTimestamp } from "./values";

/** Fields that participate in scoring, in reporting order (weight-descending). */
export const ASK_AI_MATCHED_FIELDS = [
	"title",
	"tags",
	"genre",
	"description",
	"domain",
] as const;
export type AskAiMatchedField = (typeof ASK_AI_MATCHED_FIELDS)[number];

const FIELD_WEIGHTS: Readonly<Record<AskAiMatchedField, number>> = {
	title: 5,
	tags: 4,
	genre: 3,
	description: 2,
	domain: 2,
};

/**
 * A candidate scoring at or above this is strong enough to recommend; below
 * it, the result becomes `weak-candidates` so the Ask AI use case can ask a
 * clarifying question instead. A single title/tags/genre token match clears
 * the bar; a lone description or domain match does not.
 */
const STRONG_SCORE_THRESHOLD = 3;

export const DEFAULT_ASK_AI_CANDIDATE_LIMIT = 50;
export const DEFAULT_ASK_AI_MIN_QUESTION_LENGTH = 2;

/**
 * Compact candidate: enough for a later Prompt API payload and for local
 * fallback cards, keyed back to the app-owned record by id/canonicalUrl.
 */
export type AskAiCandidate = {
	readonly id: string;
	readonly canonicalUrl: string;
	readonly title: string;
	readonly domain: string;
	readonly description?: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly aiStatus: AiStatus;
	readonly score: number;
	readonly matchedFields: readonly AskAiMatchedField[];
	readonly fallbackReason: string;
};

export type AskAiCandidateSearchOptions = {
	readonly limit?: number;
	readonly minQuestionLength?: number;
};

export type AskAiCandidateSearchResult =
	| { readonly kind: "too-short-question" }
	| { readonly kind: "empty-library" }
	| {
			readonly kind: "weak-candidates";
			readonly candidates: readonly AskAiCandidate[];
	  }
	| {
			readonly kind: "candidates";
			readonly candidates: readonly AskAiCandidate[];
	  };

/** Split a question into lowercase tokens on whitespace and punctuation. */
function tokenizeQuestion(question: string): string[] {
	return Array.from(
		new Set(
			question
				.toLowerCase()
				.split(/[\s、。，．・,.!?！？:;：；()（）"'「」『』]+/u)
				.filter((token) => token.length > 0),
		),
	);
}

type ScoredRecord = {
	readonly record: BookmarkRecord;
	readonly domain: string;
	readonly score: number;
	readonly matchedFields: readonly AskAiMatchedField[];
};

/**
 * Score one record against the question tokens. Each token adds the weight of
 * every field whose normalized text contains it, so records matching more
 * tokens (or matching in intentional metadata) rank higher.
 */
function scoreRecord(
	record: BookmarkRecord,
	domain: string,
	tokens: readonly string[],
): { score: number; matchedFields: AskAiMatchedField[] } {
	const fieldTexts: Readonly<Record<AskAiMatchedField, readonly string[]>> = {
		title: [record.title.toLowerCase()],
		tags: record.tags.map((t) => t.toLowerCase()),
		genre: record.genre === undefined ? [] : [record.genre.toLowerCase()],
		description:
			record.description === undefined
				? []
				: [record.description.toLowerCase()],
		domain: domain.length === 0 ? [] : [domain],
	};

	let score = 0;
	const matched = new Set<AskAiMatchedField>();
	for (const token of tokens) {
		for (const field of ASK_AI_MATCHED_FIELDS) {
			if (fieldTexts[field].some((text) => text.includes(token))) {
				score += FIELD_WEIGHTS[field];
				matched.add(field);
			}
		}
	}
	// Report in the canonical field order so reasons stay deterministic.
	const matchedFields = ASK_AI_MATCHED_FIELDS.filter((f) => matched.has(f));
	return { score, matchedFields };
}

/** Deterministic English reason from matched fields; localized later in UI. */
function fallbackReason(fields: readonly AskAiMatchedField[]): string {
	if (fields.length === 1) {
		return `Matched ${fields[0]}`;
	}
	if (fields.length === 2) {
		return `Matched ${fields[0]} and ${fields[1]}`;
	}
	return `Matched ${fields.slice(0, -1).join(", ")}, and ${
		fields[fields.length - 1]
	}`;
}

/** Score desc → most recently updated → created → canonical URL → id. */
function compareCandidates(a: ScoredRecord, b: ScoredRecord): number {
	if (a.score !== b.score) return b.score - a.score;
	const updated = compareIsoTimestamp(b.record.updatedAt, a.record.updatedAt);
	if (updated !== 0) return updated;
	const created = compareIsoTimestamp(b.record.createdAt, a.record.createdAt);
	if (created !== 0) return created;
	if (a.record.canonicalUrl !== b.record.canonicalUrl) {
		return a.record.canonicalUrl < b.record.canonicalUrl ? -1 : 1;
	}
	return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
}

function toCandidate(scored: ScoredRecord): AskAiCandidate {
	const { record } = scored;
	return {
		id: record.id,
		canonicalUrl: record.canonicalUrl,
		title: record.title,
		domain: scored.domain,
		description: record.description,
		genre: record.genre,
		tags: record.tags,
		aiStatus: record.aiStatus,
		score: scored.score,
		matchedFields: scored.matchedFields,
		fallbackReason: fallbackReason(scored.matchedFields),
	};
}

/**
 * Find up to `limit` (default 50) scored candidates for a natural-language
 * question. Returns `too-short-question` / `empty-library` before scoring,
 * `candidates` when at least one strong match exists, and `weak-candidates`
 * (possibly empty) otherwise so the caller can ask a clarifying follow-up.
 */
export function findAskAiCandidates(
	records: readonly BookmarkRecord[],
	question: string,
	options: AskAiCandidateSearchOptions = {},
): AskAiCandidateSearchResult {
	const minQuestionLength =
		options.minQuestionLength ?? DEFAULT_ASK_AI_MIN_QUESTION_LENGTH;
	const limit = Math.max(
		0,
		Math.floor(options.limit ?? DEFAULT_ASK_AI_CANDIDATE_LIMIT),
	);

	const trimmed = question.trim();
	if (trimmed.length < minQuestionLength) {
		return { kind: "too-short-question" };
	}
	if (records.length === 0) {
		return { kind: "empty-library" };
	}

	const tokens = tokenizeQuestion(trimmed);
	const scored: ScoredRecord[] = [];
	for (const record of records) {
		const domain = recordDomain(record) ?? "";
		const { score, matchedFields } = scoreRecord(record, domain, tokens);
		if (score > 0) {
			scored.push({ record, domain, score, matchedFields });
		}
	}

	scored.sort(compareCandidates);
	const candidates = scored.slice(0, limit).map(toCandidate);
	const hasStrongCandidate = candidates.some(
		(c) => c.score >= STRONG_SCORE_THRESHOLD,
	);
	return hasStrongCandidate
		? { kind: "candidates", candidates }
		: { kind: "weak-candidates", candidates };
}
