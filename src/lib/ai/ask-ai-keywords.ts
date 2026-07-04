/**
 * Pure Prompt API boundary for Ask AI keyword extraction (MIK-047; see
 * docs/design.md and the MIK-047 plan).
 *
 * Natural-language questions like 「前に読んだ、テスト設計で参考になりそうなやつ」
 * tokenize into clause-length tokens that direct substring matching over saved
 * bookmark fields rarely hits. Before the local candidate scoring (MIK-043)
 * runs, the controller may ask the model for a handful of short search
 * keywords/related terms and feed them into scoring as extra query terms.
 *
 * Two responsibilities, both pure — no Chrome, Prompt API, Drive, storage, or
 * React imports:
 *
 *   - {@link buildAskAiKeywordExtractionPrompt} builds the extraction prompt
 *     from the user question and UI language ONLY. Bookmark records, URLs, raw
 *     excerpts, `analysisMarkdown`, Drive metadata, and chat history must never
 *     reach this prompt — it has no inputs that could carry them.
 *   - {@link parseAskAiKeywordExtraction} parses raw model output into a
 *     trimmed, case-insensitively deduped keyword list capped at
 *     {@link MAX_ASK_AI_KEYWORDS} terms of at most
 *     {@link MAX_ASK_AI_KEYWORD_CHARS} characters, or a typed error so the
 *     caller falls back to direct question scoring ("parse, don't validate").
 *
 * Extracted keywords are ephemeral retrieval helpers: callers keep them
 * in-memory for one question and never persist them.
 */
import type { SupportedLanguage } from "../i18n/index";
import { extractJsonObject, isJsonObject } from "./json";
import { type Result, err, ok } from "./result";

/** Output caps: bound what model output can push into local scoring. */
export const MAX_ASK_AI_KEYWORDS = 8;
export const MAX_ASK_AI_KEYWORD_CHARS = 40;
export const MAX_ASK_AI_INTENT_CHARS = 200;

export type AskAiKeywordExtractionPromptInput = {
	readonly question: string;
	readonly language: SupportedLanguage;
};

/**
 * Structurally an `AskAiPromptRequest`, so the same Prompt API runner that
 * executes recommendation prompts can execute extraction prompts.
 */
export type AskAiKeywordExtractionPrompt = {
	readonly systemInstruction: string;
	readonly prompt: string;
};

/** Always-valid parsed extraction output. Produced only by the parser. */
export type AskAiKeywordExtractionOutput = {
	readonly keywords: readonly string[];
	/** Optional short restatement of the question; debugging aid, never stored. */
	readonly intent?: string;
};

export type AskAiKeywordExtractionParseErrorKind =
	| "empty-output"
	| "no-json"
	| "invalid-json"
	| "not-object"
	| "missing-field"
	| "invalid-field"
	| "no-valid-keywords";

/** A recoverable failure to parse raw model output into keywords. */
export type AskAiKeywordExtractionParseError = {
	readonly kind: AskAiKeywordExtractionParseErrorKind;
	readonly field?: string;
	readonly message: string;
};

function parseError(
	kind: AskAiKeywordExtractionParseErrorKind,
	message: string,
	field?: string,
): AskAiKeywordExtractionParseError {
	return field === undefined ? { kind, message } : { kind, field, message };
}

/** System instruction: role + UI-language, JSON-only output contract. */
function extractionSystemInstruction(language: SupportedLanguage): string {
	if (language === "en") {
		return (
			"You are an assistant that extracts short search keywords from a user's question about their saved bookmarks. " +
			"Always reply with a single JSON object, and output no text other than JSON."
		);
	}
	return (
		"あなたはユーザーの質問から、保存済みブックマークを検索するための短いキーワードを抽出するアシスタントです。" +
		"返答は必ずJSONオブジェクトのみで行い、JSON以外の文章は出力しないでください。"
	);
}

