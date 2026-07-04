import { describe, expect, it } from "vitest";

import { type AskAiCandidate, findAskAiCandidates } from "./ask-ai-candidates";
import { type BookmarkRecord, parseBookmarkRecord } from "./record";

function record(overrides: Record<string, unknown> = {}): BookmarkRecord {
	const result = parseBookmarkRecord({
		schemaVersion: 1,
		id: "bm-1",
		canonicalUrl: "https://example.com/a",
		url: "https://example.com/a",
		title: "Example",
		tags: [],
		aiStatus: "ready",
		createdAt: "2026-06-25T00:00:00.000Z",
		updatedAt: "2026-06-25T00:00:00.000Z",
		...overrides,
	});
	if (!result.ok) throw new Error(`bad fixture: ${result.error.message}`);
	return result.value;
}

function candidatesOf(
	result: ReturnType<typeof findAskAiCandidates>,
): readonly AskAiCandidate[] {
	if (result.kind !== "candidates" && result.kind !== "weak-candidates") {
		throw new Error(`expected candidates, got ${result.kind}`);
	}
	return result.candidates;
}

describe("findAskAiCandidates question validation", () => {
	it("returns too-short-question for an empty or blank question", () => {
		const records = [record()];
		expect(findAskAiCandidates(records, "").kind).toBe("too-short-question");
		expect(findAskAiCandidates(records, "   ").kind).toBe("too-short-question");
	});

	it("returns too-short-question below the default minimum length", () => {
		expect(findAskAiCandidates([record()], "a").kind).toBe(
			"too-short-question",
		);
	});

	it("respects a custom minQuestionLength", () => {
		const records = [record({ title: "AI notes" })];
		expect(
			findAskAiCandidates(records, "ai", { minQuestionLength: 3 }).kind,
		).toBe("too-short-question");
		expect(findAskAiCandidates(records, "ai").kind).toBe("candidates");
	});
});

describe("findAskAiCandidates empty library", () => {
	it("returns empty-library when there are no records", () => {
		expect(findAskAiCandidates([], "typescript testing").kind).toBe(
			"empty-library",
		);
	});

	it("checks question length before library emptiness", () => {
		expect(findAskAiCandidates([], "a").kind).toBe("too-short-question");
	});
});

describe("findAskAiCandidates field weighting", () => {
	it("scores a title match above a description match", () => {
		const inTitle = record({
			id: "bm-title",
			canonicalUrl: "https://example.com/title",
			url: "https://example.com/title",
			title: "TypeScript guide",
		});
		const inDescription = record({
			id: "bm-desc",
			canonicalUrl: "https://example.com/desc",
			url: "https://example.com/desc",
			title: "Some article",
			description: "A long piece about TypeScript",
		});
		const candidates = candidatesOf(
			findAskAiCandidates([inDescription, inTitle], "typescript"),
		);
		expect(candidates.map((c) => c.id)).toEqual(["bm-title", "bm-desc"]);
		expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
	});

	it("scores a tag match above a description match", () => {
		const inTag = record({
			id: "bm-tag",
			canonicalUrl: "https://example.com/tag",
			url: "https://example.com/tag",
			tags: ["typescript"],
		});
		const inDescription = record({
			id: "bm-desc",
			canonicalUrl: "https://example.com/desc",
			url: "https://example.com/desc",
			description: "A long piece about TypeScript",
		});
		const candidates = candidatesOf(
			findAskAiCandidates([inDescription, inTag], "typescript"),
		);
		expect(candidates.map((c) => c.id)).toEqual(["bm-tag", "bm-desc"]);
	});

	it("scores a genre match above a description match", () => {
		const inGenre = record({
			id: "bm-genre",
			canonicalUrl: "https://example.com/genre",
			url: "https://example.com/genre",
			genre: "typescript",
		});
		const inDescription = record({
			id: "bm-desc",
			canonicalUrl: "https://example.com/desc",
			url: "https://example.com/desc",
			description: "A long piece about TypeScript",
		});
		const candidates = candidatesOf(
			findAskAiCandidates([inDescription, inGenre], "typescript"),
		);
		expect(candidates.map((c) => c.id)).toEqual(["bm-genre", "bm-desc"]);
	});

	it("accumulates score across multiple question tokens", () => {
		const both = record({
			id: "bm-both",
			canonicalUrl: "https://example.com/both",
			url: "https://example.com/both",
			title: "TypeScript testing handbook",
		});
		const one = record({
			id: "bm-one",
			canonicalUrl: "https://example.com/one",
			url: "https://example.com/one",
			title: "TypeScript intro",
		});
		const candidates = candidatesOf(
			findAskAiCandidates([one, both], "typescript testing"),
		);
		expect(candidates.map((c) => c.id)).toEqual(["bm-both", "bm-one"]);
	});

	it("deduplicates repeated question tokens before scoring", () => {
		const once = candidatesOf(
			findAskAiCandidates(
				[record({ title: "TypeScript guide" })],
				"typescript",
			),
		);
		const repeated = candidatesOf(
			findAskAiCandidates(
				[record({ title: "TypeScript guide" })],
				"typescript typescript",
			),
		);

		expect(repeated[0].score).toBe(once[0].score);
	});

	it("matches case-insensitively", () => {
		const result = findAskAiCandidates(
			[record({ title: "typescript guide" })],
			"TypeScript",
		);
		expect(result.kind).toBe("candidates");
	});

	it("matches the URL-derived domain", () => {
		const gh = record({
			id: "bm-gh",
			canonicalUrl: "https://github.com/foo/bar",
			url: "https://github.com/foo/bar",
			title: "Some repo",
		});
		const candidates = candidatesOf(findAskAiCandidates([gh], "github"));
		expect(candidates).toHaveLength(1);
		expect(candidates[0].domain).toBe("github.com");
		expect(candidates[0].matchedFields).toContain("domain");
	});
});

