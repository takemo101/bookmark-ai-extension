import { describe, expect, it } from "vitest";

import { createMemoryLogger } from "../logging/index";
import { type AnalysisModelSetup, analyzePage } from "./analyze-page";
import type { AnalysisProfile } from "./profile";
import {
	type PromptApiAvailability,
	type PromptClient,
	type PromptLifecycleObserver,
	PromptApiUnavailableError,
	PromptSessionCreateError,
} from "./prompt-api";
import {
	type SummarizerAvailability,
	type SummarizerClient,
	SummarizerRunError,
} from "./summarizer-api";
import type { AnalysisInput } from "./types";

const INPUT: AnalysisInput = {
	title: "Example",
	url: "https://example.com",
	excerpt: "本文の抜粋テキスト。",
};

/** Build a fake client; no Chrome / Prompt API involved. */
function fakeClient(opts: {
	availability?: PromptApiAvailability | (() => Promise<PromptApiAvailability>);
	prompt?: (
		input: string,
		language?: string,
		observer?: PromptLifecycleObserver,
	) => Promise<string>;
}): PromptClient {
	return {
		availability: async () => {
			const a = opts.availability ?? "available";
			return typeof a === "function" ? a() : a;
		},
		prompt: opts.prompt ?? (async () => "{}"),
	};
}

const VALID_OUTPUT = JSON.stringify({
	description: "説明",
	genre: "技術",
	tags: ["A"],
	analysisMarkdown: "## 概要\n\n分析本文。",
});

const ANALYSIS_MARKDOWN = "## 概要\n\n分析本文。";

