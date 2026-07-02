import { describe, expect, it } from "vitest";

import { BUILT_IN_PROFILES } from "./profile";
import {
	ANALYSIS_MARKDOWN_MAX_CHARS,
	ANALYSIS_MARKDOWN_MIN_CHARS,
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
});
