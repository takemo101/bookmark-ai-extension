import { describe, expect, it } from "vitest";

import { buildConciseSummary } from "./concise-summary";

describe("buildConciseSummary", () => {
	it("keeps the generated Markdown and joins its key points into one line", () => {
		const summary = buildConciseSummary(
			"- First key point\n- Second key point\n- Third key point\n",
		);
		expect(summary?.analysisMarkdown).toBe(
			"- First key point\n- Second key point\n- Third key point",
		);
		expect(summary?.description).toBe(
			"First key point / Second key point / Third key point",
		);
	});

	it("accepts irregular nonblank Markdown that is not a three-item list", () => {
		const summary = buildConciseSummary(
			"## 概要\n\n1. **最初**の要点\n2. 次の要点\n\nこのページは記事です。\n",
		);
		expect(summary).not.toBeNull();
		expect(summary?.analysisMarkdown).toContain("1. **最初**の要点");
		expect(summary?.description).toBe(
			"概要 / 最初の要点 / 次の要点 / このページは記事です。",
		);
	});

	it("collapses a multi-line single point into one plain-text line", () => {
		const summary = buildConciseSummary("A point\n  that wrapped\n");
		expect(summary?.description).toBe("A point / that wrapped");
		expect(summary?.description).not.toContain("\n");
	});

	it("strips inline Markdown emphasis and code marks from the description", () => {
		const summary = buildConciseSummary("- `code` and *emphasis* and __bold__");
		expect(summary?.description).toBe("code and emphasis and bold");
	});

	it("rejects blank output", () => {
		expect(buildConciseSummary("")).toBeNull();
		expect(buildConciseSummary("   \n\t\n  ")).toBeNull();
	});

	it("rejects output whose only content is Markdown punctuation", () => {
		expect(buildConciseSummary("- \n- \n")).toBeNull();
	});
});
