import { describe, expect, it } from "vitest";

import type {
	AskAiKeywordExtractionPrompt,
	AskAiRecommendationPrompt,
} from "../lib/ai/index";
import {
	type BookmarkRecord,
	parseBookmarkRecord,
} from "../lib/bookmarks/index";
import { type AskAiDeps, createAskAiController } from "./ask-ai-view-model";

/**
 * Controller tests for the Ask AI screen: the MIK-045 in-memory question state
 * plus the MIK-046 recommendation flow — local candidate scoring over ALL
 * cached bookmarks (never a filtered view), Prompt API prompt/parse through an
 * injected runner, local deterministic fallback cards, and safe statuses for
 * too-short / empty-library / weak-candidate questions. Chat state stays in
 * memory only: the deps expose no persistence surface at all.
 */

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

function fakeDeps(
	options: {
		records?: readonly BookmarkRecord[];
		output?: string;
		runError?: Error;
		loadError?: Error;
		/** Raw keyword-extraction model output; empty (unparseable) by default. */
		extractionOutput?: string;
		extractionError?: Error;
		language?: "en" | "ja";
	} = {},
) {
	const promptCalls: AskAiRecommendationPrompt[] = [];
	const extractionCalls: AskAiKeywordExtractionPrompt[] = [];
	let loadCalls = 0;
	const deps: AskAiDeps = {
		async loadBookmarks() {
			if (options.loadError) throw options.loadError;
			loadCalls += 1;
			return options.records ?? [];
		},
		async runKeywordExtractionPrompt(request) {
			extractionCalls.push(request);
			if (options.extractionError) throw options.extractionError;
			return options.extractionOutput ?? "";
		},
		async runRecommendationPrompt(request) {
			promptCalls.push(request);
			if (options.runError) throw options.runError;
			return options.output ?? "";
		},
		language: options.language ?? "en",
	};
	return {
		deps,
		promptCalls,
		extractionCalls,
		loadCalls: () => loadCalls,
	};
}

function extractionOutput(keywords: readonly string[]): string {
	return JSON.stringify({ keywords });
}

function aiOutput(
	recommendations: readonly { id: string; reason: string }[],
	message = "Here are your matches.",
): string {
	return JSON.stringify({ message, recommendations });
}

describe("Ask AI view model question state (MIK-045)", () => {
	it("starts with an empty, non-submittable, idle view without a result", () => {
		const controller = createAskAiController(fakeDeps().deps);

		expect(controller.getView()).toEqual({
			question: "",
			canSubmit: false,
			answering: false,
		});
	});

	it("updates the question and allows submit at the minimum trimmed length", () => {
		const controller = createAskAiController(fakeDeps().deps);

		controller.setQuestion("   a   ");
		expect(controller.getView().canSubmit).toBe(false);

		controller.setQuestion("  ab ");
		expect(controller.getView().question).toBe("  ab ");
		expect(controller.getView().canSubmit).toBe(true);
	});

	it("fills the question from a chosen example prompt", () => {
		const controller = createAskAiController(fakeDeps().deps);

		controller.useExample("Find saved bookmarks about TypeScript testing");

		expect(controller.getView().question).toBe(
			"Find saved bookmarks about TypeScript testing",
		);
		expect(controller.getView().canSubmit).toBe(true);
	});

	it("notifies subscribers on question changes and stops after unsubscribe", () => {
		const controller = createAskAiController(fakeDeps().deps);
		let notified = 0;
		const unsubscribe = controller.subscribe(() => {
			notified += 1;
		});

		controller.setQuestion("chrome extensions");
		expect(notified).toBe(1);

		unsubscribe();
		controller.setQuestion("something else");
		expect(notified).toBe(1);
	});
});

