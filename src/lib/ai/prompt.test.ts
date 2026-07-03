import { describe, expect, it } from "vitest";

import { type AnalysisProfile, BUILT_IN_PROFILES } from "./profile";
import {
	ANALYSIS_MARKDOWN_CHAR_RANGE,
	ANALYSIS_MARKDOWN_MAX_CHARS,
	ANALYSIS_MARKDOWN_MIN_CHARS,
	ANALYSIS_SYSTEM_PROMPT,
	analysisSystemPrompt,
	buildAnalysisPrompt,
} from "./prompt";
import type { AnalysisInput } from "./types";

const INPUT: AnalysisInput = {
	title: "Example",
	url: "https://example.com",
	excerpt: "本文の抜粋テキスト。",
};

const genericProfile = BUILT_IN_PROFILES.find((p) => p.id === "generic-page");
if (!genericProfile) throw new Error("generic-page profile not found");

/**
 * A concise custom skill that fully specifies the analysisMarkdown shape
 * (MIK-030): two fixed sections, a short overview, and no other headings.
 */
const YOUTUBE_PROFILE: AnalysisProfile = {
	id: "custom-youtube",
	name: "YouTube動画",
	priority: 30,
	urlPatterns: ["www.youtube.com/watch*"],
	instruction: [
		"analysisMarkdown は必ず次の2項目だけにしてください。",
		"## 動画概要",
		"100文字以内で動画内容を1文で要約してください。",
		"## コメントピックアップ",
		"コメントらしき情報が含まれる場合のみ3〜5件を短い箇条書きでまとめてください。",
		"上記以外の見出しは作らないでください。",
	].join("\n"),
};

describe("buildAnalysisPrompt", () => {
	it("requires analysisMarkdown in the JSON schema alongside description/genre/tags", () => {
		const prompt = buildAnalysisPrompt(INPUT, genericProfile);
		expect(prompt).toContain('"description"');
		expect(prompt).toContain('"genre"');
		expect(prompt).toContain('"tags"');
		expect(prompt).toContain('"analysisMarkdown"');
	});

	it("includes the target Japanese character range for analysisMarkdown", () => {
		const prompt = buildAnalysisPrompt(INPUT, genericProfile);
		expect(prompt).toContain(String(ANALYSIS_MARKDOWN_MIN_CHARS));
		expect(prompt).toContain(String(ANALYSIS_MARKDOWN_MAX_CHARS));
	});

	it("layers the selected profile's instruction onto the fixed core contract", () => {
		const githubProfile = BUILT_IN_PROFILES.find(
			(p) => p.id === "github-repository",
		);
		if (!githubProfile) throw new Error("github-repository profile not found");
		const prompt = buildAnalysisPrompt(INPUT, githubProfile);
		expect(prompt).toContain(githubProfile.name);
		expect(prompt).toContain(githubProfile.instruction);
	});

	it("still requests Japanese, JSON-only output and page input", () => {
		const prompt = buildAnalysisPrompt(INPUT, genericProfile);
		expect(prompt).toContain("日本語");
		expect(prompt).toContain(INPUT.title);
		expect(prompt).toContain(INPUT.url);
		expect(prompt).toContain(INPUT.excerpt);
	});

	it("defaults to the Japanese prompt when no language is given", () => {
		expect(buildAnalysisPrompt(INPUT, genericProfile)).toBe(
			buildAnalysisPrompt(INPUT, genericProfile, "ja"),
		);
	});

	it("builds an English prompt with identical JSON keys (MIK-029)", () => {
		const prompt = buildAnalysisPrompt(INPUT, genericProfile, "en");
		expect(prompt).toContain("in English");
		expect(prompt).not.toContain("日本語");
		// The schema keys never change with the language.
		expect(prompt).toContain('"description"');
		expect(prompt).toContain('"genre"');
		expect(prompt).toContain('"tags"');
		expect(prompt).toContain('"analysisMarkdown"');
		expect(prompt).toContain(INPUT.title);
		expect(prompt).toContain(INPUT.url);
		expect(prompt).toContain(INPUT.excerpt);
		// The English privacy line still forbids copying the excerpt or raw HTML.
		expect(prompt).toContain("never a verbatim copy of the page excerpt");
		expect(prompt).toContain("no raw HTML tags");
	});

	it("uses the English character range for the English prompt", () => {
		const prompt = buildAnalysisPrompt(INPUT, genericProfile, "en");
		expect(prompt).toContain(String(ANALYSIS_MARKDOWN_CHAR_RANGE.en.min));
		expect(prompt).toContain(String(ANALYSIS_MARKDOWN_CHAR_RANGE.en.max));
	});

	it("layers the profile instruction in both languages", () => {
		for (const language of ["ja", "en"] as const) {
			const prompt = buildAnalysisPrompt(INPUT, genericProfile, language);
			expect(prompt).toContain(genericProfile.name);
			expect(prompt).toContain(genericProfile.instruction);
		}
	});
});

