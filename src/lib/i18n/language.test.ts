import { describe, expect, it } from "vitest";

import {
	DEFAULT_LANGUAGE,
	inferOutputLanguage,
	normalizeLanguageTag,
	resolveUiLanguage,
} from "./language";

describe("normalizeLanguageTag", () => {
	it("maps Japanese tags onto ja", () => {
		expect(normalizeLanguageTag("ja")).toBe("ja");
		expect(normalizeLanguageTag("ja-JP")).toBe("ja");
		expect(normalizeLanguageTag("JA_JP")).toBe("ja");
	});

	it("maps English tags onto en", () => {
		expect(normalizeLanguageTag("en")).toBe("en");
		expect(normalizeLanguageTag("en-US")).toBe("en");
		expect(normalizeLanguageTag("en-GB")).toBe("en");
	});

	it("rejects unsupported, empty, and lookalike tags", () => {
		expect(normalizeLanguageTag("fr")).toBeUndefined();
		expect(normalizeLanguageTag("zh-CN")).toBeUndefined();
		// Only the primary subtag decides; "jam" is not Japanese.
		expect(normalizeLanguageTag("jam")).toBeUndefined();
		expect(normalizeLanguageTag("")).toBeUndefined();
		expect(normalizeLanguageTag(undefined)).toBeUndefined();
		expect(normalizeLanguageTag(null)).toBeUndefined();
	});
});

describe("resolveUiLanguage", () => {
	it("picks the first supported tag in order", () => {
		expect(resolveUiLanguage(["en-US", "ja"])).toBe("en");
		expect(resolveUiLanguage([undefined, "ja-JP", "en"])).toBe("ja");
	});

	it("skips unsupported tags", () => {
		expect(resolveUiLanguage(["fr", "en-US"])).toBe("en");
	});

	it("falls back to Japanese when nothing resolves", () => {
		expect(resolveUiLanguage([])).toBe("ja");
		expect(resolveUiLanguage([undefined, null, "de"])).toBe("ja");
		expect(DEFAULT_LANGUAGE).toBe("ja");
	});
});

describe("inferOutputLanguage", () => {
	const JAPANESE_TEXT =
		"Chrome拡張機能の設計についての記事です。ブックマークをAIで整理し、日本語の要約を保存します。";
	const ENGLISH_TEXT =
		"A practical guide to designing Chrome extensions with bookmarks, storage, and AI summaries.";

	it("chooses ja for clearly Japanese text", () => {
		expect(inferOutputLanguage(JAPANESE_TEXT, "en")).toBe("ja");
	});

	it("chooses ja for Japanese text that mixes in Latin tech terms", () => {
		const mixed = `TypeScriptとReactでChrome拡張を作る方法を、手順つきで詳しく解説します。${JAPANESE_TEXT}`;
		expect(inferOutputLanguage(mixed, "en")).toBe("ja");
	});

	it("chooses en for clearly English text", () => {
		expect(inferOutputLanguage(ENGLISH_TEXT, "ja")).toBe("en");
	});

	it("uses the fallback for text too short to carry a signal", () => {
		expect(inferOutputLanguage("OK", "ja")).toBe("ja");
		expect(inferOutputLanguage("OK", "en")).toBe("en");
		expect(inferOutputLanguage("", "en")).toBe("en");
	});

	it("uses the fallback for ambiguous mixed text", () => {
		// Mostly Latin with a thin Japanese presence: neither clearly Japanese
		// (>= 30% Japanese script) nor clearly English (<= 5%).
		const ambiguous = `${"latin ".repeat(10)}日本語です`;
		expect(inferOutputLanguage(ambiguous, "ja")).toBe("ja");
		expect(inferOutputLanguage(ambiguous, "en")).toBe("en");
	});

	it("defaults the fallback to Japanese", () => {
		expect(inferOutputLanguage("??")).toBe("ja");
	});

	it("is deterministic for the same input", () => {
		expect(inferOutputLanguage(ENGLISH_TEXT, "ja")).toBe(
			inferOutputLanguage(ENGLISH_TEXT, "ja"),
		);
	});
});
