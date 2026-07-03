/**
 * Local-cache data shapes for `bookmark-ai/settings.json`'s custom skills.
 *
 * Mirrors `storage/types.ts`'s bookmark-cache split (on-the-wire
 * {@link CachedSettingsStateV1} vs. always-valid {@link SettingsCacheState}),
 * but stored under its own `chrome.storage.local` key
 * ({@link SETTINGS_CACHE_KEY}) so a settings-cache read/write never touches
 * the bookmark cache blob (two independent schemas, two independent keys).
 *
 * The cache is a cache only — Google Drive remains the source of truth for
 * `bookmark-ai/settings.json`, exactly as for the bookmark store
 * (docs/design.md "Local Cache").
 */
import type { DriveLocation } from "../drive/index";
import type { AnalysisSkillV1, Settings } from "../settings/index";
import type { SyncError, SyncState, SyncStatus } from "./types";

/** The single key the settings cache occupies in `chrome.storage.local`. */
export const SETTINGS_CACHE_KEY = "bookmark-ai:settings-cache";

/** Settings cache schema version, bumped if the persisted shape changes incompatibly. */
export const SETTINGS_CACHE_SCHEMA_VERSION = 1;

/**
 * Always-valid, in-memory settings-cache view. Produced only by
 * `parseCachedSettingsState`, so malformed persisted data never leaks inward.
 */
export type SettingsCacheState = {
	readonly settings: Settings;
	readonly location?: DriveLocation;
	readonly sync: SyncState;
};

/** Serialized Drive location stored alongside the settings snapshot. */
export type CachedSettingsDriveLocationV1 = {
	folderId: string;
	folderName: string;
	fileId: string;
	fileName: string;
	revision: string;
};

/** Serialized sync state (identical shape to the bookmark cache's). */
export type CachedSettingsSyncStateV1 = {
	status: SyncStatus;
	lastSyncedAt?: string;
	error?: SyncError;
	pending?: boolean;
};

/** Loose JSON shape persisted in `chrome.storage.local`. Untrusted. */
export type CachedSettingsStateV1 = {
	schemaVersion: 1;
	updatedAt: string;
	customSkills: AnalysisSkillV1[];
	drive?: CachedSettingsDriveLocationV1;
	sync: CachedSettingsSyncStateV1;
};

/** A problem encountered while parsing persisted settings-cache data. */
export type SettingsCacheProblemKind =
	| "not-an-object"
	| "unsupported-schema"
	| "invalid-skill"
	| "invalid-location"
	| "invalid-sync"
	| "invalid-field";

export type SettingsCacheProblem = {
	readonly kind: SettingsCacheProblemKind;
	readonly message: string;
};

/** Result of parsing persisted data: an always-valid state plus any problems. */
export type SettingsCacheParseResult = {
	readonly state: SettingsCacheState;
	readonly problems: readonly SettingsCacheProblem[];
};
