import { afterEach, describe, expect, it } from "vitest";

import type {
	AskAiKeywordExtractionPrompt,
	AskAiRecommendationPrompt,
} from "../lib/ai/index";
import { createMemoryLogger } from "../lib/logging/index";
import {
	type BookmarkRecord,
	parseBookmarkRecord,
} from "../lib/bookmarks/index";
import {
	type AskAiChatMessage,
	type AskAiController,
	type AskAiDeps,
	type AskAiPromptSession,
	type AskAiResultView,
	createAskAiController,
	isAskAiComposerSubmitKey,
} from "./ask-ai-view-model";

/**
 * Controller tests for the Ask AI screen: the MIK-045 in-memory question state,
 * the MIK-046 recommendation flow — local candidate scoring over ALL cached
 * bookmarks (never a filtered view), Prompt API prompt/parse through an
 * injected runner, local deterministic fallback cards, and safe statuses for
 * too-short / empty-library / weak-candidate questions — and the MIK-048 chat
 * session: transcript turns, a volatile per-chat Prompt API session, hybrid
 * follow-up retrieval, and clear-session as the explicit hard reset. Chat state
 * stays in memory only: the deps expose no persistence surface at all.
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
		/** Per-call recommendation outputs, used in order before `output`. */
		outputs?: readonly string[];
		runError?: Error;
		loadError?: Error;
		/** Raw keyword-extraction model output; empty (unparseable) by default. */
		extractionOutput?: string;
		extractionError?: Error;
		logger?: ReturnType<typeof createMemoryLogger>;
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
			return options.outputs?.[promptCalls.length - 1] ?? options.output ?? "";
		},
		logger: options.logger,
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

function quotaExceededError(): Error {
	return Object.assign(new Error("prompt too large"), {
		name: "QuotaExceededError",
		requested: 30_000,
		contextWindow: 20_000,
	});
}

/** The latest assistant turn's result, mirroring what the UI renders last. */
function lastResult(controller: AskAiController): AskAiResultView | undefined {
	const messages = controller.getView().messages;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.role === "assistant") {
			return message.result;
		}
	}
	return undefined;
}

function userTexts(controller: AskAiController): string[] {
	return controller
		.getView()
		.messages.filter(
			(message): message is Extract<AskAiChatMessage, { role: "user" }> =>
				message.role === "user",
		)
		.map((message) => message.text);
}

async function ask(controller: AskAiController, question: string) {
	controller.setQuestion(question);
	await controller.submit();
}

