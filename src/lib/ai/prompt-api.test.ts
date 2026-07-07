import { describe, expect, it } from "vitest";

import { createMemoryLogger } from "../logging/index";
import {
	PromptApiUnavailableError,
	PromptSessionCreateError,
	type PromptLifecycleEvent,
	createChromeAskAiPromptSessionFactory,
	createChromeAskAiRecommendationRunner,
	createChromePromptClient,
} from "./prompt-api";

/**
 * A fake `create()` whose options invoke the adapter's `monitor` callback and
 * then fire the given `downloadprogress` events — the shape Chrome uses when
 * `availability` is downloadable/downloading.
 */
function createWithDownload(
	events: readonly unknown[],
	session: { prompt(input: string): Promise<string>; destroy?(): void } = {
		prompt: async () => "model output",
	},
) {
	let sawMonitor = false;
	const create = async (options?: unknown) => {
		const monitor = (options as { monitor?: (m: unknown) => void }).monitor;
		sawMonitor = typeof monitor === "function";
		const listeners: Array<(event: unknown) => void> = [];
		monitor?.({
			addEventListener(type: string, listener: (event: unknown) => void) {
				if (type === "downloadprogress") listeners.push(listener);
			},
		});
		for (const event of events) {
			for (const listener of listeners) listener(event);
		}
		return session;
	};
	return { create, sawMonitor: () => sawMonitor };
}

/**
 * These tests inject a fake language-model namespace rather than touching a real
 * Chrome global, so they stay pure and deterministic.
 */
