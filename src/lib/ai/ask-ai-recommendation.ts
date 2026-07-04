/**
 * Pure Prompt API boundary for the Ask AI saved-bookmark recommendation flow
 * (MIK-044; see docs/design.md and the MIK-042 plan).
 *
 * Two responsibilities, both pure — no Chrome, Prompt API, Drive, storage, or
 * React imports:
 *
 *   - {@link buildAskAiRecommendationPrompt} turns local `AskAiCandidate`s
 *     (MIK-043) plus the user question into a compact, data-minimized prompt.
 *     The candidate payload carries only `id` / `title` / `domain` / optional
 *     `genre` / capped `tags` / capped `description` — never full URLs,
 *     `canonicalUrl`, `analysisMarkdown`, raw excerpts, Drive metadata, or chat
 *     transcripts, because up to {@link MAX_ASK_AI_PROMPT_CANDIDATES}
 *     candidates ride along on every question.
 *   - {@link parseAskAiRecommendation} parses raw model output into app-owned
 *     candidate IDs and reasons, dropping hallucinated/unknown IDs and
 *     returning typed errors ("parse, don't validate", like ./parse.ts).
 *
 * `AskAiCandidate` is imported type-only so the ai module stays free of any
 * runtime bookmark-domain dependency. Runtime Prompt API wiring is a later
 * slice.
 */
import type { AskAiCandidate } from "../bookmarks/index";
import type { SupportedLanguage } from "../i18n/index";
import { extractJsonObject, isJsonObject } from "./json";
import { type Result, err, ok } from "./result";

/** Prompt payload caps: keep up to 50 candidates compact and data-minimized. */
export const MAX_ASK_AI_PROMPT_CANDIDATES = 50;
export const MAX_ASK_AI_CANDIDATE_TAGS = 5;
export const MAX_ASK_AI_CANDIDATE_TITLE_CHARS = 160;
export const MAX_ASK_AI_CANDIDATE_DESCRIPTION_CHARS = 240;

/** Parse caps: bound what model output can push into the UI. */
export const MAX_ASK_AI_RECOMMENDATIONS = 5;
export const MAX_ASK_AI_REASON_CHARS = 300;
export const MAX_ASK_AI_MESSAGE_CHARS = 600;

/**
 * The only candidate fields allowed to reach the Prompt API. Deliberately a
 * subset of `AskAiCandidate`: no `canonicalUrl`, score, matched fields, or
 * fallback reason.
 */
export type AskAiPromptCandidate = {
	readonly id: string;
	readonly title: string;
	readonly domain: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly description?: string;
};

export type AskAiRecommendationPromptInput = {
	readonly question: string;
	readonly language: SupportedLanguage;
	readonly candidates: readonly AskAiCandidate[];
};

export type AskAiRecommendationPrompt = {
	readonly systemInstruction: string;
	readonly prompt: string;
	readonly candidatePayload: readonly AskAiPromptCandidate[];
};

export type AskAiRecommendation = {
	readonly id: string;
	readonly reason: string;
};

/** Always-valid parsed recommendation output. Produced only by the parser. */
export type AskAiRecommendationOutput = {
	readonly message: string;
	readonly recommendations: readonly AskAiRecommendation[];
};

export type AskAiRecommendationParseErrorKind =
	| "empty-output"
	| "no-json"
	| "invalid-json"
	| "not-object"
	| "missing-field"
	| "invalid-field"
	| "no-valid-recommendations";

/** A recoverable failure to parse raw model output into recommendations. */
export type AskAiRecommendationParseError = {
	readonly kind: AskAiRecommendationParseErrorKind;
	readonly field?: string;
	readonly message: string;
};

function parseError(
	kind: AskAiRecommendationParseErrorKind,
	message: string,
	field?: string,
): AskAiRecommendationParseError {
	return field === undefined ? { kind, message } : { kind, field, message };
}

