import { describe, expect, it } from "vitest";

import {
	PromptApiUnavailableError,
	createChromePromptClient,
} from "./prompt-api";

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
});
