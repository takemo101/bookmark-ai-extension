import { afterEach, expect, it, vi } from "vitest";
import { createBackgroundAnalyzer } from "./background-analyzer";
import type { AnalysisOutcome } from "../ai/index";

afterEach(() => vi.useRealTimers());
it("bounds hung analysis, aborts native work and ignores a late result", async () => {
	vi.useFakeTimers();
	let signal: AbortSignal | undefined;
	let release!: (value: AnalysisOutcome) => void;
	const analyzer = createBackgroundAnalyzer((s) => {
		signal = s;
		return {
			analyze: () =>
				new Promise((resolve) => {
					release = resolve;
				}),
		};
	});
	const run = analyzer.analyze({
		title: "Example",
		url: "https://example.test",
		excerpt: "private text",
	});
	await vi.advanceTimersByTimeAsync(180_000);
	expect(await run).toMatchObject({ status: "failed" });
	expect(signal?.aborted).toBe(true);
	release({ status: "unavailable", reason: "late" });
	expect(await run).toMatchObject({ status: "failed" });
	expect(vi.getTimerCount()).toBe(0);
});
it("stops native work immediately, clears its deadline and ignores a late result", async () => {
	vi.useFakeTimers();
	const stop = new AbortController();
	let nativeSignal: AbortSignal | undefined;
	let release!: (value: AnalysisOutcome) => void;
	const analyzer = createBackgroundAnalyzer((signal) => {
		nativeSignal = signal;
		return {
			analyze: () =>
				new Promise((resolve) => {
					release = resolve;
				}),
		};
	}, stop.signal);
	const run = analyzer.analyze({
		title: "Example",
		url: "https://example.test",
		excerpt: "private text",
	});
	stop.abort();
	expect(await run).toMatchObject({ status: "failed" });
	expect(nativeSignal?.aborted).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
	release({ status: "unavailable", reason: "late" });
	expect(await run).toMatchObject({ status: "failed" });
});

it("cancellation wins even when analysis resolves in the same turn", async () => {
	const stop = new AbortController();
	const analyzer = createBackgroundAnalyzer(() => {
		stop.abort();
		return {
			analyze: async () => ({
				status: "unavailable" as const,
				reason: "too late",
			}),
		};
	}, stop.signal);
	expect(
		await analyzer.analyze({
			title: "Example",
			url: "https://example.test",
			excerpt: "private text",
		}),
	).toMatchObject({ status: "failed" });
});

it("does not start already-cancelled analysis", async () => {
	const stop = new AbortController();
	stop.abort();
	const create = vi.fn();
	const result = await createBackgroundAnalyzer(create, stop.signal).analyze({
		title: "Example",
		url: "https://example.test",
		excerpt: "private text",
	});
	expect(result.status).toBe("failed");
	expect(create).not.toHaveBeenCalled();
});

it("cleans up on success and does not expose browser error text", async () => {
	const analyzer = createBackgroundAnalyzer(() => ({
		analyze: async () => {
			throw new Error("private text");
		},
	}));
	const result = await analyzer.analyze({
		title: "Example",
		url: "https://example.test",
		excerpt: "private text",
	});
	expect(result.status).toBe("failed");
	expect(JSON.stringify(result)).not.toContain("private text");
});