function truncate(text: string, maxChars: number): string {
	return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function toPromptCandidate(candidate: AskAiCandidate): AskAiPromptCandidate {
	const title = truncate(candidate.title, MAX_ASK_AI_CANDIDATE_TITLE_CHARS);
	const tags = candidate.tags.slice(0, MAX_ASK_AI_CANDIDATE_TAGS);
	const genre = candidate.genre?.trim();
	const description = candidate.description?.trim();
	return {
		id: candidate.id,
		title,
		domain: candidate.domain,
		...(genre !== undefined && genre.length > 0 ? { genre } : {}),
		tags,
		...(description !== undefined && description.length > 0
			? {
					description: truncate(
						description,
						MAX_ASK_AI_CANDIDATE_DESCRIPTION_CHARS,
					),
				}
			: {}),
	};
}

/** System instruction: role + UI-language, JSON-only output contract. */
function recommendationSystemInstruction(language: SupportedLanguage): string {
	if (language === "en") {
		return (
			"You are an assistant that recommends bookmarks the user has already saved, based on their question. " +
			"Always reply in English with a single JSON object, and output no text other than JSON."
		);
	}
	return (
		"あなたはユーザーが保存済みのブックマークの中から、質問に合うものを推薦するアシスタントです。" +
		"返答は必ず日本語の値を持つJSONオブジェクトのみで行い、JSON以外の文章は出力しないでください。"
	);
}

type RecommendationPromptLines = {
	head: string[];
	constraints: string[];
	questionLabel: string;
	candidatesLabel: string;
};

function englishRecommendationLines(): RecommendationPromptLines {
	return {
		head: [
			"From the saved bookmarks below, choose the ones that best answer the user's question.",
			"",
			"Output only a JSON object of the following shape, with no code fences or introductory text:",
			"{",
			'  "message": "a short English answer to the user",',
			'  "recommendations": [',
			'    { "id": "candidate id", "reason": "short English reason why this bookmark matches" }',
			"  ]",
			"}",
		],
		constraints: [
			"Non-negotiable constraints:",
			"- Output a JSON object only.",
			"- Write every value in English.",
			`- recommendations contains at most ${MAX_ASK_AI_RECOMMENDATIONS} items, best matches first.`,
			'- Every "id" must be copied exactly from the candidate list below; never invent ids.',
			"- Keep each reason short (1-2 sentences).",
			'- If no candidate fits the question, return an empty recommendations array and use "message" to ask a short clarifying question.',
		],
		questionLabel: "User question:",
		candidatesLabel: "Saved bookmark candidates (JSON):",
	};
}

function japaneseRecommendationLines(): RecommendationPromptLines {
	return {
		head: [
			"以下の保存済みブックマークの中から、ユーザーの質問に最も合うものを選んでください。",
			"",
			"出力は次の形のJSONオブジェクトのみとし、コードフェンスや前置きの文章は付けないでください:",
			"{",
			'  "message": "ユーザーへの短い日本語の回答",',
			'  "recommendations": [',
			'    { "id": "候補のid", "reason": "このブックマークが合う短い日本語の理由" }',
			"  ]",
			"}",
		],
		constraints: [
			"必須の制約:",
			"- 出力はJSONオブジェクトのみとする。",
			"- すべての値は日本語で記述する。",
			`- recommendations は最大${MAX_ASK_AI_RECOMMENDATIONS}件までとし、合うものから順に並べる。`,
			'- "id" は必ず下の候補リストからそのままコピーし、存在しないidを作らない。',
			"- reason は1〜2文の短い理由にする。",
			"- 合う候補がない場合は recommendations を空配列にし、message で短い確認の質問をする。",
		],
		questionLabel: "ユーザーの質問:",
		candidatesLabel: "保存済みブックマーク候補（JSON）:",
	};
}

/**
 * Build the recommendation prompt for one question. Candidates beyond
 * {@link MAX_ASK_AI_PROMPT_CANDIDATES} are dropped (the MIK-043 search already
 * orders them best-first), and each candidate is reduced to its compact
 * payload before being embedded as JSON.
 */
export function buildAskAiRecommendationPrompt(
	input: AskAiRecommendationPromptInput,
): AskAiRecommendationPrompt {
	const candidatePayload = input.candidates
		.slice(0, MAX_ASK_AI_PROMPT_CANDIDATES)
		.map(toPromptCandidate);
	const lines =
		input.language === "en"
			? englishRecommendationLines()
			: japaneseRecommendationLines();
	const prompt = [
		...lines.head,
		"",
		...lines.constraints,
		"",
		lines.questionLabel,
		input.question.trim(),
		"",
		lines.candidatesLabel,
		JSON.stringify(candidatePayload),
	].join("\n");
	return {
		systemInstruction: recommendationSystemInstruction(input.language),
		prompt,
		candidatePayload,
	};
}

/**
 * Normalize the raw `recommendations` array against the allowed candidate IDs.
 * Non-object entries, entries without a usable string id, unknown IDs, and
 * duplicates are dropped rather than rejected; reasons are trimmed and capped.
 * The surviving list is capped at {@link MAX_ASK_AI_RECOMMENDATIONS}.
 */
function normalizeRecommendations(
	value: readonly unknown[],
	allowedIds: ReadonlySet<string>,
): AskAiRecommendation[] {
	const seen = new Set<string>();
	const recommendations: AskAiRecommendation[] = [];
	for (const entry of value) {
		if (!isJsonObject(entry) || typeof entry.id !== "string") {
			continue;
		}
		const id = entry.id.trim();
		if (id.length === 0 || !allowedIds.has(id) || seen.has(id)) {
			continue;
		}
		if (typeof entry.reason !== "string") {
			continue;
		}
		const reason = truncate(entry.reason.trim(), MAX_ASK_AI_REASON_CHARS);
		if (reason.length === 0) {
			continue;
		}
		seen.add(id);
		recommendations.push({ id, reason });
		if (recommendations.length >= MAX_ASK_AI_RECOMMENDATIONS) {
			break;
		}
	}
	return recommendations;
}

/**
 * Parse raw model output into an {@link AskAiRecommendationOutput}, keeping
 * only recommendations whose id is in `allowedCandidateIds` (the IDs that were
 * actually sent in the prompt). Returns `no-valid-recommendations` when
 * nothing usable remains so the caller can fall back to local candidates.
 */
export function parseAskAiRecommendation(
	raw: unknown,
	allowedCandidateIds: readonly string[],
): Result<AskAiRecommendationOutput, AskAiRecommendationParseError> {
	if (typeof raw !== "string") {
		return err(parseError("invalid-field", "AI output must be a string"));
	}
	if (raw.trim().length === 0) {
		return err(parseError("empty-output", "AI output was empty"));
	}

	const jsonText = extractJsonObject(raw);
	if (jsonText === null) {
		return err(parseError("no-json", "no JSON object found in AI output"));
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(jsonText);
	} catch (error) {
		return err(
			parseError(
				"invalid-json",
				`AI output was not valid JSON: ${(error as Error).message}`,
			),
		);
	}

	if (!isJsonObject(decoded)) {
		return err(parseError("not-object", "AI output JSON was not an object"));
	}

	if (decoded.message === undefined) {
		return err(parseError("missing-field", "message is required", "message"));
	}
	if (typeof decoded.message !== "string") {
		return err(
			parseError("invalid-field", "message must be a string", "message"),
		);
	}
	const message = truncate(decoded.message.trim(), MAX_ASK_AI_MESSAGE_CHARS);

	if (decoded.recommendations === undefined) {
		return err(
			parseError(
				"missing-field",
				"recommendations is required",
				"recommendations",
			),
		);
	}
	if (!Array.isArray(decoded.recommendations)) {
		return err(
			parseError(
				"invalid-field",
				"recommendations must be an array",
				"recommendations",
			),
		);
	}

	const recommendations = normalizeRecommendations(
		decoded.recommendations,
		new Set(allowedCandidateIds),
	);
	if (recommendations.length === 0) {
		return err(
			parseError(
				"no-valid-recommendations",
				"no recommendations matched the provided candidate ids",
			),
		);
	}

	return ok({ message, recommendations });
}
