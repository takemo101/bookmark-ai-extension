/**
 * The settings-cache port + its `chrome.storage.local` adapter.
 *
 * Parallel to `local-cache.ts`, but keyed and shaped separately
 * ({@link SETTINGS_CACHE_KEY} vs. `CACHE_KEY`) so a settings read/write never
 * touches the bookmark cache blob. Use cases depend only on the small
 * {@link SettingsCache} port, never on the Chrome global, so they stay
 * testable without a browser.
 */
import type { LocalCacheStorageArea } from "./local-cache";
import { parseCachedSettingsState } from "./settings-parse";
import { serializeSettingsCacheState } from "./settings-serialize";
import { SETTINGS_CACHE_KEY, type SettingsCacheState } from "./settings-types";

/**
 * The port the app talks to. `load` always resolves to a valid state; `save`
 * persists the whole snapshot; `clear` removes it. Implementations must not
 * throw for a missing/corrupt entry — they return the empty state instead.
 */
export interface SettingsCache {
	load(): Promise<SettingsCacheState>;
	save(state: SettingsCacheState): Promise<void>;
	clear(): Promise<void>;
}

/**
 * Build a {@link SettingsCache} backed by a `chrome.storage.local`-shaped area.
 * The area defaults to the real `chrome.storage.local` but can be injected for
 * tests. Reads are parsed; the empty state is returned when the key is absent
 * or the stored value is unusable.
 */
export function createChromeSettingsCache(
	area: LocalCacheStorageArea = chrome.storage
		.local as unknown as LocalCacheStorageArea,
): SettingsCache {
	return {
		async load(): Promise<SettingsCacheState> {
			const stored = await area.get(SETTINGS_CACHE_KEY);
			// Parse at the boundary: never trust the persisted value directly.
			return parseCachedSettingsState(stored[SETTINGS_CACHE_KEY]).state;
		},
		async save(state: SettingsCacheState): Promise<void> {
			await area.set({
				[SETTINGS_CACHE_KEY]: serializeSettingsCacheState(state),
			});
		},
		async clear(): Promise<void> {
			await area.remove(SETTINGS_CACHE_KEY);
		},
	};
}
