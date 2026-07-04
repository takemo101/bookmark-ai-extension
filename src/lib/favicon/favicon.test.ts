import { afterEach, describe, expect, it } from "vitest";

import type { FaviconRuntime } from "./favicon";
import { faviconFallback, faviconView } from "./favicon";

/**
 * MIK-032: favicon URL construction and fallback derivation. The Chrome
 * runtime is injected (or stubbed on `globalThis`) so nothing here needs a
 * real extension environment.
 */

const runtime: FaviconRuntime = {
	getURL: (path) => `chrome-extension://abcdef${path}`,
};

afterEach(() => {
	delete (globalThis as { chrome?: unknown }).chrome;
});

describe("faviconView", () => {
	it("builds the _favicon URL with encoded pageUrl and size", () => {
		const view = faviconView("https://example.test/a?b=c", {
			size: 24,
			runtime,
		});

		expect(view.src).toBe(
			"chrome-extension://abcdef/_favicon/?pageUrl=https%3A%2F%2Fexample.test%2Fa%3Fb%3Dc&size=24",
		);
		expect(view.fallback).toBe("E");
	});

	it("defaults the size to 32", () => {
		const view = faviconView("https://example.test/", { runtime });

		expect(view.src).toContain("&size=32");
	});

	it("returns fallback-only without a Chrome runtime", () => {
		const view = faviconView("https://example.test/");

		expect(view.src).toBeUndefined();
		expect(view.fallback).toBe("E");
	});

	it("reads a chrome.runtime.getURL global when present", () => {
		(globalThis as { chrome?: unknown }).chrome = {
			runtime: { getURL: (path: string) => `chrome-extension://xyz${path}` },
		};

		const view = faviconView("https://example.test/");

		expect(view.src).toBe(
			"chrome-extension://xyz/_favicon/?pageUrl=https%3A%2F%2Fexample.test%2F&size=32",
		);
	});

	it("survives a chrome global without runtime.getURL", () => {
		(globalThis as { chrome?: unknown }).chrome = { runtime: {} };

		const view = faviconView("https://example.test/");

		expect(view.src).toBeUndefined();
		expect(view.fallback).toBe("E");
	});

	it("returns fallback-only for an invalid URL even with a runtime", () => {
		const view = faviconView("not a url", { runtime });

		expect(view.src).toBeUndefined();
		expect(view.fallback).toBe("•");
	});
});

describe("faviconFallback", () => {
	it("uses the uppercased hostname initial", () => {
		expect(faviconFallback("https://github.com/owner/repo")).toBe("G");
	});

	it("ignores a leading www.", () => {
		expect(faviconFallback("https://www.example.test/")).toBe("E");
	});

	it("falls back to a neutral glyph for invalid URLs", () => {
		expect(faviconFallback("::::")).toBe("•");
	});

	it("falls back to a neutral glyph for hostless URLs", () => {
		expect(faviconFallback("file:///tmp/x")).toBe("•");
	});
});
