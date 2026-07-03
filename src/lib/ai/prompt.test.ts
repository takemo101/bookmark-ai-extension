import { describe, expect, it } from "vitest";

import { BUILT_IN_PROFILES } from "./profile";
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
