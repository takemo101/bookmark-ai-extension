/**
 * Local-only theme preference persistence.
 *
 * The `light`/`dark`/`system` selection is device-local UI state: it lives in
 * `chrome.storage.local` under its own key and is never written to Google
 * Drive or `bookmark-ai/settings.json` (task 07-05 decision; docs/design.md
 * "Theme"). Reads are parsed at the boundary — a missing, corrupt, or
 * unreadable value resolves to the `system` default rather than an error,
 * because the preference is cosmetic and must never block the UI.
 */
import {
	DEFAULT_THEME_PREFERENCE,
	type ThemePreference,
	parseThemePreference,
} from "./preference";

/** The `chrome.storage.local` key holding the theme preference. */
export const THEME_PREFERENCE_KEY = "bookmark-ai:theme-preference";

/**
 * The narrow slice of `chrome.storage.local` the storage needs. Declared as a
 * port (mirroring `storage/*`'s `LocalCacheStorageArea`) so tests inject a
 * plain in-memory fake and the exact surface we rely on stays pinned.
 */
export interface ThemePreferenceStorageArea {
	get(keys: string | string[] | null): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
}

/** The port the theme store talks to. `load` always resolves to a valid preference. */
export interface ThemePreferenceStorage {
	load(): Promise<ThemePreference>;
	save(preference: ThemePreference): Promise<void>;
}

/**
 * Build a {@link ThemePreferenceStorage} backed by a `chrome.storage.local`-
 * shaped area. The area defaults to the real `chrome.storage.local` but is
 * injectable for tests. A read failure resolves to the `system` default; a
 * write failure propagates so callers can decide (the theme store swallows it
 * — the in-memory selection still applies for the open page).
 */
export function createThemePreferenceStorage(
	area: ThemePreferenceStorageArea = chrome.storage
		.local as unknown as ThemePreferenceStorageArea,
): ThemePreferenceStorage {
	return {
		async load(): Promise<ThemePreference> {
			try {
				const stored = await area.get(THEME_PREFERENCE_KEY);
				// Parse at the boundary: never trust the persisted value directly.
				return parseThemePreference(stored[THEME_PREFERENCE_KEY]);
			} catch {
				return DEFAULT_THEME_PREFERENCE;
			}
		},
		async save(preference: ThemePreference): Promise<void> {
			await area.set({ [THEME_PREFERENCE_KEY]: preference });
		},
	};
}