describe("createChromePromptClient", () => {
	it("reports unavailable when no namespace is present", async () => {
		const client = createChromePromptClient(null);
		expect(await client.availability()).toBe("unavailable");
	});

	it("throws PromptApiUnavailableError when prompting with no namespace", async () => {
		const client = createChromePromptClient(null);
		await expect(client.prompt("hi")).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);
	});

	it("normalizes availability strings", async () => {
		const make = (value: string) =>
			createChromePromptClient({
				availability: async () => value,
				create: async () => ({ prompt: async () => "" }),
			});
		expect(await make("available").availability()).toBe("available");
		expect(await make("downloadable").availability()).toBe("downloadable");
		expect(await make("downloading").availability()).toBe("downloading");
		expect(await make("readily").availability()).toBe("available");
		expect(await make("after-download").availability()).toBe("downloadable");
		expect(await make("no").availability()).toBe("unavailable");
		expect(await make("???").availability()).toBe("unavailable");
	});

	it("passes Japanese expected output language to availability probes by default", async () => {
		let availabilityOptions: unknown;
		const client = createChromePromptClient({
			availability: async (options) => {
				availabilityOptions = options;
				return "available";
			},
			create: async () => ({ prompt: async () => "" }),
		});

		expect(await client.availability()).toBe("available");
		expect(availabilityOptions).toMatchObject({
			expectedOutputs: [{ type: "text", languages: ["ja"] }],
		});
	});

	it("passes the requested language to availability probes (MIK-029)", async () => {
		let availabilityOptions: unknown;
		const client = createChromePromptClient({
			availability: async (options) => {
				availabilityOptions = options;
				return "available";
			},
			create: async () => ({ prompt: async () => "" }),
		});

		expect(await client.availability("en")).toBe("available");
		expect(availabilityOptions).toMatchObject({
			expectedOutputs: [{ type: "text", languages: ["en"] }],
		});

		expect(await client.availability("ja")).toBe("available");
		expect(availabilityOptions).toMatchObject({
			expectedOutputs: [{ type: "text", languages: ["ja"] }],
		});
	});

	it("treats a throwing availability probe as unavailable", async () => {
		const client = createChromePromptClient({
			availability: async () => {
				throw new Error("boom");
			},
			create: async () => ({ prompt: async () => "" }),
		});
		expect(await client.availability()).toBe("unavailable");
	});

	it("creates a Japanese-output session, returns its text, and destroys it", async () => {
		let destroyed = false;
		let promptedWith = "";
		let createOptions: unknown;
		const client = createChromePromptClient({
			availability: async () => "available",
			create: async (options) => {
				createOptions = options;
				return {
					prompt: async (input: string) => {
						promptedWith = input;
						return "model output";
					},
					destroy: () => {
						destroyed = true;
					},
				};
			},
		});
		const out = await client.prompt("question");
		expect(out).toBe("model output");
		expect(promptedWith).toBe("question");
		expect(createOptions).toMatchObject({
			expectedOutputs: [{ type: "text", languages: ["ja"] }],
		});
		expect(destroyed).toBe(true);
	});

	it("creates an English-output session with an English system prompt (MIK-029)", async () => {
		let createOptions: unknown;
		const client = createChromePromptClient({
			availability: async () => "available",
			create: async (options) => {
				createOptions = options;
				return { prompt: async () => "model output" };
			},
		});

		expect(await client.prompt("question", "en")).toBe("model output");
		expect(createOptions).toMatchObject({
			expectedOutputs: [{ type: "text", languages: ["en"] }],
		});
		const options = createOptions as {
			initialPrompts: readonly { role: string; content: string }[];
		};
		expect(options.initialPrompts[0]?.role).toBe("system");
		expect(options.initialPrompts[0]?.content).toContain("English");
		expect(options.initialPrompts[0]?.content).not.toContain("日本語");
	});

	it("destroys the session even when prompting throws", async () => {
		let destroyed = false;
		const client = createChromePromptClient({
			availability: async () => "available",
			create: async () => ({
				prompt: async () => {
					throw new Error("prompt failed");
				},
				destroy: () => {
					destroyed = true;
				},
			}),
		});
		await expect(client.prompt("question")).rejects.toThrow("prompt failed");
		expect(destroyed).toBe(true);
	});

	it("passes a monitor to create and forwards normalized downloadprogress events", async () => {
		const fake = createWithDownload([
			{ loaded: 0.5 }, // fraction shape (no total)
			{ loaded: 5, total: 10 }, // byte-count shape
			{ loaded: "bogus" }, // malformed → ignored
			null, // malformed → ignored
			{ loaded: -1 }, // malformed → ignored
		]);
		const events: PromptLifecycleEvent[] = [];
		const client = createChromePromptClient({
			availability: async () => "downloadable",
			create: fake.create,
		});

		const out = await client.prompt("secret question text", "ja", (event) =>
			events.push(event),
		);

		expect(out).toBe("model output");
		expect(fake.sawMonitor()).toBe(true);
		expect(events).toEqual([
			{ kind: "download-progress", loaded: 0.5, total: undefined, ratio: 0.5 },
			{ kind: "download-progress", loaded: 5, total: 10, ratio: 0.5 },
			{ kind: "session-created" },
		]);
		// Lifecycle events carry safe numbers only — never prompt/page content.
		expect(JSON.stringify(events)).not.toContain("secret question text");
	});

	it("still passes a monitor and completes when no observer is given", async () => {
		const fake = createWithDownload([{ loaded: 0.25 }]);
		const client = createChromePromptClient({
			availability: async () => "downloading",
			create: fake.create,
		});

		expect(await client.prompt("question")).toBe("model output");
		expect(fake.sawMonitor()).toBe(true);
	});

	it("tolerates a throwing observer without affecting the prompt", async () => {
		const fake = createWithDownload([{ loaded: 0.5 }]);
		const client = createChromePromptClient({
			availability: async () => "downloadable",
			create: fake.create,
		});

		const out = await client.prompt("question", "ja", () => {
			throw new Error("observer blew up");
		});

		expect(out).toBe("model output");
	});

	it("wraps a rejecting create (download/session failure) in PromptSessionCreateError", async () => {
		const events: PromptLifecycleEvent[] = [];
		const client = createChromePromptClient({
			availability: async () => "downloadable",
			create: async () => {
				const error = new Error("out of disk while downloading the model");
				error.name = "QuotaExceededError";
				throw error;
			},
		});

		const rejection = await client
			.prompt("question", "ja", (event) => events.push(event))
			.then(
				() => null,
				(error: unknown) => error,
			);

		expect(rejection).toBeInstanceOf(PromptSessionCreateError);
		const wrapped = rejection as PromptSessionCreateError;
		expect(wrapped.causeName).toBe("QuotaExceededError");
		// The wrapped message carries only the cause's *name*, never its message.
		expect(wrapped.message).not.toContain("out of disk");
		// No session was created, so no session-created event fired.
		expect(events).toEqual([]);
	});
});

/**
 * The MIK-046 Ask AI recommendation runner: same fake-namespace approach. It
 * uses the recommendation prompt's own system instruction (never the analysis
 * system prompt) and throws PromptApiUnavailableError whenever the Prompt API
 * cannot run right now, so the Ask AI controller falls back to local cards.
 */
