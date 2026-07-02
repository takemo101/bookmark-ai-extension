import { describe, expect, it } from "vitest";

import {
	BUILT_IN_PROFILES,
	type AnalysisProfile,
	selectAnalysisProfile,
} from "./profile";

describe("selectAnalysisProfile", () => {
	it("matches a GitHub repository URL", () => {
		expect(selectAnalysisProfile("https://github.com/facebook/react").id).toBe(
			"github-repository",
		);
	});

	it("does not match a GitHub URL without an owner/repo path", () => {
		// A profile page (single path segment) isn't a repository page.
		expect(selectAnalysisProfile("https://github.com/facebook").id).toBe(
			"generic-page",
		);
	});

	it("matches technical article domains", () => {
		expect(
			selectAnalysisProfile("https://zenn.dev/someone/articles/abc").id,
		).toBe("technical-article");
		expect(
			selectAnalysisProfile("https://qiita.com/someone/items/abc").id,
		).toBe("technical-article");
		expect(selectAnalysisProfile("https://dev.to/someone/post-1").id).toBe(
			"technical-article",
		);
		expect(selectAnalysisProfile("https://medium.com/@someone/post").id).toBe(
			"technical-article",
		);
	});

	it("matches official documentation domains, including wildcard host/path patterns", () => {
		expect(
			selectAnalysisProfile("https://developer.mozilla.org/en-US/docs/Web").id,
		).toBe("official-documentation");
		expect(selectAnalysisProfile("https://docs.python.org/3/").id).toBe(
			"official-documentation",
		);
		expect(selectAnalysisProfile("https://vite.dev/docs/config").id).toBe(
			"official-documentation",
		);
	});

	it("falls back to the generic profile for an unmatched URL", () => {
		expect(selectAnalysisProfile("https://news.example.org/story").id).toBe(
			"generic-page",
		);
	});

	it("falls back to the generic profile for an unparseable URL", () => {
		expect(selectAnalysisProfile("not-a-url").id).toBe("generic-page");
	});

	it("picks the highest-priority match when a URL matches more than one profile", () => {
		const high: AnalysisProfile = {
			id: "high",
			name: "High",
			priority: 100,
			urlPatterns: ["example.com/*"],
			instruction: "high",
		};
		const low: AnalysisProfile = {
			id: "low",
			name: "Low",
			priority: 1,
			urlPatterns: ["example.com/*"],
			instruction: "low",
		};
		const profile = selectAnalysisProfile("https://example.com/a", [low, high]);
		expect(profile.id).toBe("high");
	});

	it("breaks a priority tie by the most specific (most literal) pattern", () => {
		const broad: AnalysisProfile = {
			id: "broad",
			name: "Broad",
			priority: 10,
			urlPatterns: ["example.com/*"],
			instruction: "broad",
		};
		const specific: AnalysisProfile = {
			id: "specific",
			name: "Specific",
			priority: 10,
			urlPatterns: ["example.com/docs/*"],
			instruction: "specific",
		};
		const profile = selectAnalysisProfile("https://example.com/docs/guide", [
			broad,
			specific,
		]);
		expect(profile.id).toBe("specific");
	});

	it("every built-in profile id is unique", () => {
		const ids = BUILT_IN_PROFILES.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
