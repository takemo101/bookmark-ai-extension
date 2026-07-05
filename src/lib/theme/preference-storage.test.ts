import { describe, expect, it } from "vitest";

import {
	THEME_PREFERENCE_KEY,
	type ThemePreferenceStorageArea,
	createThemePreferenceStorage,
} from "./preference-storage";

/** A plain in-memory `chrome.storage.local` fake. */
function fakeArea(initial: Record<string, unknown> = {}): {
	area: ThemePreferenceStorageArea;
	values: Record<string, unknown>;
} {
	const values = { ...initial };
	return {
		values,
		area: {
			get: async () => ({ ...values }),
			set: async (items) => {
				Object.assign(values, items);
			},
		},
	};
}

describe("theme preference storage", () => {
	it("loads system when nothing is stored", async () => {
		const storage = createThemePreferenceStorage(fakeArea().area);
		expect(await storage.load()).toBe("system");
	});

	it("loads system when the stored value is invalid", async () => {
		const { area } = fakeArea({ [THEME_PREFERENCE_KEY]: "midnight" });
		const storage = createThemePreferenceStorage(area);
		expect(await storage.load()).toBe("system");
	});

	it("loads system when the storage area read fails", async () => {
		const storage = createThemePreferenceStorage({
			get: async () => {
				throw new Error("storage broken");
			},
			set: async () => {},
		});
		expect(await storage.load()).toBe("system");
	});

	it("round-trips a saved preference under its own key", async () => {
		const { area, values } = fakeArea();
		const storage = createThemePreferenceStorage(area);

		await storage.save("dark");

		expect(values[THEME_PREFERENCE_KEY]).toBe("dark");
		expect(await storage.load()).toBe("dark");
	});
});
