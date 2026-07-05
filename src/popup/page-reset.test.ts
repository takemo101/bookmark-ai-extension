import { describe, expect, it } from "vitest";

import { applyPopupPageReset } from "./page-reset";
import { palette } from "./styles";

describe("Popup page reset", () => {
	it("zeroes the browser default body margin and paints the paper background", () => {
		const body = { style: { margin: "8px", background: "" } };

		applyPopupPageReset(body);

		expect(body.style.margin).toBe("0");
		expect(body.style.background).toBe(palette.paper);
	});

	it("restores the previous margin and background on cleanup", () => {
		const body = { style: { margin: "8px", background: "white" } };

		const restore = applyPopupPageReset(body);
		restore();

		expect(body.style.margin).toBe("8px");
		expect(body.style.background).toBe("white");
	});
});