describe("findAskAiCandidates analysisMarkdown exclusion", () => {
	it("never matches on analysisMarkdown", () => {
		const result = findAskAiCandidates(
			[
				record({
					title: "Unrelated",
					analysisMarkdown: "# TypeScript deep dive\nAll about typescript.",
				}),
			],
			"typescript",
		);
		expect(result.kind).toBe("weak-candidates");
		expect(candidatesOf(result)).toHaveLength(0);
	});
});

describe("findAskAiCandidates result states", () => {
	it("returns candidates when at least one strong match exists", () => {
		const result = findAskAiCandidates(
			[record({ title: "TypeScript guide" })],
			"typescript",
		);
		expect(result.kind).toBe("candidates");
	});

	it("returns weak-candidates when only low-weight fields match", () => {
		const result = findAskAiCandidates(
			[record({ description: "mentions typescript briefly" })],
			"typescript",
		);
		expect(result.kind).toBe("weak-candidates");
		expect(candidatesOf(result)).toHaveLength(1);
	});

	it("returns weak-candidates with no entries when nothing matches", () => {
		const result = findAskAiCandidates(
			[record({ title: "Cooking recipes" })],
			"typescript",
		);
		expect(result.kind).toBe("weak-candidates");
		expect(candidatesOf(result)).toHaveLength(0);
	});
});

describe("findAskAiCandidates AI status eligibility", () => {
	it.each([
		"pending",
		"unavailable",
		"failed",
	] as const)("includes records with aiStatus %s", (aiStatus) => {
		const candidates = candidatesOf(
			findAskAiCandidates(
				[record({ title: "TypeScript guide", aiStatus })],
				"typescript",
			),
		);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].aiStatus).toBe(aiStatus);
	});
});

describe("findAskAiCandidates limit", () => {
	function manyMatching(count: number): BookmarkRecord[] {
		return Array.from({ length: count }, (_, i) =>
			record({
				id: `bm-${i}`,
				canonicalUrl: `https://example.com/${i}`,
				url: `https://example.com/${i}`,
				title: `TypeScript article ${i}`,
			}),
		);
	}

	it("caps candidates at 50 by default", () => {
		const candidates = candidatesOf(
			findAskAiCandidates(manyMatching(60), "typescript"),
		);
		expect(candidates).toHaveLength(50);
	});

	it("respects a custom limit", () => {
		const candidates = candidatesOf(
			findAskAiCandidates(manyMatching(60), "typescript", { limit: 10 }),
		);
		expect(candidates).toHaveLength(10);
	});

	it("clamps negative custom limits to zero candidates", () => {
		const result = findAskAiCandidates(manyMatching(3), "typescript", {
			limit: -1,
		});

		expect(result.kind).toBe("weak-candidates");
		expect(candidatesOf(result)).toHaveLength(0);
	});
});

