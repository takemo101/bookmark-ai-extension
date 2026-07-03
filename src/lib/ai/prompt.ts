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
 * The core contract (language included) is not user-editable. A profile
 * instruction may control the `analysisMarkdown` output shape — headings,
 * sections, length — with priority over the default long-form format
 * (MIK-030); the default 800–1500 character guidance is a fallback that
 * applies only when the instruction is silent about structure/length. The
 * instruction can never change the output language, JSON keys, or privacy
 * rules.
 */
import type { SupportedLanguage } from "../i18n/index";
import type { AnalysisProfile } from "./profile";
import { type AnalysisInput, MAX_TAGS } from "./types";

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

/** Per-language prompt fragments assembled by {@link buildAnalysisPrompt}. */
type PromptLines = {
	head: string[];
	constraints: string[];
	profilePriority: string;
	profileHeading: string;
	fallbackShape: string;
	inputLabels: { title: string; url: string; excerpt: string };
};

function japanesePromptLines(profile: AnalysisProfile): PromptLines {
	const range = ANALYSIS_MARKDOWN_CHAR_RANGE.ja;
	return {
		head: [
			"次のWebページを分析し、日本語で説明・ジャンル・タグ・Markdown分析を生成してください。",
			"",
			"出力は次の形のJSONオブジェクトのみとし、コードフェンスや前置きの文章は付けないでください:",
			"{",
			'  "description": "ページ内容の日本語の説明（1〜3文）",',
			'  "genre": "日本語のジャンルを1つ",',
			`  "tags": ["日本語のタグ", "最大${MAX_TAGS}個"],`,
			'  "analysisMarkdown": "日本語のMarkdown分析"',
			"}",
		],
		constraints: [
			"必須の制約（分析指示より常に優先する）:",
			"- 出力はJSONオブジェクトのみとする。",
			"- キーは description・genre・tags・analysisMarkdown の4つを必ずすべて使い、名前の変更や省略をしない。",
			"- すべての値は日本語で記述する。",
			`- tags は最大${MAX_TAGS}個までとする。`,
			"- description は空にしない。",
			"- analysisMarkdown は空にしない。",
			"- analysisMarkdown は本文抜粋の丸写しではなく、自分の言葉でまとめた分析にする。",
			"- analysisMarkdown に生のHTMLタグを含めない。",
			"- 外部API・外部AIプロバイダー・APIキー・モデル選択を前提にした内容を書かない。",
		],
		profilePriority:
			"analysisMarkdown の見出し構成・セクション・長さは、次の分析指示に指定があればそれを最優先で守ってください。",
		profileHeading: `分析の観点（${profile.name}）:`,
		fallbackShape:
			`分析指示が analysisMarkdown の構成や長さを指定していない場合のみ、` +
			`"##" 見出しや "-" 箇条書きを使った${range.min}〜${range.max}文字程度の詳細な分析にしてください。`,
		inputLabels: { title: "タイトル", url: "URL", excerpt: "本文の抜粋:" },
	};
}

function englishPromptLines(profile: AnalysisProfile): PromptLines {
	const range = ANALYSIS_MARKDOWN_CHAR_RANGE.en;
	return {
		head: [
			"Analyze the following web page and generate an English description, genre, tags, and a Markdown analysis.",
			"",
			"Output only a JSON object of the following shape, with no code fences or introductory text:",
			"{",
			'  "description": "English description of the page content (1-3 sentences)",',
			'  "genre": "a single English genre",',
			`  "tags": ["English tags", "at most ${MAX_TAGS}"],`,
			'  "analysisMarkdown": "an English Markdown analysis"',
			"}",
		],
		constraints: [
			"Non-negotiable constraints (always take precedence over the analysis focus):",
			"- Output a JSON object only.",
			"- Use exactly the four keys description, genre, tags, and analysisMarkdown; never rename or omit them.",
			"- Write every value in English.",
			`- tags contains at most ${MAX_TAGS} items.`,
			"- description must not be empty.",
			"- analysisMarkdown must not be empty.",
			"- analysisMarkdown is an analysis in your own words, never a verbatim copy of the page excerpt.",
			"- analysisMarkdown contains no raw HTML tags.",
			"- Do not write content that depends on external APIs, external AI providers, API keys, or model selection.",
		],
		profilePriority:
			"When the analysis focus below specifies headings, sections, or length for analysisMarkdown, follow it as the top priority.",
		profileHeading: `Analysis focus (${profile.name}):`,
		fallbackShape:
			"Only if the analysis focus does not specify a structure or length for analysisMarkdown, " +
			`write a detailed analysis of roughly ${range.min}-${range.max} characters using "##" headings and "-" bullet lists.`,
		inputLabels: { title: "Title", url: "URL", excerpt: "Page excerpt:" },
	};
}

/**
 * Build the user prompt for one page in the target output language. The
 * excerpt is included verbatim (it is already bounded by the extraction
 * layer's character cap). `profile` supplies the domain-specific analysis
 * emphasis — and, with priority over the default long-form fallback, the
 * `analysisMarkdown` output shape (MIK-030) — layered on top of the fixed
 * core contract. The JSON keys are exactly `description` / `genre` / `tags` /
 * `analysisMarkdown` in both languages, so parsing and storage never change
 * with the language.
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
		lines.profilePriority,
		lines.profileHeading,
		profile.instruction,
		"",
		lines.fallbackShape,
		"",
		`${lines.inputLabels.title}: ${input.title}`,
		`${lines.inputLabels.url}: ${input.url}`,
		lines.inputLabels.excerpt,
		input.excerpt,
	].join("\n");
}