describe("profile output-shape priority (MIK-030)", () => {
	it("states the profile instruction as higher priority than the default shape, in both languages", () => {
		const ja = buildAnalysisPrompt(INPUT, genericProfile, "ja");
		expect(ja).toContain(
			"analysisMarkdown の見出し構成・セクション・長さは、次の分析指示に指定があればそれを最優先で守ってください。",
		);
		const en = buildAnalysisPrompt(INPUT, genericProfile, "en");
		expect(en).toContain(
			"When the analysis focus below specifies headings, sections, or length for analysisMarkdown, follow it as the top priority.",
		);
		// The profile instruction comes before the default fallback shape line.
		for (const [prompt, language] of [
			[ja, "ja"],
			[en, "en"],
		] as const) {
			const fallbackMarker = String(ANALYSIS_MARKDOWN_CHAR_RANGE[language].min);
			expect(prompt.indexOf(genericProfile.instruction)).toBeGreaterThan(-1);
			expect(prompt.indexOf(fallbackMarker)).toBeGreaterThan(-1);
			expect(prompt.indexOf(genericProfile.instruction)).toBeLessThan(
				prompt.indexOf(fallbackMarker),
			);
		}
	});

	it("keeps the fixed JSON keys and safety constraints non-overridable, in both languages", () => {
		const ja = buildAnalysisPrompt(INPUT, YOUTUBE_PROFILE, "ja");
		expect(ja).toContain("必須の制約（分析指示より常に優先する）:");
		expect(ja).toContain(
			"- キーは description・genre・tags・analysisMarkdown の4つを必ずすべて使い、名前の変更や省略をしない。",
		);
		expect(ja).toContain(
			"- analysisMarkdown は本文抜粋の丸写しではなく、自分の言葉でまとめた分析にする。",
		);
		expect(ja).toContain("- analysisMarkdown に生のHTMLタグを含めない。");
		expect(ja).toContain(
			"- 外部API・外部AIプロバイダー・APIキー・モデル選択を前提にした内容を書かない。",
		);

		const en = buildAnalysisPrompt(INPUT, YOUTUBE_PROFILE, "en");
		expect(en).toContain(
			"Non-negotiable constraints (always take precedence over the analysis focus):",
		);
		expect(en).toContain(
			"- Use exactly the four keys description, genre, tags, and analysisMarkdown; never rename or omit them.",
		);
		expect(en).toContain("never a verbatim copy of the page excerpt");
		expect(en).toContain("no raw HTML tags");
		expect(en).toContain(
			"Do not write content that depends on external APIs, external AI providers, API keys, or model selection.",
		);
	});

	it("lets a concise YouTube-style profile request only its own sections", () => {
		const prompt = buildAnalysisPrompt(INPUT, YOUTUBE_PROFILE, "ja");
		expect(prompt).toContain("## 動画概要");
		expect(prompt).toContain("## コメントピックアップ");
		// No generic long-form sections are forced alongside the custom shape.
		expect(prompt).not.toContain("## 主要なテーマ");
		expect(prompt).not.toContain("## 分析");
		expect(prompt).not.toContain("## まとめ");
		// The long-form default is explicitly conditional on the profile being silent.
		expect(prompt).toContain(
			"分析指示が analysisMarkdown の構成や長さを指定していない場合のみ",
		);
	});

	it("still requests the long-form default when the profile specifies no shape", () => {
		for (const language of ["ja", "en"] as const) {
			const prompt = buildAnalysisPrompt(INPUT, genericProfile, language);
			const range = ANALYSIS_MARKDOWN_CHAR_RANGE[language];
			expect(prompt).toContain(String(range.min));
			expect(prompt).toContain(String(range.max));
			expect(prompt).toContain('"##"');
		}
	});
});

describe("analysisSystemPrompt", () => {
	it("keeps the historical Japanese system prompt as the ja variant", () => {
		expect(analysisSystemPrompt("ja")).toBe(ANALYSIS_SYSTEM_PROMPT);
		expect(analysisSystemPrompt("ja")).toContain("日本語");
	});

	it("provides an English JSON-only system prompt", () => {
		const prompt = analysisSystemPrompt("en");
		expect(prompt).toContain("English");
		expect(prompt).toContain("JSON");
		expect(prompt).not.toContain("日本語");
	});
});
