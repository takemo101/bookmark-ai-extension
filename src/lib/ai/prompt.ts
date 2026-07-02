/**
 * Japanese analysis prompt construction.
 *
 * The prompt asks Chrome Built-in AI to return a single structured JSON object
 * describing the page in Japanese (`description`, `genre`, `tags`,
 * `analysisMarkdown`). The parser (./parse.ts) tolerates extra prose or code
 * fences around that JSON, but the instruction here keeps the model pointed at
 * JSON-only output. Output language is Japanese by design — see
 * docs/design.md "AI Design".
 *
 * The prompt is layered (docs/ai-analysis-v2.md "Prompt composition"):
 *   1. this fixed core contract — JSON-only, Japanese, schema, no copied excerpt;
 *   2. the selected {@link AnalysisProfile}'s domain-specific instruction;
 *   3. the page input (title, URL, excerpt).
 * The core contract is not user-editable; a profile instruction can only shift
 * analysis emphasis, never the output schema or privacy rules.
 */
import type { AnalysisProfile } from "./profile";
import { MAX_TAGS, type AnalysisInput } from "./types";

/** System instruction: role + Japanese, JSON-only output contract. */
export const ANALYSIS_SYSTEM_PROMPT =
	"あなたはWebページの内容を分析し、日本語で要約するアシスタントです。" +
	"返答は必ず日本語の値を持つJSONオブジェクトのみで行い、JSON以外の文章は出力しないでください。";

/** Target length range for `analysisMarkdown`, in Japanese characters. */
export const ANALYSIS_MARKDOWN_MIN_CHARS = 800;
export const ANALYSIS_MARKDOWN_MAX_CHARS = 1500;

/**
 * Build the user prompt for one page. The excerpt is included verbatim (it is
 * already bounded by the extraction layer's character cap). `profile` supplies
 * the domain-specific analysis emphasis layered on top of the fixed core
 * contract.
 */
export function buildAnalysisPrompt(
	input: AnalysisInput,
	profile: AnalysisProfile,
): string {
	return [
		"次のWebページを分析し、日本語で説明・ジャンル・タグ・詳細なMarkdown分析を生成してください。",
		"",
		"出力は次の形のJSONオブジェクトのみとし、コードフェンスや前置きの文章は付けないでください:",
		"{",
		'  "description": "ページ内容の日本語の説明（1〜3文）",',
		'  "genre": "日本語のジャンルを1つ",',
		`  "tags": ["日本語のタグ", "最大${MAX_TAGS}個"],`,
		'  "analysisMarkdown": "見出しや箇条書きを使った日本語のMarkdown分析"',
		"}",
		"",
		"制約:",
		"- すべての値は日本語で記述する。",
		`- tags は最大${MAX_TAGS}個までとする。`,
		"- description は空にしない。",
		"- analysisMarkdown は空にしない。",
		`- analysisMarkdown は "##" 見出しや "-" 箇条書きを使い、${ANALYSIS_MARKDOWN_MIN_CHARS}〜${ANALYSIS_MARKDOWN_MAX_CHARS}文字程度の分析にする。`,
		"- analysisMarkdown は本文抜粋の丸写しではなく、自分の言葉でまとめた分析にする。",
		"- analysisMarkdown に生のHTMLタグを含めない。",
		"",
		`分析の観点（${profile.name}）:`,
		profile.instruction,
		"",
		`タイトル: ${input.title}`,
		`URL: ${input.url}`,
		"本文の抜粋:",
		input.excerpt,
	].join("\n");
}