describe("createChromeAskAiRecommendationRunner", () => {
	const request = {
		systemInstruction: "recommend saved bookmarks as JSON",
		prompt: "User question:\nfind typescript notes",
	};

	it("throws PromptApiUnavailableError when no namespace is present", async () => {
		const run = createChromeAskAiRecommendationRunner(null);
		await expect(run(request)).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);
	});

	it("throws PromptApiUnavailableError when the model is unavailable", async () => {
		const run = createChromeAskAiRecommendationRunner({
			availability: async () => "unavailable",
			create: async () => ({ prompt: async () => "" }),
		});

		await expect(run(request)).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);
	});

	it("starts model download for downloadable / downloading states and reports safe progress", async () => {
		for (const state of ["downloadable", "downloading"] as const) {
			const logger = createMemoryLogger();
			const fake = createWithDownload([
				{ loaded: 0 },
				{ loaded: 4, total: 10 },
			]);
			const events: PromptLifecycleEvent[] = [];
			const run = createChromeAskAiRecommendationRunner(
				{
					availability: async () => state,
					create: fake.create,
				},
				{ logger },
			);

			expect(await run(request, "en", (event) => events.push(event))).toBe(
				"model output",
			);

			expect(fake.sawMonitor()).toBe(true);
			expect(events).toEqual([
				{ kind: "download-progress", loaded: 0, total: undefined, ratio: 0 },
				{ kind: "download-progress", loaded: 4, total: 10, ratio: 0.4 },
				{ kind: "session-created" },
			]);
			expect(logger.entries).toEqual([
				{
					level: "info",
					event: "ai.ask-ai.model-download-required",
					fields: {
						availability: state,
						language: "en",
						context: "recommendation",
					},
				},
				{
					level: "debug",
					event: "ai.ask-ai.model-download-progress",
					fields: {
						loaded: 0,
						ratio: 0,
						language: "en",
						context: "recommendation",
					},
				},
				{
					level: "debug",
					event: "ai.ask-ai.model-download-progress",
					fields: {
						loaded: 4,
						total: 10,
						ratio: 0.4,
						language: "en",
						context: "recommendation",
					},
				},
				{
					level: "info",
					event: "ai.ask-ai.session-created",
					fields: { language: "en", context: "recommendation" },
				},
			]);
			expect(JSON.stringify(logger.entries)).not.toContain("typescript notes");
			expect(JSON.stringify(events)).not.toContain("typescript notes");
		}
	});

	it("throws PromptApiUnavailableError when the availability probe throws", async () => {
		const run = createChromeAskAiRecommendationRunner({
			availability: async () => {
				throw new Error("boom");
			},
			create: async () => ({ prompt: async () => "" }),
		});
		await expect(run(request)).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);
	});

	it("logs a safe event when the availability probe throws", async () => {
		const logger = createMemoryLogger();
		const run = createChromeAskAiRecommendationRunner(
			{
				availability: async () => {
					throw new TypeError("probe blew up");
				},
				create: async () => ({ prompt: async () => "" }),
			},
			{ logger },
		);

		await expect(run(request)).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);

		expect(logger.entries).toEqual([
			{
				level: "warn",
				event: "ai.ask-ai.availability-threw",
				fields: {
					errorName: "TypeError",
					language: "ja",
					context: "recommendation",
				},
			},
		]);
	});

	it("logs session creation without prompt content when the model is available", async () => {
		const logger = createMemoryLogger();
		const run = createChromeAskAiRecommendationRunner(
			{
				availability: async () => "available",
				create: async () => ({ prompt: async () => "ok" }),
			},
			{ logger },
		);

		expect(await run(request)).toBe("ok");
		expect(logger.entries).toEqual([
			{
				level: "info",
				event: "ai.ask-ai.session-created",
				fields: { language: "ja", context: "recommendation" },
			},
		]);
		expect(JSON.stringify(logger.entries)).not.toContain("typescript notes");
	});

	it("runs the recommendation prompt with its own system instruction and destroys the session", async () => {
		let destroyed = false;
		let promptedWith = "";
		let createOptions: unknown;
		const run = createChromeAskAiRecommendationRunner({
			availability: async () => "available",
			create: async (options) => {
				createOptions = options;
				return {
					prompt: async (input: string) => {
						promptedWith = input;
						return '{"message":"ok","recommendations":[]}';
					},
					destroy: () => {
						destroyed = true;
					},
				};
			},
		});

		const out = await run(request, "en");

		expect(out).toBe('{"message":"ok","recommendations":[]}');
		expect(promptedWith).toBe(request.prompt);
		expect(createOptions).toMatchObject({
			initialPrompts: [
				{ role: "system", content: "recommend saved bookmarks as JSON" },
			],
			expectedOutputs: [{ type: "text", languages: ["en"] }],
		});
		expect(destroyed).toBe(true);
	});

	it("defaults the expected output language to Japanese", async () => {
		let createOptions: unknown;
		const run = createChromeAskAiRecommendationRunner({
			availability: async () => "available",
			create: async (options) => {
				createOptions = options;
				return { prompt: async () => "out" };
			},
		});

		expect(await run(request)).toBe("out");
		expect(createOptions).toMatchObject({
			expectedOutputs: [{ type: "text", languages: ["ja"] }],
		});
	});

	it("destroys the session even when the recommendation prompt throws", async () => {
		let destroyed = false;
		const run = createChromeAskAiRecommendationRunner({
			availability: async () => "available",
			create: async () => ({
				prompt: async () => {
					throw new Error("prompt failed");
				},
				destroy: () => {
					destroyed = true;
				},
			}),
		});

		await expect(run(request)).rejects.toThrow("prompt failed");
		expect(destroyed).toBe(true);
	});
});

