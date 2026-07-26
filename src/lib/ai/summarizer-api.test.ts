import { describe, expect, it } from "vitest";

import {
	CONCISE_SUMMARY_OPTIONS,
	CONCISE_SUMMARY_SHARED_CONTEXT,
	SummarizerApiUnavailableError,
	SummarizerRunError,
	createChromeSummarizerClient,
} from "./summarizer-api";

/**
 * A fake Summarizer namespace. Nothing here touches a real Chrome global, so
 * the adapter stays deterministic and testable outside the browser.
 */
function fakeNamespace(options: {
	availability?: () => Promise<string>;
	create?: (options?: unknown) => Promise<{
		summarize(input: string): Promise<string>;
		destroy?(): void;
	}>;
}) {
	return {
		availability: options.availability ?? (async () => "available"),
		create:
			options.create ?? (async () => ({ summarize: async () => "- point" })),
	};
}

describe("createChromeSummarizerClient", () => {
	it("reports unavailable when no namespace is present", async () => {
		const client = createChromeSummarizerClient(null);
		expect(await client.availability()).toBe("unavailable");
	});

	it("throws SummarizerApiUnavailableError when summarizing with no namespace", async () => {
		const client = createChromeSummarizerClient(null);
		await expect(client.summarize("text")).rejects.toBeInstanceOf(
			SummarizerApiUnavailableError,
		);
	});

	it("normalizes availability strings", async () => {
		const make = (value: string) =>
			createChromeSummarizerClient(
				fakeNamespace({ availability: async () => value }),
			);
		expect(await make("available").availability()).toBe("available");
		expect(await make("downloadable").availability()).toBe("downloadable");
		expect(await make("downloading").availability()).toBe("downloading");
		expect(await make("no").availability()).toBe("unavailable");
		expect(await make("something-new").availability()).toBe("unavailable");
	});

	it("reports unavailable when the availability probe throws", async () => {
		const client = createChromeSummarizerClient(
			fakeNamespace({
				availability: async () => {
					throw new Error("boom");
				},
			}),
		);
		expect(await client.availability()).toBe("unavailable");
	});

	it("passes the fixed concise-summary options, shared context, and language", async () => {
		let seen: Record<string, unknown> | undefined;
		const client = createChromeSummarizerClient(
			fakeNamespace({
				create: async (options) => {
					seen = options as Record<string, unknown>;
					return { summarize: async () => "- point" };
				},
			}),
		);
		await client.summarize("page text", "ja");
		expect(seen?.type).toBe(CONCISE_SUMMARY_OPTIONS.type);
		expect(seen?.length).toBe(CONCISE_SUMMARY_OPTIONS.length);
		expect(seen?.format).toBe(CONCISE_SUMMARY_OPTIONS.format);
		expect(seen?.preference).toBe(CONCISE_SUMMARY_OPTIONS.preference);
		expect(seen?.outputLanguage).toBe("ja");
		expect(seen?.sharedContext).toBe(CONCISE_SUMMARY_SHARED_CONTEXT);
	});

	it("never starts a model download: no monitor is passed to create", async () => {
		let seen: Record<string, unknown> | undefined;
		const client = createChromeSummarizerClient(
			fakeNamespace({
				create: async (options) => {
					seen = options as Record<string, unknown>;
					return { summarize: async () => "- point" };
				},
			}),
		);
		await client.summarize("page text", "en");
		expect(seen).not.toHaveProperty("monitor");
	});

	it("returns the generated text and destroys the session", async () => {
		let destroyed = false;
		const client = createChromeSummarizerClient(
			fakeNamespace({
				create: async () => ({
					summarize: async (input: string) => `summary of ${input.length}`,
					destroy: () => {
						destroyed = true;
					},
				}),
			}),
		);
		expect(await client.summarize("abcd", "en")).toBe("summary of 4");
		expect(destroyed).toBe(true);
	});

	it("wraps a rejecting create in SummarizerRunError carrying only the error name", async () => {
		const browserError = new Error("secret excerpt leaked into the message");
		browserError.name = "NotSupportedError";
		const client = createChromeSummarizerClient(
			fakeNamespace({
				create: async () => {
					throw browserError;
				},
			}),
		);
		const error = await client.summarize("page text", "en").catch((e) => e);
		expect(error).toBeInstanceOf(SummarizerRunError);
		expect((error as SummarizerRunError).causeName).toBe("NotSupportedError");
		expect((error as SummarizerRunError).message).not.toContain("secret");
	});

	it("wraps a rejecting summarize in SummarizerRunError and destroys the session", async () => {
		let destroyed = false;
		const client = createChromeSummarizerClient(
			fakeNamespace({
				create: async () => ({
					summarize: async () => {
						const failure = new Error("raw page text in the failure");
						failure.name = "InvalidStateError";
						throw failure;
					},
					destroy: () => {
						destroyed = true;
					},
				}),
			}),
		);
		const error = await client.summarize("page text", "en").catch((e) => e);
		expect(error).toBeInstanceOf(SummarizerRunError);
		expect((error as SummarizerRunError).causeName).toBe("InvalidStateError");
		expect((error as SummarizerRunError).message).not.toContain(
			"raw page text",
		);
		expect(destroyed).toBe(true);
	});

	it("uses a fixed generic shared context with no profile name or instruction", () => {
		expect(CONCISE_SUMMARY_SHARED_CONTEXT.length).toBeGreaterThan(0);
		expect(CONCISE_SUMMARY_SHARED_CONTEXT).not.toMatch(/profile|skill|JSON/i);
	});
});
