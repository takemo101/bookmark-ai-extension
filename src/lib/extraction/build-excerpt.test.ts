import { describe, expect, it } from "vitest";

import {
	parseBookmarkRecord,
	serializeBookmarkRecord,
} from "../bookmarks/index";
import { DEFAULT_EXCERPT_CHAR_CAP, buildExcerpt } from "./build-excerpt";
import { parseExtractedPage } from "./parse";
import type { ExtractedPage } from "./types";

function page(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
	return {
		url: "https://example.com/page",
		title: "Example Title",
		canonicalUrl: "https://example.com/canonical",
		metaDescription: "Meta description",
		ogTitle: "OG Title",
		ogDescription: "OG Description",
		lang: "en",
		headings: [
			{ level: 1, text: "Heading One" },
			{ level: 2, text: "Heading Two" },
		],
		mainText: ["First paragraph.", "Second paragraph."],
		...overrides,
	};
}

describe("buildExcerpt ordering", () => {
	it("emits sections in priority order", () => {
		const { text } = buildExcerpt(page());

		const order = [
			"Title: Example Title",
			"URL: https://example.com/canonical",
			"Description: Meta description",
			"OG Title: OG Title",
			"OG Description: OG Description",
			"Headings:",
			"Content:",
		];

		let previous = -1;
		for (const marker of order) {
			const index = text.indexOf(marker);
			expect(index, `section "${marker}" present`).toBeGreaterThan(-1);
			expect(index, `section "${marker}" after previous`).toBeGreaterThan(
				previous,
			);
			previous = index;
		}

		expect(text).toContain("- Heading One");
		expect(text).toContain("First paragraph.");
	});

	it("uses the page url when no canonical url is present", () => {
		const { text } = buildExcerpt(page({ canonicalUrl: undefined }));
		expect(text).toContain("URL: https://example.com/page");
	});
});

describe("buildExcerpt missing metadata", () => {
	it("omits absent sections without leaving empty labels", () => {
		const { text } = buildExcerpt(
			page({
				metaDescription: undefined,
				ogTitle: undefined,
				ogDescription: undefined,
				headings: [],
				mainText: [],
			}),
		);

		expect(text).toContain("Title: Example Title");
		expect(text).toContain("URL: https://example.com/canonical");
		expect(text).not.toContain("Description:");
		expect(text).not.toContain("OG Title:");
		expect(text).not.toContain("Headings:");
		expect(text).not.toContain("Content:");
	});

	it("reports not truncated when everything fits", () => {
		const excerpt = buildExcerpt(page());
		expect(excerpt.truncated).toBe(false);
		expect(excerpt.length).toBeLessThanOrEqual(DEFAULT_EXCERPT_CHAR_CAP);
		expect(excerpt.length).toBe(excerpt.text.length);
	});
});

describe("buildExcerpt truncation", () => {
	it("enforces the cap deterministically on long pages", () => {
		const huge = "x".repeat(50_000);
		const excerpt = buildExcerpt(page({ mainText: [huge] }));

		expect(excerpt.truncated).toBe(true);
		expect(excerpt.text.length).toBe(DEFAULT_EXCERPT_CHAR_CAP);
		expect(excerpt.length).toBe(DEFAULT_EXCERPT_CHAR_CAP);
		expect(excerpt.cap).toBe(DEFAULT_EXCERPT_CHAR_CAP);
	});

	it("honors a custom cap and never exceeds it", () => {
		const excerpt = buildExcerpt(page(), { maxChars: 40 });
		expect(excerpt.cap).toBe(40);
		expect(excerpt.text.length).toBeLessThanOrEqual(40);
		expect(excerpt.truncated).toBe(true);
		// Highest-priority section (title) survives a tight cap.
		expect(excerpt.text.startsWith("Title: Example Title")).toBe(true);
	});

	it("is deterministic: identical input yields identical output", () => {
		const blocks = Array.from(
			{ length: 2000 },
			(_, i) => `paragraph number ${i}`,
		);
		const a = buildExcerpt(page({ mainText: blocks }));
		const b = buildExcerpt(page({ mainText: blocks }));
		expect(a).toEqual(b);
		expect(a.text.length).toBe(DEFAULT_EXCERPT_CHAR_CAP);
	});

	it("produces empty text for a non-positive cap", () => {
		const excerpt = buildExcerpt(page(), { maxChars: 0 });
		expect(excerpt.text).toBe("");
		expect(excerpt.truncated).toBe(true);
	});
});

describe("no raw excerpt persistence", () => {
	it("never lets extracted text reach a BookmarkRecord", () => {
		const parsed = parseExtractedPage({
			url: "https://example.com/page",
			title: "Example Title",
			mainText: ["secret visible body text"],
		});
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const excerpt = buildExcerpt(parsed.value);
		expect(excerpt.text).toContain("secret visible body text");

		// Even if a caller tried to smuggle the excerpt/mainText into a record,
		// the bookmark parser only keeps known fields and drops them.
		const record = parseBookmarkRecord({
			schemaVersion: 1,
			id: "rec-1",
			url: "https://example.com/page",
			canonicalUrl: "https://example.com/page",
			title: "Example Title",
			tags: [],
			aiStatus: "pending",
			createdAt: "2026-06-25T00:00:00.000Z",
			updatedAt: "2026-06-25T00:00:00.000Z",
			excerpt: excerpt.text,
			mainText: parsed.value.mainText,
		});

		expect(record.ok).toBe(true);
		if (!record.ok) return;

		const keys = Object.keys(record.value);
		expect(keys).not.toContain("excerpt");
		expect(keys).not.toContain("mainText");

		const serialized = serializeBookmarkRecord(record.value);
		const wire = JSON.stringify(serialized);
		expect(wire).not.toContain("secret visible body text");
		expect(wire).not.toContain("excerpt");
		expect(wire).not.toContain("mainText");
	});
});