describe("analyzePage status/error mapping", () => {
	it("maps available + valid output to ready, attaching the selected profile id", async () => {
		const client = fakeClient({
			availability: "available",
			prompt: async () =>
				JSON.stringify({
					description: "説明",
					genre: "技術",
					tags: ["A"],
					analysisMarkdown: ANALYSIS_MARKDOWN,
				}),
		});
		const outcome = await analyzePage(client, INPUT);
		expect(outcome.status).toBe("ready");
		if (outcome.status !== "ready" || outcome.model !== "chrome-prompt-api")
			return;
		expect(outcome.analysis.description).toBe("説明");
		expect(outcome.analysis.genre).toBe("技術");
		expect(outcome.analysis.tags).toEqual(["A"]);
		expect(outcome.analysis.analysisMarkdown).toBe(ANALYSIS_MARKDOWN);
		// example.com matches no built-in domain profile, so it falls back to generic.
		expect(outcome.profileId).toBe("generic-page");
	});

	it("selects the GitHub repository profile for a github.com URL", async () => {
		let seen = "";
		const client = fakeClient({
			prompt: async (input) => {
				seen = input;
				return JSON.stringify({
					description: "説明",
					tags: [],
					analysisMarkdown: ANALYSIS_MARKDOWN,
				});
			},
		});
		const outcome = await analyzePage(client, {
			...INPUT,
			url: "https://github.com/facebook/react",
		});
		expect(outcome.status).toBe("ready");
		if (outcome.status !== "ready" || outcome.model !== "chrome-prompt-api")
			return;
		expect(outcome.profileId).toBe("github-repository");
		expect(seen).toContain("GitHub");
	});

	it("forwards the page excerpt and title into the prompt", async () => {
		let seen = "";
		const client = fakeClient({
			prompt: async (input) => {
				seen = input;
				return JSON.stringify({
					description: "説明",
					tags: [],
					analysisMarkdown: ANALYSIS_MARKDOWN,
				});
			},
		});
		await analyzePage(client, INPUT);
		expect(seen).toContain(INPUT.title);
		expect(seen).toContain(INPUT.url);
		expect(seen).toContain(INPUT.excerpt);
		// Output language requested is Japanese.
		expect(seen).toContain("日本語");
	});

	it("maps an unavailable API to unavailable status", async () => {
		const client = fakeClient({ availability: "unavailable" });
		const outcome = await analyzePage(client, INPUT);
		expect(outcome.status).toBe("unavailable");
		if (outcome.status !== "unavailable") return;
		expect(outcome.reason).toContain("unavailable");
	});

	it("proceeds into the prompt (model download) path for downloadable / downloading", async () => {
		for (const a of ["downloadable", "downloading"] as const) {
			const logger = createMemoryLogger();
			let prompted = 0;
			const client = fakeClient({
				availability: a,
				prompt: async () => {
					prompted += 1;
					return VALID_OUTPUT;
				},
			});

			const outcome = await analyzePage(client, INPUT, [], { logger });

			expect(prompted).toBe(1);
			expect(outcome.status).toBe("ready");
			expect(logger.entries).toContainEqual({
				level: "info",
				event: "ai.analysis.model-download-required",
				fields: { availability: a, language: "ja" },
			});
		}
	});

	it("does not report model setup when a downloadable model creates a session without progress", async () => {
		const setupEvents: AnalysisModelSetup[] = [];
		const client = fakeClient({
			availability: "downloadable",
			prompt: async (_input, _language, observer) => {
				observer?.({ kind: "session-created" });
				return VALID_OUTPUT;
			},
		});

		const outcome = await analyzePage(client, INPUT, [], {
			onModelSetup: (event) => setupEvents.push(event),
		});

		expect(outcome.status).toBe("ready");
		expect(setupEvents).toEqual([]);
	});

	it("reports model setup, download progress, and readiness through onModelSetup", async () => {
		const logger = createMemoryLogger();
		const setupEvents: AnalysisModelSetup[] = [];
		const client = fakeClient({
			availability: "downloadable",
			prompt: async (_input, _language, observer) => {
				observer?.({
					kind: "download-progress",
					loaded: 0.42,
					ratio: 0.42,
				});
				observer?.({ kind: "session-created" });
				return VALID_OUTPUT;
			},
		});

		const outcome = await analyzePage(client, INPUT, [], {
			logger,
			onModelSetup: (event) => setupEvents.push(event),
		});

		expect(outcome.status).toBe("ready");
		expect(setupEvents).toEqual([
			{ kind: "model-downloading", ratio: 0.42 },
			{ kind: "model-ready" },
		]);
		expect(logger.entries).toContainEqual({
			level: "debug",
			event: "ai.analysis.model-download-progress",
			fields: {
				loaded: 0.42,
				total: undefined,
				ratio: 0.42,
				language: "ja",
				profileId: "generic-page",
			},
		});
		expect(logger.entries).toContainEqual({
			level: "info",
			event: "ai.analysis.model-session-created",
			fields: {
				availability: "downloadable",
				language: "ja",
				profileId: "generic-page",
			},
		});
		// Logs stay metadata-only: no page excerpt, title, or URL text.
		const serialized = JSON.stringify(logger.entries);
		expect(serialized).not.toContain(INPUT.excerpt);
		expect(serialized).not.toContain(INPUT.title);
	});

	it("does not log session creation on the ordinary available fast path", async () => {
		const logger = createMemoryLogger();
		const client = fakeClient({
			availability: "available",
			prompt: async (_input, _language, observer) => {
				observer?.({ kind: "session-created" });
				return VALID_OUTPUT;
			},
		});

		await analyzePage(client, INPUT, [], { logger });

		expect(
			logger.entries.filter((e) => e.event.startsWith("ai.analysis.model")),
		).toEqual([]);
	});

	it("maps a session creation/download failure to failed and logs it safely", async () => {
		const logger = createMemoryLogger();
		const cause = new Error("raw browser message");
		cause.name = "QuotaExceededError";
		const client = fakeClient({
			availability: "downloadable",
			prompt: async () => {
				throw new PromptSessionCreateError(cause);
			},
		});

		const outcome = await analyzePage(client, INPUT, [], { logger });

		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") return;
		expect(outcome.error.kind).toBe("client-error");
		// The stored message names the cause but never carries its raw text.
		expect(outcome.error.message).toContain("QuotaExceededError");
		expect(outcome.error.message).not.toContain("raw browser message");
		expect(logger.entries).toContainEqual({
			level: "error",
			event: "ai.analysis.session-create-failed",
			fields: {
				errorName: "PromptSessionCreateError",
				causeName: "QuotaExceededError",
				availability: "downloadable",
				language: "ja",
				profileId: "generic-page",
			},
		});
		expect(JSON.stringify(logger.entries)).not.toContain("raw browser message");
	});

	it("maps malformed AI output to failed with a recoverable parse error", async () => {
		const client = fakeClient({
			availability: "available",
			prompt: async () => "これは説明文ですがJSONではありません。",
		});
		const outcome = await analyzePage(client, INPUT);
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") return;
		expect(outcome.error.kind).toBe("no-json");
	});

	it("logs safe details when AI analysis output cannot be parsed", async () => {
		const logger = createMemoryLogger();
		const client = fakeClient({
			availability: "available",
			prompt: async () => "これは説明文ですがJSONではありません。",
		});

		await analyzePage(client, INPUT, [], { logger });

		expect(logger.entries).toContainEqual({
			level: "warn",
			event: "ai.analysis.parse-failed",
			fields: {
				kind: "no-json",
				language: "ja",
				profileId: "generic-page",
				rawLength: 21,
			},
		});
	});

	it("maps an empty description to failed", async () => {
		const client = fakeClient({
			prompt: async () => JSON.stringify({ description: "  ", tags: ["A"] }),
		});
		const outcome = await analyzePage(client, INPUT);
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") return;
		expect(outcome.error.kind).toBe("empty-description");
	});

	it("maps a generic prompt throw to failed with a client error", async () => {
		const client = fakeClient({
			prompt: async () => {
				throw new Error("session crashed");
			},
		});
		const outcome = await analyzePage(client, INPUT);
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") return;
		expect(outcome.error.kind).toBe("client-error");
		expect(outcome.error.message).toContain("session crashed");
	});

	it("logs safe details when the analysis prompt throws", async () => {
		const logger = createMemoryLogger();
		const client = fakeClient({
			prompt: async () => {
				throw new TypeError("session crashed");
			},
		});

		await analyzePage(client, INPUT, [], { logger });

		expect(logger.entries).toContainEqual({
			level: "error",
			event: "ai.analysis.prompt-failed",
			fields: {
				errorName: "TypeError",
				language: "ja",
				profileId: "generic-page",
			},
		});
	});

	it("maps a PromptApiUnavailableError throw to unavailable", async () => {
		const client = fakeClient({
			prompt: async () => {
				throw new PromptApiUnavailableError();
			},
		});
		const outcome = await analyzePage(client, INPUT);
		expect(outcome.status).toBe("unavailable");
	});

	it("maps a throwing availability probe to unavailable", async () => {
		const client = fakeClient({
			availability: async () => {
				throw new Error("probe blew up");
			},
		});
		const outcome = await analyzePage(client, INPUT);
		expect(outcome.status).toBe("unavailable");
		if (outcome.status !== "unavailable") return;
		expect(outcome.reason).toContain("probe blew up");
	});

	it("logs safe details when the availability probe throws", async () => {
		const logger = createMemoryLogger();
		const client = fakeClient({
			availability: async () => {
				throw new Error("probe blew up");
			},
		});

		await analyzePage(client, INPUT, [], { logger });

		expect(logger.entries).toContainEqual({
			level: "warn",
			event: "ai.analysis.availability-threw",
			fields: { errorName: "Error", language: "ja" },
		});
	});

	it("infers the output language from page text when no UI language is provided (MIK-029)", async () => {
		const availabilityLanguages: unknown[] = [];
		const promptLanguages: unknown[] = [];
		let seen = "";
		const client: PromptClient = {
			availability: async (language) => {
				availabilityLanguages.push(language);
				return "available";
			},
			prompt: async (input, language) => {
				promptLanguages.push(language);
				seen = input;
				return JSON.stringify({
					description: "desc",
					tags: [],
					analysisMarkdown: "## Overview\n\nBody.",
				});
			},
		};
		const outcome = await analyzePage(client, {
			title: "A practical guide to Chrome extensions",
			url: "https://example.com",
			excerpt:
				"This article walks through building a Chrome extension with bookmarks, storage, and AI summaries.",
		});
		expect(outcome.status).toBe("ready");
		expect(availabilityLanguages).toEqual(["en"]);
		expect(promptLanguages).toEqual(["en"]);
		expect(seen).toContain("in English");
		expect(seen).not.toContain("日本語");
	});

	// An English-content GitHub repository page, the motivating MIK-033 case:
	// page text alone would infer English, but the current UI language must win.
	const ENGLISH_GITHUB_INPUT: AnalysisInput = {
		title: "facebook/react: The library for web and native user interfaces",
		url: "https://github.com/facebook/react",
		excerpt:
			"React is a JavaScript library for building user interfaces. " +
			"Declarative, component-based, and learn-once-write-anywhere.",
	};

	it("uses Japanese for English GitHub content when the UI language is Japanese (MIK-033)", async () => {
		const availabilityLanguages: unknown[] = [];
		const promptLanguages: unknown[] = [];
		let seen = "";
		const client: PromptClient = {
			availability: async (language) => {
				availabilityLanguages.push(language);
				return "available";
			},
			prompt: async (input, language) => {
				promptLanguages.push(language);
				seen = input;
				return JSON.stringify({
					description: "説明",
					tags: [],
					analysisMarkdown: ANALYSIS_MARKDOWN,
				});
			},
		};
		const outcome = await analyzePage(client, {
			...ENGLISH_GITHUB_INPUT,
			fallbackLanguage: "ja",
		});
		expect(outcome.status).toBe("ready");
		if (outcome.status !== "ready" || outcome.model !== "chrome-prompt-api")
			return;
		expect(outcome.profileId).toBe("github-repository");
		expect(availabilityLanguages).toEqual(["ja"]);
		expect(promptLanguages).toEqual(["ja"]);
		expect(seen).toContain("日本語");
	});

	it("keeps English for the same GitHub content when the UI language is English (MIK-033)", async () => {
		const availabilityLanguages: unknown[] = [];
		const promptLanguages: unknown[] = [];
		let seen = "";
		const client: PromptClient = {
			availability: async (language) => {
				availabilityLanguages.push(language);
				return "available";
			},
			prompt: async (input, language) => {
				promptLanguages.push(language);
				seen = input;
				return JSON.stringify({
					description: "desc",
					tags: [],
					analysisMarkdown: "## Overview\n\nBody.",
				});
			},
		};
		const outcome = await analyzePage(client, {
			...ENGLISH_GITHUB_INPUT,
			fallbackLanguage: "en",
		});
		expect(outcome.status).toBe("ready");
		expect(availabilityLanguages).toEqual(["en"]);
		expect(promptLanguages).toEqual(["en"]);
		expect(seen).toContain("in English");
		expect(seen).not.toContain("日本語");
	});

	it("lets the UI language win even when the page text disagrees (MIK-033)", async () => {
		const promptLanguages: unknown[] = [];
		const client: PromptClient = {
			availability: async () => "available",
			prompt: async (_input, language) => {
				promptLanguages.push(language);
				return JSON.stringify({
					description: "desc",
					tags: [],
					analysisMarkdown: "## Overview\n\nBody.",
				});
			},
		};
		// A clearly Japanese page with an English UI now produces English.
		await analyzePage(client, {
			title: "Chrome拡張の作り方",
			url: "https://example.com",
			excerpt:
				"この記事ではChrome拡張機能の設計と実装手順を日本語で解説します。",
			fallbackLanguage: "en",
		});
		expect(promptLanguages).toEqual(["en"]);
	});

	it("falls back safely when no UI language is provided", async () => {
		const promptLanguages: unknown[] = [];
		const client: PromptClient = {
			availability: async () => "available",
			prompt: async (_input, language) => {
				promptLanguages.push(language);
				return JSON.stringify({
					description: "desc",
					tags: [],
					analysisMarkdown: "## Overview\n\nBody.",
				});
			},
		};
		// Ambiguous page text (too short for a script signal) → Japanese default.
		await analyzePage(client, {
			title: "?",
			url: "https://example.com",
			excerpt: "!",
		});
		expect(promptLanguages).toEqual(["ja"]);
		// Clearly English page text → inferred English.
		await analyzePage(client, ENGLISH_GITHUB_INPUT);
		expect(promptLanguages).toEqual(["ja", "en"]);
	});

	it("prefers a higher-priority custom profile over a matching built-in", async () => {
		const client = fakeClient({
			prompt: async () =>
				JSON.stringify({
					description: "説明",
					tags: [],
					analysisMarkdown: ANALYSIS_MARKDOWN,
				}),
		});
		const custom: AnalysisProfile = {
			id: "custom-github",
			name: "Custom GitHub",
			priority: 100,
			urlPatterns: ["github.com/*"],
			instruction: "Custom emphasis.",
		};
		const outcome = await analyzePage(
			client,
			{ ...INPUT, url: "https://github.com/facebook/react" },
			[custom],
		);
		expect(outcome.status).toBe("ready");
		if (outcome.status !== "ready" || outcome.model !== "chrome-prompt-api")
			return;
		expect(outcome.profileId).toBe("custom-github");
	});

	it("falls back to a built-in profile when no custom profile matches", async () => {
		const client = fakeClient({
			prompt: async () =>
				JSON.stringify({
					description: "説明",
					tags: [],
					analysisMarkdown: ANALYSIS_MARKDOWN,
				}),
		});
		const custom: AnalysisProfile = {
			id: "custom-unrelated",
			name: "Custom Unrelated",
			priority: 100,
			urlPatterns: ["unrelated.example/*"],
			instruction: "Custom emphasis.",
		};
		const outcome = await analyzePage(
			client,
			{ ...INPUT, url: "https://github.com/facebook/react" },
			[custom],
		);
		expect(outcome.status).toBe("ready");
		if (outcome.status !== "ready" || outcome.model !== "chrome-prompt-api")
			return;
		expect(outcome.profileId).toBe("github-repository");
	});
});