/**
 * The MIK-048 Ask AI chat session factory: unlike the one-shot runner above,
 * the created session stays open across prompts (one Prompt API session per
 * Ask AI chat session) and the caller decides when to destroy it. Availability
 * failures throw PromptApiUnavailableError so the Ask AI controller degrades
 * to the per-turn runner.
 */
describe("createChromeAskAiPromptSessionFactory", () => {
	const systemInstruction = "recommend saved bookmarks as JSON";

	it("throws PromptApiUnavailableError when no namespace is present", async () => {
		const createSession = createChromeAskAiPromptSessionFactory(null);
		await expect(createSession(systemInstruction)).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);
	});

	it("throws PromptApiUnavailableError when the model is unavailable", async () => {
		const createSession = createChromeAskAiPromptSessionFactory({
			availability: async () => "unavailable",
			create: async () => ({ prompt: async () => "" }),
		});

		await expect(createSession(systemInstruction)).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);
	});

	it("starts model download for downloadable / downloading chat-session states", async () => {
		for (const state of ["downloadable", "downloading"] as const) {
			const logger = createMemoryLogger();
			const fake = createWithDownload([{ loaded: 0.25 }]);
			const events: PromptLifecycleEvent[] = [];
			const createSession = createChromeAskAiPromptSessionFactory(
				{
					availability: async () => state,
					create: fake.create,
				},
				{ logger },
			);

			const session = await createSession(systemInstruction, "ja", (event) =>
				events.push(event),
			);

			expect(fake.sawMonitor()).toBe(true);
			expect(await session.prompt("question")).toBe("model output");
			expect(events).toEqual([
				{
					kind: "download-progress",
					loaded: 0.25,
					total: undefined,
					ratio: 0.25,
				},
				{ kind: "session-created" },
			]);
			expect(logger.entries[0]).toEqual({
				level: "info",
				event: "ai.ask-ai.model-download-required",
				fields: {
					availability: state,
					language: "ja",
					context: "chat-session",
				},
			});
			expect(JSON.stringify(logger.entries)).not.toContain(systemInstruction);
		}
	});

	it("throws PromptApiUnavailableError when the availability probe throws", async () => {
		const createSession = createChromeAskAiPromptSessionFactory({
			availability: async () => {
				throw new Error("boom");
			},
			create: async () => ({ prompt: async () => "" }),
		});
		await expect(createSession(systemInstruction)).rejects.toBeInstanceOf(
			PromptApiUnavailableError,
		);
	});

	it("keeps one underlying session open across prompts and destroys on demand", async () => {
		let created = 0;
		let destroyed = false;
		const prompts: string[] = [];
		let createOptions: unknown;
		const createSession = createChromeAskAiPromptSessionFactory({
			availability: async () => "available",
			create: async (options) => {
				created += 1;
				createOptions = options;
				return {
					prompt: async (input: string) => {
						prompts.push(input);
						return `answer ${prompts.length}`;
					},
					destroy: () => {
						destroyed = true;
					},
				};
			},
		});

		const session = await createSession(systemInstruction, "en");
		expect(await session.prompt("first question")).toBe("answer 1");
		expect(await session.prompt("follow-up question")).toBe("answer 2");

		expect(created).toBe(1);
		expect(prompts).toEqual(["first question", "follow-up question"]);
		expect(createOptions).toMatchObject({
			initialPrompts: [{ role: "system", content: systemInstruction }],
			expectedOutputs: [{ type: "text", languages: ["en"] }],
		});
		expect(destroyed).toBe(false);

		session.destroy();
		expect(destroyed).toBe(true);
	});

	it("defaults the expected output language to Japanese", async () => {
		let createOptions: unknown;
		const createSession = createChromeAskAiPromptSessionFactory({
			availability: async () => "available",
			create: async (options) => {
				createOptions = options;
				return { prompt: async () => "out" };
			},
		});

		const session = await createSession(systemInstruction);
		expect(await session.prompt("question")).toBe("out");
		expect(createOptions).toMatchObject({
			expectedOutputs: [{ type: "text", languages: ["ja"] }],
		});
	});

	it("tolerates a browser session without a destroy method", async () => {
		const createSession = createChromeAskAiPromptSessionFactory({
			availability: async () => "available",
			create: async () => ({ prompt: async () => "out" }),
		});

		const session = await createSession(systemInstruction);
		expect(() => session.destroy()).not.toThrow();
	});
});
