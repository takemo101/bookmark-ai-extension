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
