import { describe, expect, it } from "vitest";

import {
	MAX_ASK_AI_KEYWORD_CHARS,
	MAX_ASK_AI_KEYWORDS,
	buildAskAiKeywordExtractionPrompt,
	parseAskAiKeywordExtraction,
} from "./ask-ai-keywords";

/**
 * Pure boundary tests for the MIK-047 Ask AI keyword extraction: a prompt
 * builder that sees the user question and UI language ONLY (never bookmark
 * records, URLs, excerpts, analysis Markdown, Drive metadata, or chat
 * history), and a tolerant parser that turns raw model output into a capped,
 * deduped, ephemeral keyword list — or a typed error so the caller falls back
 * to direct question scoring.
 */

describe("buildAskAiKeywordExtractionPrompt", () => {
	it("builds a Japanese prompt containing the question and a JSON-only contract", () => {
		const built = buildAskAiKeywordExtractionPrompt({
			question: "前に読んだ、テスト設計で参考になりそうなやつ",
			language: "ja",
		});

		expect(built.prompt).toContain(
			"前に読んだ、テスト設計で参考になりそうなやつ",
		);
		expect(built.prompt).toContain('"keywords"');
		expect(built.prompt).toContain(`${MAX_ASK_AI_KEYWORDS}`);
		expect(built.systemInstruction).toContain("JSON");
	});

	it("builds an English prompt containing the question and a JSON-only contract", () => {
		const built = buildAskAiKeywordExtractionPrompt({
			question: "that article about designing good tests",
			language: "en",
		});

		expect(built.prompt).toContain("that article about designing good tests");
		expect(built.prompt).toContain('"keywords"');
		expect(built.systemInstruction).toContain("JSON");
	});

	it("puts nothing but the trimmed question after the question label", () => {
		// Privacy contract: the prompt is built from question + language alone.
		// The builder has no other inputs, so the question is the only
		// caller-provided text that can appear.
		const built = buildAskAiKeywordExtractionPrompt({
			question: "  chrome拡張のメモ  ",
			language: "ja",
		});

		expect(built.prompt).toContain("chrome拡張のメモ");
		expect(built.prompt).not.toContain("  chrome拡張のメモ  ");
	});
});

describe("parseAskAiKeywordExtraction", () => {
	it("parses Japanese keywords from a JSON object", () => {
		const result = parseAskAiKeywordExtraction(
			JSON.stringify({
				keywords: ["テスト設計", "テスト", "設計", "test design"],
				intent: "テスト設計の参考資料を探している",
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.keywords).toEqual([
			"テスト設計",
			"テスト",
			"設計",
			"test design",
		]);
		expect(result.value.intent).toBe("テスト設計の参考資料を探している");
	});

	it("parses English keywords wrapped in prose and code fences", () => {
		const raw = [
			"Here you go:",
			"```json",
			'{ "keywords": ["testing", "test design", "unit tests"] }',
			"```",
		].join("\n");

		const result = parseAskAiKeywordExtraction(raw);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.keywords).toEqual([
			"testing",
			"test design",
			"unit tests",
		]);
		expect(result.value.intent).toBeUndefined();
	});

	it("caps the keyword list at MAX_ASK_AI_KEYWORDS", () => {
		const many = Array.from({ length: MAX_ASK_AI_KEYWORDS + 5 }, (_, i) => {
			return `keyword-${i}`;
		});

		const result = parseAskAiKeywordExtraction(
			JSON.stringify({ keywords: many }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.keywords).toHaveLength(MAX_ASK_AI_KEYWORDS);
		expect(result.value.keywords[0]).toBe("keyword-0");
	});

	it("drops over-long terms, blank terms, non-strings, and case-insensitive duplicates", () => {
		const result = parseAskAiKeywordExtraction(
			JSON.stringify({
				keywords: [
					" TypeScript ",
					"typescript",
					"x".repeat(MAX_ASK_AI_KEYWORD_CHARS + 1),
					"   ",
					42,
					null,
					"testing",
				],
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.keywords).toEqual(["TypeScript", "testing"]);
	});

	it("rejects empty output", () => {
		const result = parseAskAiKeywordExtraction("   ");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.kind).toBe("empty-output");
	});

	it("rejects non-string output", () => {
		const result = parseAskAiKeywordExtraction(42);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.kind).toBe("invalid-field");
	});

	it("rejects output without a JSON object", () => {
		const result = parseAskAiKeywordExtraction("keywords: testing, design");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.kind).toBe("no-json");
	});

	it("rejects invalid JSON inside a balanced object", () => {
		const result = parseAskAiKeywordExtraction('{ "keywords": [oops] }');

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.kind).toBe("invalid-json");
	});

	it("rejects a missing keywords field", () => {
		const result = parseAskAiKeywordExtraction('{ "intent": "something" }');

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.kind).toBe("missing-field");
	});

	it("rejects a non-array keywords field", () => {
		const result = parseAskAiKeywordExtraction('{ "keywords": "testing" }');

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.kind).toBe("invalid-field");
	});

	it("rejects output where no usable keyword survives", () => {
		const result = parseAskAiKeywordExtraction(
			JSON.stringify({
				keywords: ["", "   ", "y".repeat(MAX_ASK_AI_KEYWORD_CHARS + 1), 7],
			}),
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.kind).toBe("no-valid-keywords");
	});
});
