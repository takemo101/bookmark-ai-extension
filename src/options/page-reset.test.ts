import { describe, expect, it } from "vitest";

import { applyOptionsPageReset } from "./page-reset";

describe("Options page reset", () => {
	it("removes the browser default body margin while preserving the previous value for cleanup", () => {
		const body = { style: { margin: "8px" } };

		const restore = applyOptionsPageReset(body);

		expect(body.style.margin).toBe("0");

		restore();
		expect(body.style.margin).toBe("8px");
	});
});