function englishExtractionLines(): string[] {
	return [
		"Extract short search keywords from the user's question below.",
		"",
		"Output only a JSON object of the following shape, with no code fences or introductory text:",
		"{",
		'  "keywords": ["keyword", "..."],',
		'  "intent": "a one-sentence restatement of what the user is looking for"',
		"}",
		"",
		"Non-negotiable constraints:",
		"- Output a JSON object only.",
		`- keywords contains at most ${MAX_ASK_AI_KEYWORDS} items, most important first.`,
		`- Each keyword is a short word or phrase of at most ${MAX_ASK_AI_KEYWORD_CHARS} characters.`,
		"- Prefer concrete topic words from the question; add closely related terms or synonyms (including Japanese/English variants) when they help search.",
		"- Never invent topics the question does not imply.",
		"",
		"User question:",
	];
}

function japaneseExtractionLines(): string[] {
	return [
		"以下のユーザーの質問から、検索に使う短いキーワードを抽出してください。",
		"",
		"出力は次の形のJSONオブジェクトのみとし、コードフェンスや前置きの文章は付けないでください:",
		"{",
		'  "keywords": ["キーワード", "..."],',
		'  "intent": "ユーザーが探しているものの短い言い換え"',
		"}",
		"",
		"必須の制約:",
		"- 出力はJSONオブジェクトのみとする。",
		`- keywords は最大${MAX_ASK_AI_KEYWORDS}件までとし、重要なものから順に並べる。`,
		`- 各キーワードは${MAX_ASK_AI_KEYWORD_CHARS}文字以内の短い単語または語句にする。`,
		"- 質問に含まれる具体的な話題の語を優先し、検索に役立つ場合は関連語・類義語（日本語/英語の言い換えを含む）を加える。",
		"- 質問から読み取れない話題を作らない。",
		"",
		"ユーザーの質問:",
	];
}

/**
 * Build the keyword-extraction prompt for one question. The question and UI
 * language are the only inputs by design — the privacy contract lives in this
 * signature.
 */
export function buildAskAiKeywordExtractionPrompt(
	input: AskAiKeywordExtractionPromptInput,
): AskAiKeywordExtractionPrompt {
	const lines =
		input.language === "en"
			? englishExtractionLines()
			: japaneseExtractionLines();
	return {
		systemInstruction: extractionSystemInstruction(input.language),
		prompt: [...lines, input.question.trim()].join("\n"),
	};
}

function truncate(text: string, maxChars: number): string {
	return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Normalize the raw `keywords` array: non-string entries, blank terms, and
 * terms over {@link MAX_ASK_AI_KEYWORD_CHARS} are dropped (a truncated keyword
 * is a different keyword); duplicates are deduped case-insensitively keeping
 * the first spelling; the surviving list is capped at
 * {@link MAX_ASK_AI_KEYWORDS}.
 */
function normalizeKeywords(value: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const keywords: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const keyword = entry.trim();
		if (keyword.length === 0 || keyword.length > MAX_ASK_AI_KEYWORD_CHARS) {
			continue;
		}
		const key = keyword.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		keywords.push(keyword);
		if (keywords.length >= MAX_ASK_AI_KEYWORDS) {
			break;
		}
	}
	return keywords;
}

/**
 * Parse raw model output into an {@link AskAiKeywordExtractionOutput}. Returns
 * `no-valid-keywords` when nothing usable remains so the caller can fall back
 * to scoring the original question directly.
 */
export function parseAskAiKeywordExtraction(
	raw: unknown,
): Result<AskAiKeywordExtractionOutput, AskAiKeywordExtractionParseError> {
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

	if (decoded.keywords === undefined) {
		return err(parseError("missing-field", "keywords is required", "keywords"));
	}
	if (!Array.isArray(decoded.keywords)) {
		return err(
			parseError("invalid-field", "keywords must be an array", "keywords"),
		);
	}

	const keywords = normalizeKeywords(decoded.keywords);
	if (keywords.length === 0) {
		return err(
			parseError("no-valid-keywords", "no usable keywords in AI output"),
		);
	}

	const intent =
		typeof decoded.intent === "string"
			? truncate(decoded.intent.trim(), MAX_ASK_AI_INTENT_CHARS)
			: "";
	return ok({
		keywords,
		...(intent.length > 0 ? { intent } : {}),
	});
}