/**
 * Summarizer API concise fallback (docs/summarizer-fallback.md). The Prompt API
 * stays the normal path; these cases only cover what happens *after* it reaches
 * a terminal failure.
 */
describe("analyzePage Summarizer fallback", () => {
	const SUMMARY_MARKDOWN = "- 要点1\n- 要点2\n- 要点3";

	/** A fake Summarizer client; no Chrome / Summarizer API involved. */
	function fakeSummarizer(opts: {
		availability?: SummarizerAvailability;
		summarize?: (input: string, language?: string) => Promise<string>;
	}) {
		const calls: Array<{ input: string; language?: string }> = [];
		const client: SummarizerClient = {
			availability: async () => opts.availability ?? "available",
			summarize: async (input, language) => {
				calls.push({ input, language });
				return opts.summarize
					? opts.summarize(input, language)
					: SUMMARY_MARKDOWN;
			},
		};
		return { client, calls };
	}

	const failingPromptClients: ReadonlyArray<
		readonly [string, () => PromptClient]
	> = [
		["unavailable API", () => fakeClient({ availability: "unavailable" })],
		[
			"throwing availability probe",
			() =>
				fakeClient({
					availability: async () => {
						throw new Error("probe blew up");
					},
				}),
		],
		[
			"PromptApiUnavailableError",
			() =>
				fakeClient({
					prompt: async () => {
						throw new PromptApiUnavailableError();
					},
				}),
		],
		[
			"session creation failure",
			() =>
				fakeClient({
					prompt: async () => {
						throw new PromptSessionCreateError(new Error("nope"));
					},
				}),
		],
		[
			"generic prompt failure",
			() =>
				fakeClient({
					prompt: async () => {
						throw new Error("inference failed");
					},
				}),
		],
		["malformed JSON output", () => fakeClient({ prompt: async () => "oops" })],
	];

	it("never consults Summarizer when the Prompt API succeeds", async () => {
		const summarizer = fakeSummarizer({});
		const client = fakeClient({ prompt: async () => VALID_OUTPUT });

		const outcome = await analyzePage(client, INPUT, [], {
			summarizer: summarizer.client,
		});

		expect(outcome.status).toBe("ready");
		if (outcome.status !== "ready") return;
		expect(outcome.model).toBe("chrome-prompt-api");
		expect(summarizer.calls).toEqual([]);
	});

	for (const [label, makeClient] of failingPromptClients) {
		it(`falls back once after a terminal Prompt outcome: ${label}`, async () => {
			const summarizer = fakeSummarizer({});

			const outcome = await analyzePage(makeClient(), INPUT, [], {
				summarizer: summarizer.client,
			});

			expect(summarizer.calls).toHaveLength(1);
			expect(outcome.status).toBe("ready");
			if (outcome.status !== "ready") return;
			expect(outcome.model).toBe("chrome-summarizer-api");
			if (outcome.model !== "chrome-summarizer-api") return;
			expect(outcome.summary.analysisMarkdown).toBe(SUMMARY_MARKDOWN);
			expect(outcome.summary.description).toBe("要点1 / 要点2 / 要点3");
		});
	}

	it("keeps the original Prompt outcome when no Summarizer client is wired", async () => {
		const outcome = await analyzePage(
			fakeClient({ availability: "unavailable" }),
			INPUT,
		);
		expect(outcome.status).toBe("unavailable");
	});

	it("does not summarize unless Summarizer is already available", async () => {
		for (const availability of [
			"downloadable",
			"downloading",
			"unavailable",
		] as const) {
			const summarizer = fakeSummarizer({ availability });

			const outcome = await analyzePage(
				fakeClient({ prompt: async () => "not json" }),
				INPUT,
				[],
				{ summarizer: summarizer.client },
			);

			expect(summarizer.calls).toEqual([]);
			expect(outcome.status).toBe("failed");
		}
	});

	it("keeps the original Prompt outcome when Summarizer throws", async () => {
		const summarizer = fakeSummarizer({
			summarize: async () => {
				throw new SummarizerRunError(new Error("browser said no"));
			},
		});

		const outcome = await analyzePage(
			fakeClient({ availability: "unavailable" }),
			INPUT,
			[],
			{ summarizer: summarizer.client },
		);

		expect(outcome.status).toBe("unavailable");
		if (outcome.status !== "unavailable") return;
		expect(outcome.reason).toContain("unavailable");
	});

	it("keeps the original Prompt outcome when the availability probe throws", async () => {
		const summarizer: SummarizerClient = {
			availability: async () => {
				throw new Error("probe blew up");
			},
			summarize: async () => SUMMARY_MARKDOWN,
		};

		const outcome = await analyzePage(
			fakeClient({
				prompt: async () => {
					throw new Error("inference failed");
				},
			}),
			INPUT,
			[],
			{ summarizer },
		);

		expect(outcome.status).toBe("failed");
	});

	it("keeps the original Prompt outcome when Summarizer returns blank output", async () => {
		for (const blank of ["", "   \n\t", "- \n- \n"]) {
			const summarizer = fakeSummarizer({ summarize: async () => blank });

			const outcome = await analyzePage(
				fakeClient({ prompt: async () => "not json" }),
				INPUT,
				[],
				{ summarizer: summarizer.client },
			);

			expect(outcome.status).toBe("failed");
			if (outcome.status !== "failed") return;
			expect(outcome.error.kind).not.toBe("client-error");
		}
	});

	it("accepts irregular nonblank Markdown that is not three key points", async () => {
		const summarizer = fakeSummarizer({
			summarize: async () => "This page explains one single thing.",
		});

		const outcome = await analyzePage(
			fakeClient({ availability: "unavailable" }),
			INPUT,
			[],
			{ summarizer: summarizer.client },
		);

		expect(outcome.status).toBe("ready");
		if (outcome.status !== "ready" || outcome.model !== "chrome-summarizer-api")
			return;
		expect(outcome.summary.description).toBe(
			"This page explains one single thing.",
		);
	});

	it("propagates the resolved output language to Summarizer", async () => {
		for (const language of ["ja", "en"] as const) {
			const summarizer = fakeSummarizer({});

			await analyzePage(
				fakeClient({ availability: "unavailable" }),
				{ ...INPUT, fallbackLanguage: language },
				[],
				{ summarizer: summarizer.client },
			);

			expect(summarizer.calls[0]?.language).toBe(language);
		}
	});

	it("sends the in-memory page text and never a profile instruction", async () => {
		const summarizer = fakeSummarizer({});

		await analyzePage(
			fakeClient({ availability: "unavailable" }),
			{ ...INPUT, url: "https://github.com/facebook/react" },
			[],
			{ summarizer: summarizer.client },
		);

		const sent = summarizer.calls[0]?.input ?? "";
		expect(sent).toContain(INPUT.excerpt);
		expect(sent).not.toContain("GitHub");
	});

	it("logs the fallback with safe metadata only", async () => {
		const logger = createMemoryLogger();
		const summarizer = fakeSummarizer({});

		await analyzePage(
			fakeClient({ availability: "unavailable" }),
			{ ...INPUT, fallbackLanguage: "ja" },
			[],
			{ logger, summarizer: summarizer.client },
		);

		expect(logger.entries).toContainEqual({
			level: "info",
			event: "ai.analysis.summarizer-fallback-ready",
			fields: { language: "ja" },
		});
		const serialized = JSON.stringify(logger.entries);
		expect(serialized).not.toContain(INPUT.excerpt);
		expect(serialized).not.toContain(INPUT.title);
		expect(serialized).not.toContain(INPUT.url);
		expect(serialized).not.toContain(SUMMARY_MARKDOWN);
	});

	it("logs a skipped fallback without leaking the browser failure text", async () => {
		const logger = createMemoryLogger();
		const summarizer = fakeSummarizer({
			summarize: async () => {
				const failure = new Error("secret browser detail");
				failure.name = "InvalidStateError";
				throw new SummarizerRunError(failure);
			},
		});

		await analyzePage(fakeClient({ availability: "unavailable" }), INPUT, [], {
			logger,
			summarizer: summarizer.client,
		});

		expect(
			logger.entries.some(
				(e) => e.event === "ai.analysis.summarizer-fallback-failed",
			),
		).toBe(true);
		expect(JSON.stringify(logger.entries)).not.toContain(
			"secret browser detail",
		);
	});
});
