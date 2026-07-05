import { describe, expect, it } from "vitest";

import { darkThemePalette, lightThemePalette } from "../lib/theme/index";
import { applyPopupPageReset, paintPopupPageBackground } from "./page-reset";

describe("Popup page reset", () => {
	it("zeroes the browser default body margin and paints the light paper by default", () => {
		const body = { style: { margin: "8px", background: "" } };

		applyPopupPageReset(body);

		expect(body.style.margin).toBe("0");
		expect(body.style.background).toBe(lightThemePalette.paper);
	});

	it("paints the resolved theme paper when one is passed", () => {
		const body = { style: { margin: "8px", background: "" } };

		applyPopupPageReset(body, darkThemePalette.paper);

		expect(body.style.background).toBe(darkThemePalette.paper);
	});

	it("repaints the body when the active theme changes after mount", () => {
		const body = {
			style: { margin: "0", background: lightThemePalette.paper },
		};

		paintPopupPageBackground(body, darkThemePalette.paper);

		expect(body.style.background).toBe(darkThemePalette.paper);
	});

	it("restores the previous margin and background on cleanup", () => {
		const body = { style: { margin: "8px", background: "white" } };

		const restore = applyPopupPageReset(body);
		restore();

		expect(body.style.margin).toBe("8px");
		expect(body.style.background).toBe("white");
	});
});
