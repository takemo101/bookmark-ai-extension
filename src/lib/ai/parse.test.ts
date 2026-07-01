import { describe, expect, it } from "vitest";

import { parseAnalysis } from "./parse";
import { MAX_TAGS } from "./types";

describe("parseAnalysis", () => {
	it("parses a clean JSON object", () => {
		const result = parseAnalysis(
			JSON.stringify({
				description: "このページはGitHubのリポジトリです。",
				genre: "開発ツール",
				tags: ["GitHub", "TypeScript", "拡張機能"],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.description).toBe(
			"このページはGitHubのリポジトリです。",
		);
		expect(result.value.genre).toBe("開発ツール");
		expect(result.value.tags).toEqual(["GitHub", "TypeScript", "拡張機能"]);
	});

	it("tolerates surrounding prose and a ```json code fence", () => {
		const raw = [
			"以下が分析結果です。",
			"```json",
			'{ "description": "説明文です。", "genre": "技術", "tags": ["A", "B"] }',
			"```",
			"以上です。",
		].join("\n");
		const result = parseAnalysis(raw);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.description).toBe("説明文です。");
		expect(result.value.tags).toEqual(["A", "B"]);
	});

	it("ignores braces inside string values when scanning for the object", () => {
		const result = parseAnalysis(
			'noise {"description": "a {nested} brace } here", "tags": []} trailing',
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.description).toBe("a {nested} brace } here");
	});

	it("trims, de-duplicates, and caps excessive tags", () => {
		const tooMany = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag${i}`);
		const result = parseAnalysis(
			JSON.stringify({
				description: "説明",
				tags: ["  Dup  ", "dup", "", 42, ...tooMany],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.tags.length).toBe(MAX_TAGS);
		expect(result.value.tags[0]).toBe("Dup");
		// case-insensitive duplicate "dup" dropped; blanks and non-strings dropped.
		expect(result.value.tags).not.toContain("");
		expect(result.value.tags).not.toContain("dup");
	});

	it("drops a blank or non-string genre instead of failing", () => {
		const blank = parseAnalysis(
			JSON.stringify({ description: "説明", genre: "   ", tags: [] }),
		);
		expect(blank.ok).toBe(true);
		if (blank.ok) expect(blank.value.genre).toBeUndefined();

		const wrongType = parseAnalysis(
			JSON.stringify({ description: "説明", genre: 5, tags: [] }),
		);
		expect(wrongType.ok).toBe(true);
		if (wrongType.ok) expect(wrongType.value.genre).toBeUndefined();
	});

	it("rejects empty output", () => {
		const result = parseAnalysis("   \n  ");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("empty-output");
	});

	it("rejects output with no JSON object", () => {
		const result = parseAnalysis("申し訳ありませんが分析できませんでした。");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("no-json");
	});

	it("rejects malformed JSON", () => {
		const result = parseAnalysis('{ "description": "説明", tags: [ }');
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid-json");
	});

	it("rejects a missing description field", () => {
		const result = parseAnalysis(JSON.stringify({ genre: "技術", tags: [] }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("missing-field");
		expect(result.error.field).toBe("description");
	});

	it("rejects a missing tags field", () => {
		const result = parseAnalysis(JSON.stringify({ description: "説明" }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("missing-field");
		expect(result.error.field).toBe("tags");
	});

	it("rejects an empty description", () => {
		const result = parseAnalysis(
			JSON.stringify({ description: "   ", genre: "技術", tags: ["A"] }),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("empty-description");
	});

	it("rejects a non-array tags field", () => {
		const result = parseAnalysis(
			JSON.stringify({ description: "説明", tags: "A, B" }),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid-field");
		expect(result.error.field).toBe("tags");
	});

	it("rejects a JSON value that is not an object", () => {
		const result = parseAnalysis("[1, 2, 3]");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		// An array literal has no `{`, so it is reported as no-json.
		expect(result.error.kind).toBe("no-json");
	});
});
