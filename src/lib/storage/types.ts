/**
 * Local-cache data shapes.
 *
 * The cache mirrors the rest of the codebase's on-the-wire / always-valid split:
 *   - {@link CachedStateV1} is the loose JSON shape persisted in
 *     `chrome.storage.local`. It is untrusted external data — anything could be
 *     stored there by an older build, another extension version, or a corrupted
 *     write — so it is parsed before any internal use (see
 *     docs/implementation-principles.md "Parse, don't validate").
 *   - {@link CacheState} is the trusted, always-valid view used inside the app:
 *     a first-class {@link Bookmarks} collection plus typed Drive metadata and a
 *     typed sync status. It can only be produced by `parseCachedState`.
 *
 * The cache is a cache only — Google Drive remains the source of truth
 * (docs/design.md "Local Cache"). Raw page excerpts are never stored here; only
 * serialized {@link BookmarkRecordV1} values (which themselves omit excerpts)
 * are persisted.
 */
import type {
	Bookmarks,
	BookmarkRecordV1,
	IsoTimestamp,
	TombstoneV1,
} from "../bookmarks/index";
import type { DriveLocation } from "../drive/index";

/** The single key the cache occupies in `chrome.storage.local`. */
export const CACHE_KEY = "bookmark-ai:cache";

/** Cache schema version, bumped if the persisted shape changes incompatibly. */
export const CACHE_SCHEMA_VERSION = 1;

/** The lifecycle of the last sync attempt against Drive. */
export type SyncStatus = "idle" | "syncing" | "synced" | "error";

/**
 * A typed, UI-safe summary of a failed sync. It carries only a stable `kind`
 * and a human-readable message; it never contains an OAuth token or raw page
 * excerpt (see AGENTS.md "Redact tokens and sensitive values").
 */
export type SyncError = {
	readonly kind: string;
	readonly message: string;
};

/** Trusted sync state: status plus an optional last-synced time and error. */
export type SyncState = {
	readonly status: SyncStatus;
	readonly lastSyncedAt?: IsoTimestamp;
	readonly error?: SyncError;
};

/**
 * Always-valid, in-memory cache view. Produced only by `parseCachedState`, so
 * malformed persisted data never leaks inward.
 */
export type CacheState = {
	readonly bookmarks: Bookmarks;
	readonly location?: DriveLocation;
	readonly sync: SyncState;
};

/** Serialized Drive location stored alongside the snapshot. */
export type CachedDriveLocationV1 = {
	folderId: string;
	folderName: string;
	fileId: string;
	fileName: string;
	revision: string;
};

/** Serialized sync state. */
export type CachedSyncStateV1 = {
	status: SyncStatus;
	lastSyncedAt?: string;
	error?: SyncError;
};

/** Loose JSON shape persisted in `chrome.storage.local`. Untrusted. */
export type CachedStateV1 = {
	schemaVersion: 1;
	bookmarks: BookmarkRecordV1[];
	/**
	 * Deletion tombstones, cached so a local delete is not resurrected before the
	 * next Drive sync confirms it (docs/design.md "Local Cache"). Optional for
	 * backward compatibility with caches written before tombstones existed.
	 */
	tombstones?: TombstoneV1[];
	drive?: CachedDriveLocationV1;
	sync: CachedSyncStateV1;
};

/** A problem encountered while parsing persisted cache data, for diagnostics. */
export type CacheProblemKind =
	| "not-an-object"
	| "unsupported-schema"
	| "invalid-record"
	| "invalid-location"
	| "invalid-sync";

export type CacheProblem = {
	readonly kind: CacheProblemKind;
	readonly message: string;
};

/** Result of parsing persisted data: an always-valid state plus any problems. */
export type CacheParseResult = {
	readonly state: CacheState;
	readonly problems: readonly CacheProblem[];
};
