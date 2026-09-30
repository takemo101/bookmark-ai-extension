import { expect, it, vi } from "vitest";
import {
	createChromePromptClient,
	prepareChromePromptModel,
} from "./prompt-api";
import { createChromeSummarizerClient } from "./summarizer-api";

it("worker Prompt calls never create downloadable models, including probe/create races", async () => {
	const create = vi.fn();
	const namespace = { availability: vi.fn(async () => "downloadable"), create };
	const client = createChromePromptClient(namespace, { allowDownload: false });
	expect(await client.availability()).toBe("unavailable");
	await expect(client.prompt("private excerpt")).rejects.toThrow();
	expect(create).not.toHaveBeenCalled();
});

it("foreground preparation creates and destroys a model without submitting page content", async () => {
	const prompt = vi.fn();
	const destroy = vi.fn();
	const create = vi.fn(async () => ({ prompt, destroy }));
	await prepareChromePromptModel("en", undefined, {
		availability: async () => "downloadable",
		create,
	});
	expect(create).toHaveBeenCalledWith(
		expect.objectContaining({
			expectedOutputs: [{ type: "text", languages: ["en"] }],
		}),
	);
	expect(prompt).not.toHaveBeenCalled();
	expect(destroy).toHaveBeenCalledOnce();
});

it("destroys a late-created Prompt session after cancellation without prompting", async () => {
	const abort = new AbortController();
	const prompt = vi.fn();
	const destroy = vi.fn();
	let release!: (value: {
		prompt: typeof prompt;
		destroy: typeof destroy;
	}) => void;
	const client = createChromePromptClient(
		{
			availability: async () => "available",
			create: () =>
				new Promise((resolve) => {
					release = resolve;
				}),
		},
		{ signal: abort.signal },
	);
	const run = client.prompt("excerpt");
	abort.abort();
	release({ prompt, destroy });
	await expect(run).rejects.toThrow();
	expect(prompt).not.toHaveBeenCalled();
	expect(destroy).toHaveBeenCalledOnce();
});

it("never probes an aborted Prompt or Summarizer fallback", async () => {
	const abort = new AbortController();
	abort.abort();
	const namespace = {
		availability: vi.fn(async () => "available"),
		create: vi.fn(),
	};
	expect(
		await createChromePromptClient(namespace, {
			signal: abort.signal,
		}).availability(),
	).toBe("unavailable");
	expect(
		await createChromeSummarizerClient(namespace, {
			signal: abort.signal,
		}).availability(),
	).toBe("unavailable");
	expect(namespace.availability).not.toHaveBeenCalled();
});

it("does not create a worker Prompt session when stopped during the availability probe", async () => {
	const abort = new AbortController();
	let release!: (value: string) => void;
	const create = vi.fn();
	const client = createChromePromptClient(
		{
			availability: () =>
				new Promise((resolve) => {
					release = resolve;
				}),
			create,
		},
		{ allowDownload: false, signal: abort.signal },
	);
	const run = client.prompt("excerpt");
	abort.abort();
	release("available");
	await expect(run).rejects.toThrow();
	expect(create).not.toHaveBeenCalled();
});

it.each([
	"prompt",
	"summarize",
] as const)("destroys an in-flight %s session on abort", async (method) => {
	const abort = new AbortController();
	let release!: (value: string) => void;
	const generate = vi.fn(
		() =>
			new Promise<string>((resolve) => {
				release = resolve;
			}),
	);
	const destroy = vi.fn();
	const namespace = {
		availability: async () => "available",
		create: async () => ({ prompt: generate, summarize: generate, destroy }),
	};
	const run =
		method === "prompt"
			? createChromePromptClient(namespace, { signal: abort.signal }).prompt(
					"excerpt",
				)
			: createChromeSummarizerClient(namespace, {
					signal: abort.signal,
				}).summarize("excerpt");
	await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
	abort.abort();
	expect(destroy).toHaveBeenCalled();
	release("late result");
	await run;
});

it("passes cancellation to both native generation APIs and destroys active sessions", async () => {
	const abort = new AbortController();
	const prompt = vi.fn(async () => "result");
	const summarize = vi.fn(async () => "summary");
	const destroy = vi.fn();
	const namespace = {
		availability: async () => "available",
		create: vi.fn(async () => ({ prompt, summarize, destroy })),
	};
	await createChromePromptClient(namespace, { signal: abort.signal }).prompt(
		"input",
	);
	await createChromeSummarizerClient(namespace, {
		signal: abort.signal,
	}).summarize("input");
	expect(prompt).toHaveBeenCalledWith("input", { signal: abort.signal });
	expect(summarize).toHaveBeenCalledWith("input", { signal: abort.signal });
	expect(destroy).toHaveBeenCalledTimes(2);
});
