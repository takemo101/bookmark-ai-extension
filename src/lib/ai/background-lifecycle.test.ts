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