describe("Ask AI safe statuses without AI calls (MIK-046)", () => {
	it("reports too-short-question and never calls the Prompt API", async () => {
		const { deps, promptCalls } = fakeDeps({ records: [record()] });
		const controller = createAskAiController(deps);

		controller.setQuestion("a");
		await controller.submit();

		expect(controller.getView().result).toEqual({
			kind: "too-short-question",
		});
		expect(controller.getView().askedQuestion).toBe("a");
		expect(controller.getView().answering).toBe(false);
		expect(promptCalls).toHaveLength(0);
	});

	it("reports empty-library and never calls the Prompt API", async () => {
		const { deps, promptCalls } = fakeDeps({ records: [] });
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript testing");
		await controller.submit();

		expect(controller.getView().result).toEqual({ kind: "empty-library" });
		expect(promptCalls).toHaveLength(0);
	});

	it("asks for clarification on weak candidates and never calls the Prompt API", async () => {
		// A description-only token match scores 2, below the strong threshold.
		const { deps, promptCalls } = fakeDeps({
			records: [record({ description: "mentions typescript once" })],
		});
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript");
		await controller.submit();

		expect(controller.getView().result).toEqual({ kind: "weak-candidates" });
		expect(promptCalls).toHaveLength(0);
	});

	it("reports a safe error when the cached library cannot be read", async () => {
		const { deps } = fakeDeps({ loadError: new Error("cache broke") });
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript testing");
		await controller.submit();

		expect(controller.getView().result).toEqual({ kind: "error" });
		expect(controller.getView().answering).toBe(false);
	});
});

describe("Ask AI recommendation success (MIK-046)", () => {
	const records = [
		record({
			id: "bm-ts",
			canonicalUrl: "https://ts.test/handbook",
			url: "https://ts.test/handbook",
			title: "TypeScript testing handbook",
			tags: ["typescript"],
		}),
		record({
			id: "bm-other",
			canonicalUrl: "https://other.test/x",
			url: "https://other.test/x",
			title: "Unrelated bookmark",
		}),
	];

	it("maps valid AI recommendation ids back to app-owned bookmark cards", async () => {
		const { deps } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts", reason: "Covers exactly this." }]),
		});
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript testing");
		await controller.submit();

		const result = controller.getView().result;
		expect(result).toMatchObject({
			kind: "recommendations",
			source: "ai",
			message: "Here are your matches.",
		});
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.cards).toHaveLength(1);
		expect(result.cards[0]).toMatchObject({
			canonicalUrl: "https://ts.test/handbook",
			title: "TypeScript testing handbook",
			domain: "ts.test",
			reason: "Covers exactly this.",
		});
	});

	it("sends only compact candidate data to the runner — never full URLs", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript testing");
		await controller.submit();

		expect(promptCalls).toHaveLength(1);
		expect(promptCalls[0].prompt).toContain("typescript testing");
		expect(promptCalls[0].prompt).toContain("bm-ts");
		expect(promptCalls[0].prompt).not.toContain("https://ts.test/handbook");
	});

	it("flips answering on during the AI call and blocks a duplicate submit", async () => {
		let release: (value: string) => void = () => {};
		const pending = new Promise<string>((resolve) => {
			release = resolve;
		});
		const promptCalls: AskAiRecommendationPrompt[] = [];
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return records;
			},
			async runKeywordExtractionPrompt() {
				return "";
			},
			runRecommendationPrompt(request) {
				promptCalls.push(request);
				return pending;
			},
			language: "en",
		};
		const controller = createAskAiController(deps);
		controller.setQuestion("typescript testing");

		const submitted = controller.submit();
		expect(controller.getView().answering).toBe(true);
		expect(controller.getView().canSubmit).toBe(false);

		// A second submit while in flight is dropped, not queued.
		await controller.submit();

		release(aiOutput([{ id: "bm-ts", reason: "Match." }]));
		await submitted;
		// Only the first submit ran a recommendation prompt.
		expect(promptCalls).toHaveLength(1);
		expect(controller.getView().answering).toBe(false);
		expect(controller.getView().result?.kind).toBe("recommendations");
	});

	it("scores every cached record from loadBookmarks — Library filters play no part", async () => {
		// Both strong matches surface even though a Library filter would have
		// excluded one: the controller's only data source is the full cache
		// snapshot, and it takes no filter input at all.
		const { deps, loadCalls } = fakeDeps({
			records: [
				record({
					id: "bm-1",
					canonicalUrl: "https://a.test/1",
					url: "https://a.test/1",
					title: "typescript patterns",
					genre: "技術",
				}),
				record({
					id: "bm-2",
					canonicalUrl: "https://b.test/2",
					url: "https://b.test/2",
					title: "typescript recipes",
					genre: "料理",
				}),
			],
			runError: new Error("ai down"),
		});
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript");
		await controller.submit();

		expect(loadCalls()).toBe(1);
		const result = controller.getView().result;
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.cards.map((c) => c.canonicalUrl).sort()).toEqual([
			"https://a.test/1",
			"https://b.test/2",
		]);
	});
});

