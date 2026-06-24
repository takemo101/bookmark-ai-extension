import { describe, expect, it } from "vitest";

import { canonicalizeUrl, parseBookmarkUrl, parseCanonicalUrl } from "./url";

function canonical(url: string): string {
	const result = canonicalizeUrl(url);
	if (!result.ok) {
		throw new Error(`expected ok, got: ${result.error.message}`);
	}
	return result.value;
}

describe("canonicalizeUrl", () => {
	it("lowercases scheme and host", () => {
		expect(canonical("HTTPS://Example.COM/Path")).toBe(
			"https://example.com/Path",
		);
	});

	it("strips a leading www.", () => {
		expect(canonical("https://www.example.com/a")).toBe(
			"https://example.com/a",
		);
	});

	it("removes default ports", () => {
		expect(canonical("http://example.com:80/a")).toBe("http://example.com/a");
		expect(canonical("https://example.com:443/a")).toBe(
			"https://example.com/a",
		);
	});

	it("keeps non-default ports", () => {
		expect(canonical("https://example.com:8443/a")).toBe(
			"https://example.com:8443/a",
		);
	});

	it("drops the fragment", () => {
		expect(canonical("https://example.com/a#section")).toBe(
			"https://example.com/a",
		);
	});

	it("removes tracking query params", () => {
		expect(
			canonical(
				"https://example.com/a?utm_source=x&utm_medium=y&id=42&fbclid=z",
			),
		).toBe("https://example.com/a?id=42");
	});

	it("sorts remaining query params for stable ordering", () => {
		expect(canonical("https://example.com/a?b=2&a=1")).toBe(
			"https://example.com/a?a=1&b=2",
		);
	});

	it("removes a trailing slash from non-root paths but keeps root", () => {
		expect(canonical("https://example.com/a/b/")).toBe(
			"https://example.com/a/b",
		);
		expect(canonical("https://example.com/")).toBe("https://example.com/");
	});

	it("treats tracking-only and clean URLs as the same key", () => {
		expect(canonical("https://example.com/a?utm_source=newsletter")).toBe(
			canonical("https://example.com/a"),
		);
	});

	it("rejects non-http(s) URLs", () => {
		const result = canonicalizeUrl("ftp://example.com/a");
		expect(result.ok).toBe(false);
	});

	it("rejects malformed URLs", () => {
		expect(canonicalizeUrl("not a url").ok).toBe(false);
		expect(canonicalizeUrl("").ok).toBe(false);
		expect(canonicalizeUrl(42).ok).toBe(false);
	});
});

describe("parseBookmarkUrl", () => {
	it("preserves the visited URL (only normalizing via the URL parser)", () => {
		const result = parseBookmarkUrl("https://example.com/a?b=2&a=1#frag");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("https://example.com/a?b=2&a=1#frag");
		}
	});

	it("rejects non-http(s) and malformed values", () => {
		expect(parseBookmarkUrl("javascript:alert(1)").ok).toBe(false);
		expect(parseBookmarkUrl("   ").ok).toBe(false);
	});
});

describe("parseCanonicalUrl", () => {
	it("accepts a valid stored canonical URL", () => {
		const result = parseCanonicalUrl("https://example.com/a");
		expect(result.ok).toBe(true);
	});

	it("rejects an invalid stored canonical URL", () => {
		expect(parseCanonicalUrl("nope").ok).toBe(false);
	});
});
