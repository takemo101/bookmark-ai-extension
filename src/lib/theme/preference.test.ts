import { describe, expect, it } from "vitest";

import { parseThemePreference, resolveTheme } from "./preference";
import {
	darkThemePalette,
	lightThemePalette,
	statusColor,
	themePaletteFor,
} from "./tokens";

describe("parseThemePreference", () => {
	it("accepts the three valid preferences", () => {
		expect(parseThemePreference("light")).toBe("light");
		expect(parseThemePreference("dark")).toBe("dark");
		expect(parseThemePreference("system")).toBe("system");
	});

	it.each([
		undefined,
		null,
		42,
		"",
		"midnight",
		{ theme: "dark" },
		["dark"],
	])("falls back to system for invalid value %j", (value) => {
		expect(parseThemePreference(value)).toBe("system");
	});
});

describe("resolveTheme", () => {
	it("keeps explicit light/dark regardless of the system signal", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	it("resolves system against the system-dark signal", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
	});
});

describe("themePaletteFor", () => {
	it("selects the palette of the resolved theme", () => {
		expect(themePaletteFor("light")).toBe(lightThemePalette);
		expect(themePaletteFor("dark")).toBe(darkThemePalette);
	});

	it("keeps light paper the Warm Library value the page resets rely on", () => {
		expect(lightThemePalette.paper).toBe("#faf6ee");
	});

	it("uses distinct dark Deep Ledger surfaces", () => {
		expect(darkThemePalette.paper).not.toBe(lightThemePalette.paper);
		expect(darkThemePalette.ink).not.toBe(lightThemePalette.ink);
	});
});

describe("statusColor", () => {
	it("maps tones to the palette's status colors", () => {
		expect(statusColor(lightThemePalette, "ok")).toBe(lightThemePalette.ok);
		expect(statusColor(darkThemePalette, "warn")).toBe(darkThemePalette.warn);
		expect(statusColor(darkThemePalette, "danger")).toBe(
			darkThemePalette.danger,
		);
		expect(statusColor(lightThemePalette, "neutral")).toBe(
			lightThemePalette.inkFaint,
		);
	});
});
