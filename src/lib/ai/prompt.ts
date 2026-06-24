/**
 * Japanese analysis prompt construction.
 *
 * The prompt asks Chrome Built-in AI to return a single structured JSON object
 * describing the page in Japanese (`description`, `genre`, `tags`). The parser
 * (./parse.ts) tolerates extra prose or code fences around that JSON, but the
 * instruction here keeps the model pointed at JSON-only output. Output language
 * is Japanese by design — see docs/design.md "AI Design".
 */
import { MAX_TAGS, type AnalysisInput } from "./types";

/** System instruction: role + Japanese, JSON-only output contract. */
export const ANALYSIS_SYSTEM_PROMPT =
	"あなたはWebページの内容を分析し、日本語で要約するアシスタントです。" +
	"返答は必ず日本語の値を持つJSONオブジェクトのみで行い、JSON以外の文章は出力しないでください。";

/**
 * Build the user prompt for one page. The excerpt is included verbatim (it is
 * already bounded by the extraction layer's character cap).
 */
export function buildAnalysisPrompt(input: AnalysisInput): string {
	return [
		"次のWebページを分析し、日本語で説明・ジャンル・タグを生成してください。",
		"",
		"出力は次の形のJSONオブジェクトのみとし、コードフェンスや前置きの文章は付けないでください:",
		"{",
		'  "description": "ページ内容の日本語の説明（1〜3文）",',
		'  "genre": "日本語のジャンルを1つ",',
		`  "tags": ["日本語のタグ", "最大${MAX_TAGS}個"]`,
		"}",
		"",
		"制約:",
		"- すべての値は日本語で記述する。",
		`- tags は最大${MAX_TAGS}個までとする。`,
		"- description は空にしない。",
		"",
		`タイトル: ${input.title}`,
		`URL: ${input.url}`,
		"本文の抜粋:",
		input.excerpt,
	].join("\n");
}