describe("Ask AI local fallback (MIK-046)", () => {
	const strongRecords = Array.from({ length: 7 }, (_, i) =>
		record({
			id: `bm-${i + 1}`,
			canonicalUrl: `https://site-${i + 1}.test/a`,
			url: `https://site-${i + 1}.test/a`,
			title: `typescript notes ${i + 1}`,
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: `2026-06-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
		}),
	);

	async function submitFor(options: {
		output?: string;
		runError?: Error;
	}): Promise<ReturnType<ReturnType<typeof createAskAiController>["getView"]>> {
		const { deps } = fakeDeps({ records: strongRecords, ...options });
		const controller = createAskAiController(deps);
		controller.setQuestion("typescript");
		await controller.submit();
		return controller.getView();
	}

	it("falls back to at most 5 local cards with deterministic reasons when the runner throws", async () => {
		const view = await submitFor({ runError: new Error("prompt api down") });

		const result = view.result;
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.source).toBe("local");
		expect(result.cards).toHaveLength(5);
		expect(result.cards[0].reason).toBe("Matched title");
		// Best-first: most recently updated strong match leads.
		expect(result.cards[0].canonicalUrl).toBe("https://site-7.test/a");
	});

	it("falls back to local cards when the AI output cannot be parsed", async () => {
		const view = await submitFor({ output: "sorry, no JSON here" });

		expect(view.result).toMatchObject({
			kind: "recommendations",
			source: "local",
		});
	});

	it("localizes local fallback reasons for the Japanese UI language", async () => {
		const { deps } = fakeDeps({
			records: [
				record({
					id: "bm-ja",
					canonicalUrl: "https://ja.test/a",
					url: "https://ja.test/a",
					title: "typescript handbook",
					tags: ["typescript"],
				}),
			],
			runError: new Error("prompt api down"),
			language: "ja",
		});
		const controller = createAskAiController(deps);
		controller.setQuestion("typescript");

		await controller.submit();

		const result = controller.getView().result;
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.source).toBe("local");
		expect(result.cards[0].reason).toBe("タイトル、タグに一致しました");
	});

	it("falls back to local cards when the AI returns only unknown ids", async () => {
		const view = await submitFor({
			output: aiOutput([{ id: "hallucinated-id", reason: "nope" }]),
		});

		expect(view.result).toMatchObject({
			kind: "recommendations",
			source: "local",
		});
	});
});

describe("Ask AI keyword extraction expands retrieval (MIK-047)", () => {
	const japaneseRecords = [
		record({
			id: "bm-test-design",
			canonicalUrl: "https://ja.test/test-design",
			url: "https://ja.test/test-design",
			title: "テスト設計の基礎",
		}),
	];
	const japaneseQuestion = "前に読んだ、テスト設計で参考になりそうなやつ";

	const englishRecords = [
		record({
			id: "bm-testing",
			canonicalUrl: "https://en.test/testing",
			url: "https://en.test/testing",
			title: "Unit testing strategies",
		}),
	];
	const englishQuestion = "which bookmark helps me design good checks?";

	it("turns a weak Japanese natural-language question into AI recommendations via extracted keywords", async () => {
		const { deps, extractionCalls, promptCalls } = fakeDeps({
			records: japaneseRecords,
			extractionOutput: extractionOutput(["テスト設計", "テスト"]),
			output: aiOutput([
				{ id: "bm-test-design", reason: "テスト設計の本です。" },
			]),
			language: "ja",
		});
		const controller = createAskAiController(deps);

		controller.setQuestion(japaneseQuestion);
		await controller.submit();

		expect(extractionCalls).toHaveLength(1);
		expect(promptCalls).toHaveLength(1);
		const result = controller.getView().result;
		expect(result).toMatchObject({ kind: "recommendations", source: "ai" });
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.cards[0].canonicalUrl).toBe("https://ja.test/test-design");
	});

	it("turns a weak English natural-language question into AI recommendations via extracted keywords", async () => {
		const { deps, promptCalls } = fakeDeps({
			records: englishRecords,
			extractionOutput: extractionOutput(["testing", "test design"]),
			output: aiOutput([{ id: "bm-testing", reason: "Covers test design." }]),
		});
		const controller = createAskAiController(deps);

		controller.setQuestion(englishQuestion);
		await controller.submit();

		expect(promptCalls).toHaveLength(1);
		const result = controller.getView().result;
		expect(result).toMatchObject({ kind: "recommendations", source: "ai" });
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.cards[0].canonicalUrl).toBe("https://en.test/testing");
	});

	it("sends only the question to the extraction prompt — never bookmark data", async () => {
		const { deps, extractionCalls } = fakeDeps({
			records: japaneseRecords,
			extractionOutput: extractionOutput(["テスト設計"]),
			output: aiOutput([{ id: "bm-test-design", reason: "合います。" }]),
			language: "ja",
		});
		const controller = createAskAiController(deps);

		controller.setQuestion(japaneseQuestion);
		await controller.submit();

		expect(extractionCalls).toHaveLength(1);
		const sent = JSON.stringify(extractionCalls[0]);
		expect(sent).toContain(japaneseQuestion);
		expect(sent).not.toContain("テスト設計の基礎");
		expect(sent).not.toContain("https://ja.test/test-design");
		expect(sent).not.toContain("bm-test-design");
	});

	it("falls back to weak-candidates when extraction throws (Prompt API unavailable)", async () => {
		const { deps, promptCalls } = fakeDeps({
			records: japaneseRecords,
			extractionError: new Error("prompt api down"),
			language: "ja",
		});
		const controller = createAskAiController(deps);

		controller.setQuestion(japaneseQuestion);
		await controller.submit();

		expect(controller.getView().result).toEqual({ kind: "weak-candidates" });
		expect(promptCalls).toHaveLength(0);
	});

	it("falls back to direct scoring when extraction output is malformed", async () => {
		const { deps, promptCalls } = fakeDeps({
			records: japaneseRecords,
			extractionOutput: "sorry, no JSON here",
			language: "ja",
		});
		const controller = createAskAiController(deps);

		controller.setQuestion(japaneseQuestion);
		await controller.submit();

		expect(controller.getView().result).toEqual({ kind: "weak-candidates" });
		expect(promptCalls).toHaveLength(0);
	});

	it("falls back to direct scoring when extraction returns no keywords", async () => {
		const { deps, promptCalls } = fakeDeps({
			records: japaneseRecords,
			extractionOutput: extractionOutput([]),
			language: "ja",
		});
		const controller = createAskAiController(deps);

		controller.setQuestion(japaneseQuestion);
		await controller.submit();

		expect(controller.getView().result).toEqual({ kind: "weak-candidates" });
		expect(promptCalls).toHaveLength(0);
	});

	it("still recommends from direct strong matches when extraction fails", async () => {
		const { deps, promptCalls } = fakeDeps({
			records: [
				record({
					id: "bm-ts",
					canonicalUrl: "https://ts.test/handbook",
					url: "https://ts.test/handbook",
					title: "TypeScript testing handbook",
				}),
			],
			extractionError: new Error("prompt api down"),
			output: aiOutput([{ id: "bm-ts", reason: "Direct match." }]),
		});
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript testing");
		await controller.submit();

		expect(promptCalls).toHaveLength(1);
		expect(controller.getView().result).toMatchObject({
			kind: "recommendations",
			source: "ai",
		});
	});

	it("never calls extraction for too-short questions or an empty library", async () => {
		const tooShort = fakeDeps({ records: japaneseRecords });
		const shortController = createAskAiController(tooShort.deps);
		shortController.setQuestion("a");
		await shortController.submit();
		expect(tooShort.extractionCalls).toHaveLength(0);

		const empty = fakeDeps({ records: [] });
		const emptyController = createAskAiController(empty.deps);
		emptyController.setQuestion("typescript testing");
		await emptyController.submit();
		expect(empty.extractionCalls).toHaveLength(0);
	});
});
