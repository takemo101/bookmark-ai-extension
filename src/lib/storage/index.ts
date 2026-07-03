/**
 * `storage/*` boundary.
 *
 * Owns the `chrome.storage.local` cache: the last bookmark snapshot, Drive
 * folder/file ids and revision metadata, and the last sync status/errors. It is
 * a cache only — Google Drive remains the source of truth (docs/design.md "Local
 * Cache"). External persisted data is parsed into always-valid types before any
 * internal use, and raw page excerpts are never stored.
 *
 * Surface:
 *   - {@link LocalCache} + {@link createChromeLocalCache} — the cache port and
 *     its `chrome.storage.local` adapter.
 *   - {@link parseCachedState} / {@link serializeCacheState} — the pure boundary
 *     parser and serializer (no Chrome needed).
 *   - {@link CacheState} and friends — the trusted in-memory view and its typed
 *     sync status/errors.
 *   - {@link SettingsCache} + {@link createChromeSettingsCache} — the parallel
 *     cache for `bookmark-ai/settings.json`'s custom skills, under its own
 *     `chrome.storage.local` key (MIK-018).
 */
export type { Result, Ok, Err } from "./result";
export { ok, err } from "./result";

export type {
	SyncStatus,
	SyncError,
	SyncState,
	CacheState,
	CachedStateV1,
	CachedDriveLocationV1,
	CachedSyncStateV1,
	CacheProblem,
	CacheProblemKind,
	CacheParseResult,
} from "./types";
export { CACHE_KEY, CACHE_SCHEMA_VERSION } from "./types";

export { parseCachedState, emptyCacheState } from "./parse";
export { serializeCacheState } from "./serialize";

export type { LocalCache, LocalCacheStorageArea } from "./local-cache";
export { createChromeLocalCache } from "./local-cache";

export type {
	SettingsCacheState,
	CachedSettingsStateV1,
	CachedSettingsDriveLocationV1,
	CachedSettingsSyncStateV1,
	SettingsCacheProblem,
	SettingsCacheProblemKind,
	SettingsCacheParseResult,
} from "./settings-types";
export {
	SETTINGS_CACHE_KEY,
	SETTINGS_CACHE_SCHEMA_VERSION,
} from "./settings-types";

export {
	parseCachedSettingsState,
	emptySettingsCacheState,
} from "./settings-parse";
export { serializeSettingsCacheState } from "./settings-serialize";

export type { SettingsCache } from "./settings-local-cache";
export { createChromeSettingsCache } from "./settings-local-cache";
