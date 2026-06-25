import { describe, expect, it, vi } from "vitest";

import type { RawExtractedPage } from "../extraction/types";
import {
	type ActiveTabResolver,
	type ScriptInjector,
	createChromeScriptingExtractor,
} from "./chrome-extractor";

/**
 * The Chrome scripting extractor is exercised with fake `scripting`/active-tab
 * dependencies — no real `chrome` global, no real page. The point is to pin the
 * permission posture (inject only into a granted tab) and the parse-at-the-
 * boundary contract.
 */

const URL = "https://example.test/article";

const RAW: RawExtractedPage = {
	url: URL,
	title: "Article",
	headings: [{ level: 1, text: "Heading" }],
	mainText: ["Body paragraph."],
};

function fakeScripting(
	result: RawExtractedPage | null | undefined,
): ScriptInjector & { calls: Array<{ tabId: number }> } {
	const calls: Array<{ tabId: number }> = [];
	return {
		calls,
		async executeScript(args) {
			calls.push({ tabId: args.target.tabId });
			return [{ result }];
		},
	};
}

describe("createChromeScriptingExtractor", () => {
	it("injects into the explicit save target tab and parses the result", async () => {
		const scripting = fakeScripting(RAW);
		const extractor = createChromeScriptingExtractor({
			scripting,
			resolveActiveTab: async () => undefined,
		});

		const result = await extractor.extract({ url: URL, title: "Article", tabId: 7 });

		expect(scripting.calls).toEqual([{ tabId: 7 }]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.url).toBe(URL);
			expect(result.value.title).toBe("Article");
			expect(result.value.mainText).toEqual(["Body paragraph."]);
		}
	});

	it("re-analyze: injects into the active tab only when its URL matches", async () => {
		const scripting = fakeScripting(RAW);
		const resolveActiveTab: ActiveTabResolver = async () => ({ id: 42, url: URL });
		const extractor = createChromeScriptingExtractor({ scripting, resolveActiveTab });

		const result = await extractor.extract({ url: URL, title: "Article" });

		expect(scripting.calls).toEqual([{ tabId: 42 }]);
		expect(result.ok).toBe(true);
	});

	it("re-analyze: refuses to inject when the active tab is a different page", async () => {
		const scripting = fakeScripting(RAW);
		const extractor = createChromeScriptingExtractor({
			scripting,
			resolveActiveTab: async () => ({ id: 42, url: "https://other.test/x" }),
		});

		const result = await extractor.extract({ url: URL, title: "Article" });

		expect(scripting.calls).toEqual([]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.field).toBe("tab");
		}
	});

	it("returns a typed error when injection throws (restricted page / closed tab)", async () => {
		const scripting: ScriptInjector = {
			async executeScript() {
				throw new Error("Cannot access contents of the page");
			},
		};
		const extractor = createChromeScriptingExtractor({
			scripting,
			resolveActiveTab: async () => undefined,
		});

		const result = await extractor.extract({ url: URL, title: "Article", tabId: 1 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.field).toBe("page");
			// No raw cause / page text leaks into the message.
			expect(result.error.message).not.toContain("Cannot access");
		}
	});

	it("returns a typed error when the page yields no result", async () => {
		const extractor = createChromeScriptingExtractor({
			scripting: fakeScripting(null),
			resolveActiveTab: async () => undefined,
		});

		const result = await extractor.extract({ url: URL, title: "Article", tabId: 1 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.field).toBe("page");
		}
	});

	it("falls back to a typed error when chrome.scripting is unavailable", async () => {
		const extractor = createChromeScriptingExtractor({
			scripting: undefined,
			resolveActiveTab: async () => ({ id: 1, url: URL }),
		});

		const result = await extractor.extract({ url: URL, title: "Article", tabId: 1 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.field).toBe("scripting");
		}
	});

	it("passes the self-contained extractor function to executeScript", async () => {
		const executeScript = vi.fn(
			async (_args: {
				target: { tabId: number };
				func: () => RawExtractedPage;
			}) => [{ result: RAW }],
		);
		const extractor = createChromeScriptingExtractor({
			scripting: { executeScript },
			resolveActiveTab: async () => undefined,
		});

		await extractor.extract({ url: URL, title: "Article", tabId: 3 });

		const arg = executeScript.mock.calls[0]?.[0];
		expect(typeof arg?.func).toBe("function");
		expect(arg?.target).toEqual({ tabId: 3 });
	});
});
