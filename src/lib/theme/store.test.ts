import { describe, expect, it } from "vitest";

import type { ThemePreference } from "./preference";
import type { ThemePreferenceStorage } from "./preference-storage";
import { type SystemDarkSource, createThemeStore } from "./store";
import { darkThemePalette, lightThemePalette } from "./tokens";

function fakeStorage(initial: ThemePreference = "system"): {
	storage: ThemePreferenceStorage;
	saved: ThemePreference[];
} {
	const saved: ThemePreference[] = [];
	let value = initial;
	return {
		saved,
		storage: {
			load: async () => value,
			save: async (preference) => {
				value = preference;
				saved.push(preference);
			},
		},
	};
}

function fakeSystemDark(initialDark: boolean): SystemDarkSource & {
	setDark(dark: boolean): void;
} {
	let dark = initialDark;
	const listeners = new Set<() => void>();
	return {
		prefersDark: () => dark,
		subscribe(onChange) {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		setDark(next) {
			dark = next;
			for (const listener of listeners) {
				listener();
			}
		},
	};
}

describe("theme store", () => {
	it("starts as system, following the system-dark signal", async () => {
		const store = createThemeStore({
			storage: fakeStorage().storage,
			systemDark: fakeSystemDark(true),
		});
		await store.init();

		expect(store.getState().preference).toBe("system");
		expect(store.getState().resolved).toBe("dark");
		expect(store.getState().palette).toBe(darkThemePalette);
	});

	it("loads a persisted explicit preference on init", async () => {
		const store = createThemeStore({
			storage: fakeStorage("dark").storage,
			systemDark: fakeSystemDark(false),
		});
		await store.init();

		expect(store.getState().resolved).toBe("dark");
	});

	it("follows a system scheme change only while preference is system", async () => {
		const systemDark = fakeSystemDark(false);
		const store = createThemeStore({
			storage: fakeStorage().storage,
			systemDark,
		});
		await store.init();

		systemDark.setDark(true);
		expect(store.getState().resolved).toBe("dark");

		await store.setPreference("light");
		systemDark.setDark(false);
		systemDark.setDark(true);
		expect(store.getState().resolved).toBe("light");
	});

	it("applies and persists setPreference, notifying subscribers", async () => {
		const { storage, saved } = fakeStorage();
		const store = createThemeStore({
			storage,
			systemDark: fakeSystemDark(false),
		});
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});

		await store.setPreference("dark");

		expect(store.getState().preference).toBe("dark");
		expect(store.getState().palette).toBe(darkThemePalette);
		expect(saved).toEqual(["dark"]);
		expect(notified).toBe(1);
	});

	it("keeps the in-memory selection when the storage write fails", async () => {
		const store = createThemeStore({
			storage: {
				load: async () => "system",
				save: async () => {
					throw new Error("write failed");
				},
			},
			systemDark: fakeSystemDark(false),
		});

		await store.setPreference("dark");

		expect(store.getState().resolved).toBe("dark");
	});

	it("keeps snapshot identity stable between changes", async () => {
		const store = createThemeStore({
			storage: fakeStorage().storage,
			systemDark: fakeSystemDark(false),
		});
		const before = store.getState();
		await store.init();
		expect(store.getState()).toBe(before);
		expect(store.getState().palette).toBe(lightThemePalette);
	});
});
