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