describe("findAskAiCandidates deterministic ordering", () => {
	it("breaks score ties by most recently updated", () => {
		const older = record({
			id: "bm-old",
			canonicalUrl: "https://example.com/old",
			url: "https://example.com/old",
			title: "TypeScript old",
			updatedAt: "2026-06-25T00:00:00.000Z",
		});
		const newer = record({
			id: "bm-new",
			canonicalUrl: "https://example.com/new",
			url: "https://example.com/new",
			title: "TypeScript new",
			updatedAt: "2026-06-26T00:00:00.000Z",
		});
		const candidates = candidatesOf(
			findAskAiCandidates([older, newer], "typescript"),
		);
		expect(candidates.map((c) => c.id)).toEqual(["bm-new", "bm-old"]);
	});

	it("breaks full ties by canonical URL regardless of input order", () => {
		const a = record({
			id: "bm-a",
			canonicalUrl: "https://example.com/a",
			url: "https://example.com/a",
			title: "TypeScript a",
		});
		const b = record({
			id: "bm-b",
			canonicalUrl: "https://example.com/b",
			url: "https://example.com/b",
			title: "TypeScript b",
		});
		const forward = candidatesOf(findAskAiCandidates([a, b], "typescript"));
		const backward = candidatesOf(findAskAiCandidates([b, a], "typescript"));
		expect(forward.map((c) => c.id)).toEqual(["bm-a", "bm-b"]);
		expect(backward.map((c) => c.id)).toEqual(["bm-a", "bm-b"]);
	});
});

describe("findAskAiCandidates matched fields and fallback reasons", () => {
	it("reports matched fields in a stable order with a deterministic reason", () => {
		const candidates = candidatesOf(
			findAskAiCandidates(
				[
					record({
						title: "TypeScript guide",
						tags: ["typescript"],
						description: "All about typescript",
					}),
				],
				"typescript",
			),
		);
		expect(candidates[0].matchedFields).toEqual([
			"title",
			"tags",
			"description",
		]);
		expect(candidates[0].fallbackReason).toBe(
			"Matched title, tags, and description",
		);
	});

	it("formats single- and double-field reasons", () => {
		const single = candidatesOf(
			findAskAiCandidates(
				[record({ description: "about typescript" })],
				"typescript",
			),
		);
		expect(single[0].matchedFields).toEqual(["description"]);
		expect(single[0].fallbackReason).toBe("Matched description");

		const double = candidatesOf(
			findAskAiCandidates(
				[record({ title: "TypeScript guide", genre: "typescript" })],
				"typescript",
			),
		);
		expect(double[0].matchedFields).toEqual(["title", "genre"]);
		expect(double[0].fallbackReason).toBe("Matched title and genre");
	});
});

describe("findAskAiCandidates candidate shape", () => {
	it("carries compact lookup and display data", () => {
		const candidates = candidatesOf(
			findAskAiCandidates(
				[
					record({
						id: "bm-1",
						canonicalUrl: "https://example.com/a",
						url: "https://example.com/a",
						title: "TypeScript guide",
						description: "desc",
						genre: "tech",
						tags: ["ts"],
						aiStatus: "ready",
					}),
				],
				"typescript",
			),
		);
		const candidate = candidates[0];
		expect(candidate.id).toBe("bm-1");
		expect(candidate.canonicalUrl).toBe("https://example.com/a");
		expect(candidate.title).toBe("TypeScript guide");
		expect(candidate.domain).toBe("example.com");
		expect(candidate.description).toBe("desc");
		expect(candidate.genre).toBe("tech");
		expect(candidate.tags).toEqual(["ts"]);
		expect(candidate.aiStatus).toBe("ready");
		expect(candidate.score).toBeGreaterThan(0);
	});
});