describe("Ask AI view model question state (MIK-045)", () => {
	it("starts with an empty, non-submittable, idle view without messages", () => {
		const controller = createAskAiController(fakeDeps().deps);

		expect(controller.getView()).toEqual({
			question: "",
			canSubmit: false,
			answering: false,
			messages: [],
			canClear: false,
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

describe("Ask AI composer submit key (MIK-048)", () => {
	it("sends on plain Enter", () => {
		expect(isAskAiComposerSubmitKey({ key: "Enter", shiftKey: false })).toBe(
			true,
		);
	});

	it("inserts a newline (does not send) on Shift+Enter", () => {
		expect(isAskAiComposerSubmitKey({ key: "Enter", shiftKey: true })).toBe(
			false,
		);
	});

	it("never sends while composing with an IME", () => {
		expect(
			isAskAiComposerSubmitKey({
				key: "Enter",
				shiftKey: false,
				isComposing: true,
			}),
		).toBe(false);
	});

	it("ignores non-Enter keys", () => {
		expect(isAskAiComposerSubmitKey({ key: "a", shiftKey: false })).toBe(false);
	});
});

describe("Ask AI safe statuses without AI calls (MIK-046)", () => {
	it("reports too-short-question and never calls the Prompt API", async () => {
		const { deps, promptCalls } = fakeDeps({ records: [record()] });
		const controller = createAskAiController(deps);

		await ask(controller, "a");

		expect(lastResult(controller)).toEqual({ kind: "too-short-question" });
		expect(userTexts(controller)).toEqual(["a"]);
		expect(controller.getView().answering).toBe(false);
		expect(promptCalls).toHaveLength(0);
	});

	it("reports empty-library and never calls the Prompt API", async () => {
		const { deps, promptCalls } = fakeDeps({ records: [] });
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		expect(lastResult(controller)).toEqual({ kind: "empty-library" });
		expect(promptCalls).toHaveLength(0);
	});

	it("asks for clarification on weak candidates and never calls the Prompt API", async () => {
		// A description-only token match scores 2, below the strong threshold.
		const { deps, promptCalls } = fakeDeps({
			records: [record({ description: "mentions typescript once" })],
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");

		expect(lastResult(controller)).toEqual({ kind: "weak-candidates" });
		expect(promptCalls).toHaveLength(0);
	});

	it("reports a safe error when the cached library cannot be read", async () => {
		const { deps } = fakeDeps({ loadError: new Error("cache broke") });
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		expect(lastResult(controller)).toEqual({ kind: "error" });
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

		await ask(controller, "typescript testing");

		const result = lastResult(controller);
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

		await ask(controller, "typescript testing");

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
		expect(lastResult(controller)?.kind).toBe("recommendations");
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

		await ask(controller, "typescript");

		expect(loadCalls()).toBe(1);
		const result = lastResult(controller);
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
	}): Promise<AskAiResultView | undefined> {
		const { deps } = fakeDeps({ records: strongRecords, ...options });
		const controller = createAskAiController(deps);
		await ask(controller, "typescript");
		return lastResult(controller);
	}

	it("falls back to at most 5 local cards with deterministic reasons when the runner throws", async () => {
		const result = await submitFor({ runError: new Error("prompt api down") });

		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.source).toBe("local");
		expect(result.cards).toHaveLength(5);
		expect(result.cards[0].reason).toBe("Matched title");
		// Best-first: most recently updated strong match leads.
		expect(result.cards[0].canonicalUrl).toBe("https://site-7.test/a");
	});

	it("falls back to local cards when the AI output cannot be parsed", async () => {
		const result = await submitFor({ output: "sorry, no JSON here" });

		expect(result).toMatchObject({
			kind: "recommendations",
			source: "local",
		});
	});

	it("logs safe fallback details when AI recommendation parsing fails", async () => {
		const logger = createMemoryLogger();
		const { deps } = fakeDeps({
			records: strongRecords,
			output: "sorry, no JSON here",
			logger,
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");

		expect(logger.entries).toContainEqual({
			level: "warn",
			event: "ask-ai.recommendation.parse-failed",
			fields: {
				kind: "no-json",
				candidateCount: 7,
				promptCandidateCount: 7,
				promptLength: expect.any(Number),
				rawLength: 19,
			},
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

		await ask(controller, "typescript");

		const result = lastResult(controller);
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.source).toBe("local");
		expect(result.cards[0].reason).toBe("タイトル、タグに一致しました");
	});

	it("falls back to local cards when the AI returns only unknown ids", async () => {
		const result = await submitFor({
			output: aiOutput([{ id: "hallucinated-id", reason: "nope" }]),
		});

		expect(result).toMatchObject({
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

		await ask(controller, japaneseQuestion);

		expect(extractionCalls).toHaveLength(1);
		expect(promptCalls).toHaveLength(1);
		const result = lastResult(controller);
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

		await ask(controller, englishQuestion);

		expect(promptCalls).toHaveLength(1);
		const result = lastResult(controller);
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

		await ask(controller, japaneseQuestion);

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

		await ask(controller, japaneseQuestion);

		expect(lastResult(controller)).toEqual({ kind: "weak-candidates" });
		expect(promptCalls).toHaveLength(0);
	});

	it("falls back to direct scoring when extraction output is malformed", async () => {
		const { deps, promptCalls } = fakeDeps({
			records: japaneseRecords,
			extractionOutput: "sorry, no JSON here",
			language: "ja",
		});
		const controller = createAskAiController(deps);

		await ask(controller, japaneseQuestion);

		expect(lastResult(controller)).toEqual({ kind: "weak-candidates" });
		expect(promptCalls).toHaveLength(0);
	});

	it("logs safe details when keyword extraction output cannot be parsed", async () => {
		const logger = createMemoryLogger();
		const { deps } = fakeDeps({
			records: japaneseRecords,
			extractionOutput: "sorry, no JSON here",
			logger,
			language: "ja",
		});
		const controller = createAskAiController(deps);

		await ask(controller, japaneseQuestion);

		expect(logger.entries).toContainEqual({
			level: "warn",
			event: "ask-ai.keyword-extraction.parse-failed",
			fields: {
				kind: "no-json",
				promptLength: expect.any(Number),
				rawLength: 19,
			},
		});
	});

	it("falls back to direct scoring when extraction returns no keywords", async () => {
		const { deps, promptCalls } = fakeDeps({
			records: japaneseRecords,
			extractionOutput: extractionOutput([]),
			language: "ja",
		});
		const controller = createAskAiController(deps);

		await ask(controller, japaneseQuestion);

		expect(lastResult(controller)).toEqual({ kind: "weak-candidates" });
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

		await ask(controller, "typescript testing");

		expect(promptCalls).toHaveLength(1);
		expect(lastResult(controller)).toMatchObject({
			kind: "recommendations",
			source: "ai",
		});
	});

	it("never calls extraction for too-short questions or an empty library", async () => {
		const tooShort = fakeDeps({ records: japaneseRecords });
		const shortController = createAskAiController(tooShort.deps);
		await ask(shortController, "a");
		expect(tooShort.extractionCalls).toHaveLength(0);

		const empty = fakeDeps({ records: [] });
		const emptyController = createAskAiController(empty.deps);
		await ask(emptyController, "typescript testing");
		expect(empty.extractionCalls).toHaveLength(0);
	});
});

describe("Ask AI chat transcript (MIK-048)", () => {
	const records = [
		record({
			id: "bm-ts",
			canonicalUrl: "https://ts.test/handbook",
			url: "https://ts.test/handbook",
			title: "TypeScript testing handbook",
		}),
	];

	it("appends a user turn then an assistant turn per submit", async () => {
		const { deps } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		const messages = controller.getView().messages;
		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			role: "user",
			text: "typescript testing",
		});
		expect(messages[1]).toMatchObject({ role: "assistant" });
		expect(lastResult(controller)?.kind).toBe("recommendations");
	});

	it("preserves the full transcript across multiple submits with unique ids", async () => {
		const { deps } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		await ask(controller, "which one covers testing?");

		const messages = controller.getView().messages;
		expect(messages).toHaveLength(4);
		expect(userTexts(controller)).toEqual([
			"typescript testing",
			"which one covers testing?",
		]);
		expect(new Set(messages.map((m) => m.id)).size).toBe(4);
	});

	it("clears the composer input when a question is submitted", async () => {
		const { deps } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		expect(controller.getView().question).toBe("");
	});

	it("enables clear once there is a draft question or a transcript", async () => {
		const { deps } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);
		expect(controller.getView().canClear).toBe(false);

		controller.setQuestion("draft");
		expect(controller.getView().canClear).toBe(true);

		await controller.submit();
		expect(controller.getView().canClear).toBe(true);
	});
});

describe("Ask AI Prompt API chat session (MIK-048)", () => {
	const records = [
		record({
			id: "bm-ts",
			canonicalUrl: "https://ts.test/handbook",
			url: "https://ts.test/handbook",
			title: "TypeScript testing handbook",
		}),
	];

	type FakeSession = {
		systemInstruction: string;
		prompts: string[];
		destroyed: boolean;
	};

	function sessionDeps(options: {
		records?: readonly BookmarkRecord[];
		sessionOutput?: string;
		createError?: Error;
		promptError?: Error;
		promptErrors?: readonly Error[];
		runnerOutput?: string;
		logger?: ReturnType<typeof createMemoryLogger>;
	}) {
		const sessions: FakeSession[] = [];
		const runnerCalls: AskAiRecommendationPrompt[] = [];
		let createCalls = 0;
		let promptCalls = 0;
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return options.records ?? records;
			},
			async runKeywordExtractionPrompt() {
				return "";
			},
			async runRecommendationPrompt(request) {
				runnerCalls.push(request);
				return options.runnerOutput ?? "";
			},
			async createRecommendationSession(systemInstruction) {
				createCalls += 1;
				if (options.createError) throw options.createError;
				const fake: FakeSession = {
					systemInstruction,
					prompts: [],
					destroyed: false,
				};
				sessions.push(fake);
				const session: AskAiPromptSession = {
					async prompt(input) {
						fake.prompts.push(input);
						const promptError =
							options.promptErrors?.[promptCalls] ?? options.promptError;
						promptCalls += 1;
						if (promptError) throw promptError;
						return options.sessionOutput ?? "";
					},
					destroy() {
						fake.destroyed = true;
					},
				};
				return session;
			},
			logger: options.logger,
			language: "en",
		};
		return { deps, sessions, runnerCalls, createCalls: () => createCalls };
	}

	it("reuses one Prompt API session across turns for recommendation prompts", async () => {
		const { deps, sessions, runnerCalls, createCalls } = sessionDeps({
			sessionOutput: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		await ask(controller, "which handbook covers testing?");

		expect(createCalls()).toBe(1);
		expect(sessions[0].prompts).toHaveLength(2);
		// The session is pinned to the recommendation prompt's own instruction.
		expect(sessions[0].systemInstruction).toContain("recommends");
		// The per-turn runner is never used while the session is alive.
		expect(runnerCalls).toHaveLength(0);
		expect(lastResult(controller)).toMatchObject({
			kind: "recommendations",
			source: "ai",
		});
	});

	it("falls back to the per-turn runner when session creation fails, without retrying in the same chat", async () => {
		const { deps, runnerCalls, createCalls } = sessionDeps({
			createError: new Error("no session support"),
			runnerOutput: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		await ask(controller, "typescript handbook");

		expect(createCalls()).toBe(1);
		expect(runnerCalls).toHaveLength(2);
		expect(lastResult(controller)).toMatchObject({
			kind: "recommendations",
			source: "ai",
		});
	});

	it("drops a session whose prompt throws and falls back to local cards for that turn", async () => {
		const { deps, sessions } = sessionDeps({
			promptError: new Error("session died"),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		expect(sessions[0].destroyed).toBe(true);
		expect(lastResult(controller)).toMatchObject({
			kind: "recommendations",
			source: "local",
		});
	});

	it("logs quota details when a Prompt API session exceeds the context window", async () => {
		const logger = createMemoryLogger();
		const { deps } = sessionDeps({
			promptError: quotaExceededError(),
			logger,
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		expect(logger.entries).toContainEqual({
			level: "warn",
			event: "ask-ai.session.prompt-failed",
			fields: {
				errorName: "QuotaExceededError",
				requested: 30_000,
				contextWindow: 20_000,
				promptLength: expect.any(Number),
			},
		});
		expect(logger.entries).toContainEqual({
			level: "warn",
			event: "ask-ai.recommendation.runner-failed",
			fields: {
				errorName: "QuotaExceededError",
				requested: 30_000,
				contextWindow: 20_000,
				candidateCount: 1,
				promptCandidateCount: 1,
				promptLength: expect.any(Number),
			},
		});
	});

	it("retries a quota failure once with a smaller candidate prompt", async () => {
		const logger = createMemoryLogger();
		const manyRecords = Array.from({ length: 50 }, (_, index) =>
			record({
				id: `bm-${index + 1}`,
				canonicalUrl: `https://ts.test/${index + 1}`,
				url: `https://ts.test/${index + 1}`,
				title: `TypeScript testing handbook ${index + 1}`,
				description: "TypeScript testing notes and examples.",
			}),
		);
		const { deps, sessions } = sessionDeps({
			records: manyRecords,
			promptErrors: [quotaExceededError()],
			sessionOutput: aiOutput([{ id: "bm-1", reason: "Match." }]),
			logger,
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		expect(lastResult(controller)).toMatchObject({
			kind: "recommendations",
			source: "ai",
		});
		expect(sessions).toHaveLength(2);
		expect(sessions[0].destroyed).toBe(true);
		expect(sessions[1].prompts[0].length).toBeLessThan(
			sessions[0].prompts[0].length,
		);
		expect(logger.entries).toContainEqual({
			level: "warn",
			event: "ask-ai.recommendation.quota-retry",
			fields: {
				errorName: "QuotaExceededError",
				requested: 30_000,
				contextWindow: 20_000,
				candidateCount: 50,
				promptCandidateCount: 50,
				promptLength: expect.any(Number),
				retryCandidateLimit: 25,
				retryPromptCandidateCount: 25,
				retryPromptLength: expect.any(Number),
			},
		});
	});

	it("clear session destroys the Prompt API session and resets transcript, input, and canClear", async () => {
		const { deps, sessions } = sessionDeps({
			sessionOutput: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		controller.setQuestion("a draft follow-up");
		controller.clearSession();

		expect(sessions[0].destroyed).toBe(true);
		expect(controller.getView()).toEqual({
			question: "",
			canSubmit: false,
			answering: false,
			messages: [],
			canClear: false,
		});
	});

	it("starts a fresh Prompt API session on the first submit after clear", async () => {
		const { deps, sessions, createCalls } = sessionDeps({
			sessionOutput: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		controller.clearSession();
		await ask(controller, "typescript handbook");

		expect(createCalls()).toBe(2);
		expect(sessions[0].destroyed).toBe(true);
		expect(sessions[1].destroyed).toBe(false);
		expect(sessions[1].prompts).toHaveLength(1);
	});

	it("retries session creation after clear even when it failed in the previous chat", async () => {
		let failFirst = true;
		const runnerCalls: AskAiRecommendationPrompt[] = [];
		let createCalls = 0;
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return records;
			},
			async runKeywordExtractionPrompt() {
				return "";
			},
			async runRecommendationPrompt(request) {
				runnerCalls.push(request);
				return aiOutput([{ id: "bm-ts", reason: "Match." }]);
			},
			async createRecommendationSession() {
				createCalls += 1;
				if (failFirst) {
					failFirst = false;
					throw new Error("no session support");
				}
				return {
					async prompt() {
						return aiOutput([{ id: "bm-ts", reason: "Match." }]);
					},
					destroy() {},
				};
			},
			language: "en",
		};
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		expect(createCalls).toBe(1);
		expect(runnerCalls).toHaveLength(1);

		controller.clearSession();
		await ask(controller, "typescript handbook");
		expect(createCalls).toBe(2);
		// The new chat's session worked, so no extra runner call happened.
		expect(runnerCalls).toHaveLength(1);
	});

	it("discards an in-flight answer when the session is cleared mid-turn", async () => {
		let release: (value: string) => void = () => {};
		const pending = new Promise<string>((resolve) => {
			release = resolve;
		});
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return records;
			},
			async runKeywordExtractionPrompt() {
				return "";
			},
			runRecommendationPrompt() {
				return pending;
			},
			language: "en",
		};
		const controller = createAskAiController(deps);
		controller.setQuestion("typescript testing");
		const submitted = controller.submit();
		expect(controller.getView().answering).toBe(true);

		controller.clearSession();
		expect(controller.getView().answering).toBe(false);
		expect(controller.getView().messages).toEqual([]);

		release(aiOutput([{ id: "bm-ts", reason: "Match." }]));
		await submitted;

		// The stale answer never lands in the cleared transcript.
		expect(controller.getView().messages).toEqual([]);
		expect(controller.getView().answering).toBe(false);
	});

	it("works per-turn without any session support (no factory provided)", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		await ask(controller, "typescript handbook");

		expect(promptCalls).toHaveLength(2);
		expect(lastResult(controller)).toMatchObject({
			kind: "recommendations",
			source: "ai",
		});
	});
});

describe("Ask AI hybrid follow-up retrieval (MIK-048)", () => {
	const records = [
		record({
			id: "bm-ts-test",
			canonicalUrl: "https://ts.test/handbook",
			url: "https://ts.test/handbook",
			title: "typescript testing handbook",
		}),
		record({
			id: "bm-ts-recipes",
			canonicalUrl: "https://ts.test/recipes",
			url: "https://ts.test/recipes",
			title: "typescript recipes",
		}),
		record({
			id: "bm-chrome",
			canonicalUrl: "https://chrome.test/guide",
			url: "https://chrome.test/guide",
			title: "testing chrome extensions guide",
		}),
	];

	function payloadIds(call: AskAiRecommendationPrompt): string[] {
		return call.candidatePayload.map((candidate) => candidate.id);
	}

	it("narrows a follow-up to the previous candidate set", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts-test", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		expect(payloadIds(promptCalls[0]).sort()).toEqual([
			"bm-ts-recipes",
			"bm-ts-test",
		]);

		// "testing" matches bm-chrome too, but the follow-up stays inside the
		// previous typescript candidates.
		await ask(controller, "testing");
		expect(payloadIds(promptCalls[1])).toEqual(["bm-ts-test"]);
	});

	it("falls back to all cached bookmarks when the narrowed set has no strong match", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			outputs: [
				aiOutput([{ id: "bm-ts-test", reason: "Match." }]),
				aiOutput([{ id: "bm-chrome", reason: "New topic." }]),
			],
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		// A new topic misses the narrowed typescript set, so retrieval falls
		// back to the whole cache.
		await ask(controller, "chrome extensions");

		expect(payloadIds(promptCalls[1])).toEqual(["bm-chrome"]);
		const result = lastResult(controller);
		if (result?.kind !== "recommendations") throw new Error("no cards");
		expect(result.cards[0].canonicalUrl).toBe("https://chrome.test/guide");
	});

	it("keeps the previous narrowed context when a turn finds nothing anywhere", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts-test", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		await ask(controller, "cooking pasta");
		expect(lastResult(controller)).toEqual({ kind: "weak-candidates" });

		// The weak turn did not wipe the narrowed context: the next follow-up
		// still refines the typescript candidates.
		await ask(controller, "testing");
		expect(payloadIds(promptCalls[1])).toEqual(["bm-ts-test"]);
	});

	it("clear session resets the narrowed context back to all cached bookmarks", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			output: aiOutput([{ id: "bm-ts-test", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		controller.clearSession();

		// After the hard reset, "testing" scores over the whole cache again.
		await ask(controller, "testing");
		expect(payloadIds(promptCalls[1]).sort()).toEqual([
			"bm-chrome",
			"bm-ts-test",
		]);
	});
});

describe("Ask AI refinement follow-ups keep prior context (MIK-055)", () => {
	// "narrow those down" strongly matches bm-narrow across the whole cache, so
	// broadening (the pre-MIK-055 bug) is observable in the candidate payload.
	const records = [
		record({
			id: "bm-ts-test",
			canonicalUrl: "https://ts.test/handbook",
			url: "https://ts.test/handbook",
			title: "typescript testing handbook",
		}),
		record({
			id: "bm-ts-recipes",
			canonicalUrl: "https://ts.test/recipes",
			url: "https://ts.test/recipes",
			title: "typescript recipes",
		}),
		record({
			id: "bm-chrome",
			canonicalUrl: "https://chrome.test/guide",
			url: "https://chrome.test/guide",
			title: "testing chrome extensions guide",
		}),
		record({
			id: "bm-narrow",
			canonicalUrl: "https://narrow.test/guide",
			url: "https://narrow.test/guide",
			title: "how to narrow down anything",
		}),
	];

	function payloadIds(call: AskAiRecommendationPrompt): string[] {
		return call.candidatePayload.map((candidate) => candidate.id);
	}

	const bothTsRecommended = aiOutput([
		{ id: "bm-ts-test", reason: "Match." },
		{ id: "bm-ts-recipes", reason: "Match." },
	]);

	it("keeps a Japanese refinement such as 絞って inside the previous recommendation context", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			outputs: [
				bothTsRecommended,
				aiOutput([{ id: "bm-ts-test", reason: "こちらに絞りました。" }]),
			],
			language: "ja",
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		// 絞って matches no bookmark text at all, but it must still refine the
		// previous recommendations instead of landing as a clarifying weak turn.
		await ask(controller, "絞って");

		expect(promptCalls).toHaveLength(2);
		expect(payloadIds(promptCalls[1]).sort()).toEqual([
			"bm-ts-recipes",
			"bm-ts-test",
		]);
		expect(lastResult(controller)).toMatchObject({
			kind: "recommendations",
			source: "ai",
		});
	});

	it("keeps an English refinement such as narrow those down inside the previous context instead of broadening", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			outputs: [
				bothTsRecommended,
				aiOutput([{ id: "bm-ts-test", reason: "Narrowed." }]),
			],
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		await ask(controller, "narrow those down");

		expect(promptCalls).toHaveLength(2);
		expect(payloadIds(promptCalls[1]).sort()).toEqual([
			"bm-ts-recipes",
			"bm-ts-test",
		]);
	});

	it("prefers the recommendation cards actually shown as the refinement context", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			outputs: [
				// The first turn scored both typescript records, but the model
				// recommended only one card — the user's refinement means THAT one.
				aiOutput([{ id: "bm-ts-test", reason: "Best match." }]),
				aiOutput([{ id: "bm-ts-test", reason: "Still it." }]),
			],
			language: "ja",
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		await ask(controller, "もう少し具体的に");

		expect(promptCalls).toHaveLength(2);
		expect(payloadIds(promptCalls[1])).toEqual(["bm-ts-test"]);
	});

	it("still broadens a clear new-topic question to all cached bookmarks", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			outputs: [
				bothTsRecommended,
				aiOutput([{ id: "bm-chrome", reason: "New topic." }]),
			],
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		await ask(controller, "chrome extensions");

		expect(payloadIds(promptCalls[1])).toEqual(["bm-chrome"]);
	});

	it("clearSession resets the follow-up context so a refinement no longer finds prior recommendations", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			outputs: [bothTsRecommended],
			language: "ja",
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		controller.clearSession();

		// With the context gone there is nothing to refine: the question scores
		// over the whole cache and lands as a clarifying weak turn, not a
		// recommendation over stale context.
		await ask(controller, "絞って");

		expect(promptCalls).toHaveLength(1);
		expect(lastResult(controller)).toEqual({ kind: "weak-candidates" });
	});

	it("keeps the refinement prompt payload compact and URL-free", async () => {
		const { deps, promptCalls } = fakeDeps({
			records,
			outputs: [
				bothTsRecommended,
				aiOutput([{ id: "bm-ts-test", reason: "Narrowed." }]),
			],
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript");
		await ask(controller, "narrow those down");

		expect(promptCalls).toHaveLength(2);
		const sent = JSON.stringify(promptCalls[1]);
		expect(sent).not.toContain("https://");
		expect(sent).not.toContain("canonicalUrl");
		expect(sent).not.toContain("analysisMarkdown");
		expect(promptCalls[1].prompt).toContain("bm-ts-test");
	});
});

describe("Ask AI chat state is memory-only (MIK-048)", () => {
	afterEach(() => {
		delete (globalThis as { chrome?: unknown }).chrome;
	});

	it("never touches chrome storage and clear makes no dependency calls", async () => {
		// Any storage access explodes: the chat flow must run entirely in memory.
		(globalThis as { chrome?: unknown }).chrome = {
			storage: new Proxy(
				{},
				{
					get() {
						throw new Error("Ask AI chat state must never touch storage");
					},
				},
			),
		};
		const { deps, promptCalls, extractionCalls, loadCalls } = fakeDeps({
			records: [
				record({
					id: "bm-ts",
					canonicalUrl: "https://ts.test/handbook",
					url: "https://ts.test/handbook",
					title: "TypeScript testing handbook",
				}),
			],
			output: aiOutput([{ id: "bm-ts", reason: "Match." }]),
		});
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");
		const loadsAfterSubmit = loadCalls();
		const promptsAfterSubmit = promptCalls.length;
		const extractionsAfterSubmit = extractionCalls.length;

		controller.clearSession();

		expect(loadCalls()).toBe(loadsAfterSubmit);
		expect(promptCalls.length).toBe(promptsAfterSubmit);
		expect(extractionCalls.length).toBe(extractionsAfterSubmit);
		expect(controller.getView().messages).toEqual([]);
	});
});

describe("Ask AI clear-session mid-flight hardening (MIK-048)", () => {
	// Two records so all-bookmarks vs narrowed retrieval is observable: only
	// "bm-ts-test" matches "typescript", but both match "testing".
	const records = [
		record({
			id: "bm-ts-test",
			canonicalUrl: "https://ts.test/handbook",
			url: "https://ts.test/handbook",
			title: "typescript testing handbook",
		}),
		record({
			id: "bm-chrome",
			canonicalUrl: "https://chrome.test/guide",
			url: "https://chrome.test/guide",
			title: "testing chrome extensions guide",
		}),
	];

	it("a turn cleared during keyword extraction leaves no narrowed context and no session behind", async () => {
		let releaseExtraction: (value: string) => void = () => {};
		const extractionPending = new Promise<string>((resolve) => {
			releaseExtraction = resolve;
		});
		let extractionCallCount = 0;
		const sessions: { prompts: string[]; destroyed: boolean }[] = [];
		let createCalls = 0;
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return records;
			},
			runKeywordExtractionPrompt() {
				extractionCallCount += 1;
				return extractionCallCount === 1
					? extractionPending
					: Promise.resolve("");
			},
			async runRecommendationPrompt() {
				return "";
			},
			async createRecommendationSession() {
				createCalls += 1;
				const fake = { prompts: [] as string[], destroyed: false };
				sessions.push(fake);
				return {
					async prompt(input) {
						fake.prompts.push(input);
						return aiOutput([{ id: "bm-ts-test", reason: "Match." }]);
					},
					destroy() {
						fake.destroyed = true;
					},
				};
			},
			language: "en",
		};
		const controller = createAskAiController(deps);

		// The first turn would narrow to the typescript-only candidate set…
		controller.setQuestion("typescript");
		const submitted = controller.submit();
		// …but the chat is cleared while it sits inside keyword extraction.
		controller.clearSession();
		releaseExtraction(extractionOutput(["typescript"]));
		await submitted;

		// The stale turn opened no session and landed nothing.
		expect(createCalls).toBe(0);
		expect(controller.getView().messages).toEqual([]);

		// The next chat retrieves over ALL cached bookmarks (no stale narrowed
		// context): both "testing" matches ride in the candidate payload of the
		// freshly created session's prompt.
		await ask(controller, "testing");
		expect(createCalls).toBe(1);
		expect(sessions[0].destroyed).toBe(false);
		expect(sessions[0].prompts).toHaveLength(1);
		expect(sessions[0].prompts[0]).toContain("bm-ts-test");
		expect(sessions[0].prompts[0]).toContain("bm-chrome");
	});

	it("a session that finishes opening after clear is destroyed, and the next chat owns a fresh one", async () => {
		let releaseCreate: (session: AskAiPromptSession) => void = () => {};
		const pendingCreate = new Promise<AskAiPromptSession>((resolve) => {
			releaseCreate = resolve;
		});
		let reachedCreate: () => void = () => {};
		const createReached = new Promise<void>((resolve) => {
			reachedCreate = resolve;
		});
		const staleSession = { prompts: [] as string[], destroyed: false };
		const freshSession = { prompts: [] as string[], destroyed: false };
		let createCalls = 0;
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return records;
			},
			async runKeywordExtractionPrompt() {
				return "";
			},
			async runRecommendationPrompt() {
				return "";
			},
			createRecommendationSession() {
				createCalls += 1;
				if (createCalls === 1) {
					reachedCreate();
					return pendingCreate;
				}
				return Promise.resolve({
					async prompt(input: string) {
						freshSession.prompts.push(input);
						return aiOutput([{ id: "bm-ts-test", reason: "Match." }]);
					},
					destroy() {
						freshSession.destroyed = true;
					},
				});
			},
			language: "en",
		};
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript");
		const submitted = controller.submit();
		// The turn is now provably blocked inside the pending session creation.
		await createReached;
		controller.clearSession();
		releaseCreate({
			async prompt(input) {
				staleSession.prompts.push(input);
				return "";
			},
			destroy() {
				staleSession.destroyed = true;
			},
		});
		await submitted;

		// The stale session belongs to no conversation: destroyed, never used.
		expect(staleSession.destroyed).toBe(true);
		expect(staleSession.prompts).toEqual([]);

		await ask(controller, "testing");
		expect(createCalls).toBe(2);
		expect(freshSession.prompts).toHaveLength(1);
		expect(freshSession.destroyed).toBe(false);
	});

	it("a stale creation failure does not mark sessions unavailable for the next chat", async () => {
		let rejectCreate: (error: Error) => void = () => {};
		const pendingCreate = new Promise<AskAiPromptSession>((_, reject) => {
			rejectCreate = reject;
		});
		let reachedCreate: () => void = () => {};
		const createReached = new Promise<void>((resolve) => {
			reachedCreate = resolve;
		});
		const freshSession = { prompts: [] as string[], destroyed: false };
		let createCalls = 0;
		const runnerCalls: AskAiRecommendationPrompt[] = [];
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return records;
			},
			async runKeywordExtractionPrompt() {
				return "";
			},
			async runRecommendationPrompt(request) {
				runnerCalls.push(request);
				return "";
			},
			createRecommendationSession() {
				createCalls += 1;
				if (createCalls === 1) {
					reachedCreate();
					return pendingCreate;
				}
				return Promise.resolve({
					async prompt(input: string) {
						freshSession.prompts.push(input);
						return aiOutput([{ id: "bm-ts-test", reason: "Match." }]);
					},
					destroy() {
						freshSession.destroyed = true;
					},
				});
			},
			language: "en",
		};
		const controller = createAskAiController(deps);

		controller.setQuestion("typescript");
		const submitted = controller.submit();
		// The turn is now provably blocked inside the pending session creation.
		await createReached;
		controller.clearSession();
		rejectCreate(new Error("stale creation failed"));
		await submitted;

		// The failure belonged to the cleared chat: the next chat still opens
		// and uses its own session instead of degrading to the runner.
		await ask(controller, "testing");
		expect(createCalls).toBe(2);
		expect(freshSession.prompts).toHaveLength(1);
		expect(runnerCalls).toHaveLength(0);
	});

	it("resets answering and reports a safe error when the flow throws unexpectedly", async () => {
		// A malformed cache snapshot blows up local scoring itself — outside
		// every inner catch — and must not leave the composer stuck answering.
		const deps: AskAiDeps = {
			async loadBookmarks() {
				return null as unknown as readonly BookmarkRecord[];
			},
			async runKeywordExtractionPrompt() {
				return "";
			},
			async runRecommendationPrompt() {
				return "";
			},
			language: "en",
		};
		const controller = createAskAiController(deps);

		await ask(controller, "typescript testing");

		expect(controller.getView().answering).toBe(false);
		expect(controller.getView().canSubmit).toBe(false);
		expect(lastResult(controller)).toEqual({ kind: "error" });
	});
});
