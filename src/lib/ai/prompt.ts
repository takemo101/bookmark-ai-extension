/**
 * Analysis prompt construction (English/Japanese, MIK-029).
 *
 * The prompt asks Chrome Built-in AI to return a single structured JSON object
 * describing the page in the target output language (`description`, `genre`,
 * `tags`, `analysisMarkdown`). The parser (./parse.ts) tolerates extra prose or
 * code fences around that JSON, but the instruction here keeps the model
 * pointed at JSON-only output. The output language is Japanese or English,
 * selected per page by the analyzer — see docs/design.md "AI Design"; the JSON
 * keys are identical in both languages.
 *
 * The prompt is layered (docs/ai-analysis-v2.md "Prompt composition"):
 *   1. this fixed core contract — JSON-only, target language, schema, no
 *      copied excerpt;
 *   2. the selected {@link AnalysisProfile}'s domain-specific instruction;
 *   3. the page input (title, URL, excerpt).
 * The core contract (language included) is not user-editable; a profile
 * instruction can only shift analysis emphasis, never the output language,
 * schema, or privacy rules.
 */
import type { SupportedLanguage } from "../i18n/index";
import type { AnalysisProfile } from "./profile";
import { MAX_TAGS, type AnalysisInput } from "./types";

/** System instruction: role + target-language, JSON-only output contract. */
export function analysisSystemPrompt(language: SupportedLanguage): string {
	if (language === "en") {
		return (
			"You are an assistant that analyzes web page content and summarizes it in English. " +
			"Always reply with a single JSON object whose values are written in English, and output no text other than JSON."
		);
	}
	return (
		"あなたはWebページの内容を分析し、日本語で要約するアシスタントです。" +
		"返答は必ず日本語の値を持つJSONオブジェクトのみで行い、JSON以外の文章は出力しないでください。"
	);
}

/** The historical Japanese system prompt; kept for existing callers/tests. */
export const ANALYSIS_SYSTEM_PROMPT = analysisSystemPrompt("ja");

/** Target length range for `analysisMarkdown`, in Japanese characters. */
export const ANALYSIS_MARKDOWN_MIN_CHARS = 800;
export const ANALYSIS_MARKDOWN_MAX_CHARS = 1500;

/**
 * Per-language `analysisMarkdown` length targets. English carries roughly half
 * the information per character, so its range is about double the Japanese one.
 */
export const ANALYSIS_MARKDOWN_CHAR_RANGE: Record<
	SupportedLanguage,
	{ readonly min: number; readonly max: number }
> = {
	ja: { min: ANALYSIS_MARKDOWN_MIN_CHARS, max: ANALYSIS_MARKDOWN_MAX_CHARS },
	en: {
		min: ANALYSIS_MARKDOWN_MIN_CHARS * 2,
		max: ANALYSIS_MARKDOWN_MAX_CHARS * 2,
	},
};

function japanesePromptLines(profile: AnalysisProfile): {
	head: string[];
	constraints: string[];
	profileHeading: string;
	inputLabels: { title: string; url: string; excerpt: string };
} {
	const range = ANALYSIS_MARKDOWN_CHAR_RANGE.ja;
	return {
		head: [
			"次のWebページを分析し、日本語で説明・ジャンル・タグ・詳細なMarkdown分析を生成してください。",
			"",
			"出力は次の形のJSONオブジェクトのみとし、コードフェンスや前置きの文章は付けないでください:",
			"{",
			'  "description": "ページ内容の日本語の説明（1〜3文）",',
			'  "genre": "日本語のジャンルを1つ",',
			`  "tags": ["日本語のタグ", "最大${MAX_TAGS}個"],`,
			'  "analysisMarkdown": "見出しや箇条書きを使った日本語のMarkdown分析"',
			"}",
		],
		constraints: [
			"制約:",
			"- すべての値は日本語で記述する。",
			`- tags は最大${MAX_TAGS}個までとする。`,
			"- description は空にしない。",
			"- analysisMarkdown は空にしない。",
			`- analysisMarkdown は "##" 見出しや "-" 箇条書きを使い、${range.min}〜${range.max}文字程度の分析にする。`,
			"- analysisMarkdown は本文抜粋の丸写しではなく、自分の言葉でまとめた分析にする。",
			"- analysisMarkdown に生のHTMLタグを含めない。",
		],
		profileHeading: `分析の観点（${profile.name}）:`,
		inputLabels: { title: "タイトル", url: "URL", excerpt: "本文の抜粋:" },
	};
}

function englishPromptLines(profile: AnalysisProfile): {
	head: string[];
	constraints: string[];
	profileHeading: string;
	inputLabels: { title: string; url: string; excerpt: string };
} {
	const range = ANALYSIS_MARKDOWN_CHAR_RANGE.en;
	return {
		head: [
			"Analyze the following web page and generate an English description, genre, tags, and a detailed Markdown analysis.",
			"",
			"Output only a JSON object of the following shape, with no code fences or introductory text:",
			"{",
			'  "description": "English description of the page content (1-3 sentences)",',
			'  "genre": "a single English genre",',
			`  "tags": ["English tags", "at most ${MAX_TAGS}"],`,
			'  "analysisMarkdown": "an English Markdown analysis using headings and bullet lists"',
			"}",
		],
		constraints: [
			"Constraints:",
			"- Write every value in English.",
			`- tags contains at most ${MAX_TAGS} items.`,
			"- description must not be empty.",
			"- analysisMarkdown must not be empty.",
			`- analysisMarkdown uses "##" headings and "-" bullet lists, roughly ${range.min}-${range.max} characters of analysis.`,
			"- analysisMarkdown is an analysis in your own words, never a verbatim copy of the page excerpt.",
			"- analysisMarkdown contains no raw HTML tags.",
		],
		profileHeading: `Analysis focus (${profile.name}):`,
		inputLabels: { title: "Title", url: "URL", excerpt: "Page excerpt:" },
	};
}

/**
 * Build the user prompt for one page in the target output language. The
 * excerpt is included verbatim (it is already bounded by the extraction
 * layer's character cap). `profile` supplies the domain-specific analysis
 * emphasis layered on top of the fixed core contract. The JSON keys are
 * exactly `description` / `genre` / `tags` / `analysisMarkdown` in both
 * languages, so parsing and storage never change with the language.
 */
export function buildAnalysisPrompt(
	input: AnalysisInput,
	profile: AnalysisProfile,
	language: SupportedLanguage = "ja",
): string {
	const lines =
		language === "en"
			? englishPromptLines(profile)
			: japanesePromptLines(profile);
	return [
		...lines.head,
		"",
		...lines.constraints,
		"",
		lines.profileHeading,
		profile.instruction,
		"",
		`${lines.inputLabels.title}: ${input.title}`,
		`${lines.inputLabels.url}: ${input.url}`,
		lines.inputLabels.excerpt,
		input.excerpt,
	].join("\n");
}
