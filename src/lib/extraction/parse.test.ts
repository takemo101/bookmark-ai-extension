import { describe, expect, it } from "vitest";

import { parseExtractedPage } from "./parse";

describe("parseExtractedPage", () => {
	it("parses a full raw payload into a sanitized page", () => {
		const result = parseExtractedPage({
			url: "  https://example.com/a  ",
			title: "  Example   Title  ",
			canonicalUrl: "https://example.com/canonical",
			metaDescription: "A   description\nwith newlines",
			ogTitle: "OG Title",
			ogDescription: "OG Description",
			lang: "en",
			headings: ["First", { level: 2, text: "Second" }],
			mainText: ["Para one", "Para two"],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const page = result.value;
		expect(page.url).toBe("https://example.com/a");
		expect(page.title).toBe("Example Title");
		expect(page.canonicalUrl).toBe("https://example.com/canonical");
		expect(page.metaDescription).toBe("A description with newlines");
		expect(page.ogTitle).toBe("OG Title");
		expect(page.ogDescription).toBe("OG Description");
		expect(page.lang).toBe("en");
		expect(page.headings).toEqual([
			{ level: 1, text: "First" },
			{ level: 2, text: "Second" },
		]);
		expect(page.mainText).toEqual(["Para one", "Para two"]);
	});

	it("falls back to the url when the title is missing or blank", () => {
		const result = parseExtractedPage({
			url: "https://example.com",
			title: "   ",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.title).toBe("https://example.com");
	});

	it("defaults optional metadata to undefined / empty collections", () => {
		const result = parseExtractedPage({ url: "https://example.com" });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const page = result.value;
		expect(page.canonicalUrl).toBeUndefined();
		expect(page.metaDescription).toBeUndefined();
		expect(page.ogTitle).toBeUndefined();
		expect(page.ogDescription).toBeUndefined();
		expect(page.lang).toBeUndefined();
		expect(page.headings).toEqual([]);
		expect(page.mainText).toEqual([]);
	});

	it("rejects malformed payloads: non-object and missing url", () => {
		expect(parseExtractedPage(null).ok).toBe(false);
		expect(parseExtractedPage("not an object").ok).toBe(false);
		expect(parseExtractedPage(["array"]).ok).toBe(false);
		expect(parseExtractedPage({ title: "no url here" }).ok).toBe(false);
		expect(parseExtractedPage({ url: 42 }).ok).toBe(false);
		expect(parseExtractedPage({ url: "   " }).ok).toBe(false);
	});

	it("sanitizes malformed heading and main-text entries instead of failing", () => {
		const result = parseExtractedPage({
			url: "https://example.com",
			headings: [
				"  Kept  ",
				{ level: 99, text: "Clamped level" },
				{ level: "bad", text: "Coerced level" },
				{ text: "" }, // blank → dropped
				{ level: 1 }, // no text → dropped
				42, // not a heading → dropped
			],
			mainText: ["  keep this  ", "", 123, "  another  "],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.headings).toEqual([
			{ level: 1, text: "Kept" },
			{ level: 6, text: "Clamped level" },
			{ level: 1, text: "Coerced level" },
		]);
		expect(result.value.mainText).toEqual(["keep this", "another"]);
	});

	it("accepts a single string as main text", () => {
		const result = parseExtractedPage({
			url: "https://example.com",
			mainText: "  one   block  ",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.mainText).toEqual(["one block"]);
	});

	it("drops unknown extra fields such as a stray excerpt", () => {
		const result = parseExtractedPage({
			url: "https://example.com",
			excerpt: "should not survive",
			rawHtml: "<html>",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Object.keys(result.value)).not.toContain("excerpt");
		expect(Object.keys(result.value)).not.toContain("rawHtml");
	});
});
