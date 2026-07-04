import { describe, expect, it } from "vitest";

import { analyzePage } from "./analyze-page";
import type { AnalysisProfile } from "./profile";
import {
	type PromptApiAvailability,
	type PromptClient,
	PromptApiUnavailableError,
} from "./prompt-api";
import type { AnalysisInput } from "./types";

const INPUT: AnalysisInput = {
	title: "Example",
	url: "https://example.com",
	excerpt: "本文の抜粋テキスト。",
};

/** Build a fake client; no Chrome / Prompt API involved. */
function fakeClient(opts: {
	availability?: PromptApiAvailability | (() => Promise<PromptApiAvailability>);
	prompt?: (input: string) => Promise<string>;
}): PromptClient {
	return {
		availability: async () => {
			const a = opts.availability ?? "available";
			return typeof a === "function" ? a() : a;
		},
		prompt: opts.prompt ?? (async () => "{}"),
	};
}

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
		if (outcome.status !== "ready") return;
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
		if (outcome.status !== "ready") return;
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

	it("treats downloadable / downloading as unavailable (not ready)", async () => {
		for (const a of ["downloadable", "downloading"] as const) {
			const outcome = await analyzePage(fakeClient({ availability: a }), INPUT);
			expect(outcome.status).toBe("unavailable");
		}
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
		if (outcome.status !== "ready") return;
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
		if (outcome.status !== "ready") return;
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
		if (outcome.status !== "ready") return;
		expect(outcome.profileId).toBe("github-repository");
	});
});
