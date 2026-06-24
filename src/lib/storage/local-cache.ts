/**
 * The local-cache port + its `chrome.storage.local` adapter.
 *
 * Use cases depend only on the small {@link LocalCache} port, never on the
 * Chrome global, so they stay testable without a browser (a plain in-memory fake
 * implements the port). The concrete adapter ({@link createChromeLocalCache})
 * wraps `chrome.storage.local`, parsing what it reads at the boundary and
 * serializing what it writes.
 *
 * The cache is a cache only: a corrupt or absent payload resolves to the empty
 * state rather than an error, because Google Drive — not this cache — is the
 * source of truth (docs/design.md "Local Cache").
 */
import { parseCachedState } from "./parse";
import { serializeCacheState } from "./serialize";
import { CACHE_KEY, type CacheState } from "./types";

/**
 * The port the app talks to. `load` always resolves to a valid state; `save`
 * persists the whole snapshot; `clear` removes it. Implementations must not
 * throw for a missing/corrupt entry — they return the empty state instead.
 */
export interface LocalCache {
	load(): Promise<CacheState>;
	save(state: CacheState): Promise<void>;
	clear(): Promise<void>;
}

/**
 * The narrow slice of `chrome.storage.local` the adapter needs. Declaring it as
 * a port (rather than importing the Chrome types) keeps the adapter unit-testable
 * with a trivial fake and pins the exact surface we rely on.
 */
export interface LocalCacheStorageArea {
	get(keys: string | string[] | null): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(keys: string | string[]): Promise<void>;
}

/**
 * Build a {@link LocalCache} backed by a `chrome.storage.local`-shaped area. The
 * area defaults to the real `chrome.storage.local` but can be injected for tests
 * or a future relocation. Reads are parsed; the empty state is returned when the
 * key is absent or the stored value is unusable.
 */
export function createChromeLocalCache(
	area: LocalCacheStorageArea = chrome.storage
		.local as unknown as LocalCacheStorageArea,
): LocalCache {
	return {
		async load(): Promise<CacheState> {
			const stored = await area.get(CACHE_KEY);
			// Parse at the boundary: never trust the persisted value directly.
			return parseCachedState(stored[CACHE_KEY]).state;
		},
		async save(state: CacheState): Promise<void> {
			await area.set({ [CACHE_KEY]: serializeCacheState(state) });
		},
		async clear(): Promise<void> {
			await area.remove(CACHE_KEY);
		},
	};
}
