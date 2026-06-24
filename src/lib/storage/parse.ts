/**
 * Boundary parser for persisted `chrome.storage.local` cache data.
 *
 * `chrome.storage.local` is an external boundary: the bytes there are whatever
 * some past write left behind, so they are untrusted until parsed. This module
 * turns a loose, decoded value into an always-valid {@link CacheState} exactly
 * once, dropping anything malformed rather than trusting it (see
 * docs/implementation-principles.md "Parse, don't validate").
 *
 * Parsing is total and never throws: a wholly unusable payload yields the empty
 * cache state, and individual bad records/fields are quarantined as
 * {@link CacheProblem}s. The cache is only a cache, so discarding a corrupt
 * entry simply forces a fresh sync from Drive — never data loss, since Drive is
 * the source of truth.
 */
import {
	Bookmarks,
	type BookmarkRecord,
	parseBookmarkRecord,
	parseIsoTimestamp,
} from "../bookmarks/index";
import type {
	DriveFileId,
	DriveFolderId,
	DriveLocation,
	DriveRevision,
} from "../drive/index";
import {
	CACHE_SCHEMA_VERSION,
	type CacheParseResult,
	type CacheProblem,
	type CacheState,
	type SyncError,
	type SyncState,
	type SyncStatus,
} from "./types";

const SYNC_STATUSES: readonly SyncStatus[] = [
	"idle",
	"syncing",
	"synced",
	"error",
];

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** The empty, never-synced cache. Returned when nothing usable is persisted. */
export function emptyCacheState(): CacheState {
	return { bookmarks: Bookmarks.empty(), sync: { status: "idle" } };
}

function parseRecords(
	value: unknown,
	problems: CacheProblem[],
): BookmarkRecord[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		problems.push({
			kind: "invalid-record",
			message: "cached bookmarks is not an array",
		});
		return [];
	}
	const records: BookmarkRecord[] = [];
	for (const entry of value) {
		const parsed = parseBookmarkRecord(entry);
		if (!parsed.ok) {
			// Quarantine the bad record; the rest of the snapshot survives.
			problems.push({
				kind: "invalid-record",
				message: `${parsed.error.field}: ${parsed.error.message}`,
			});
			continue;
		}
		records.push(parsed.value);
	}
	return records;
}

function parseLocation(
	value: unknown,
	problems: CacheProblem[],
): DriveLocation | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isObject(value)) {
		problems.push({
			kind: "invalid-location",
			message: "cached drive location is not an object",
		});
		return undefined;
	}
	const folderId = nonEmptyString(value.folderId);
	const fileId = nonEmptyString(value.fileId);
	const revision = nonEmptyString(value.revision);
	if (folderId === undefined || fileId === undefined || revision === undefined) {
		problems.push({
			kind: "invalid-location",
			message: "cached drive location is missing folderId, fileId, or revision",
		});
		return undefined;
	}
	const folderName = nonEmptyString(value.folderName) ?? "bookmark-ai";
	const fileName = nonEmptyString(value.fileName) ?? "bookmarks.jsonl";
	// Branded ids are trusted opaque strings here: the cache is the one that
	// wrote them, and the repository only ever compares revisions for equality.
	return {
		folder: { id: folderId as DriveFolderId, name: folderName },
		file: {
			id: fileId as DriveFileId,
			name: fileName,
			revision: revision as DriveRevision,
		},
	};
}

function parseSyncError(value: unknown): SyncError | undefined {
	if (!isObject(value)) {
		return undefined;
	}
	const message = nonEmptyString(value.message);
	if (message === undefined) {
		return undefined;
	}
	const kind = nonEmptyString(value.kind) ?? "unknown";
	return { kind, message };
}

function parseSync(value: unknown, problems: CacheProblem[]): SyncState {
	if (!isObject(value)) {
		problems.push({
			kind: "invalid-sync",
			message: "cached sync state is not an object",
		});
		return { status: "idle" };
	}
	const status = (SYNC_STATUSES as readonly unknown[]).includes(value.status)
		? (value.status as SyncStatus)
		: "idle";

	let lastSyncedAt: SyncState["lastSyncedAt"];
	if (value.lastSyncedAt !== undefined) {
		const parsed = parseIsoTimestamp(value.lastSyncedAt);
		if (parsed.ok) {
			lastSyncedAt = parsed.value;
		} else {
			problems.push({
				kind: "invalid-sync",
				message: `lastSyncedAt: ${parsed.error.message}`,
			});
		}
	}

	const error = parseSyncError(value.error);
	return { status, lastSyncedAt, error };
}

/**
 * Parse arbitrary decoded `chrome.storage.local` data into an always-valid
 * {@link CacheState}. Unknown schema versions, non-objects, and malformed
 * pieces are reported and discarded; the returned state is always safe to use.
 */
export function parseCachedState(value: unknown): CacheParseResult {
	const problems: CacheProblem[] = [];

	if (!isObject(value)) {
		problems.push({
			kind: "not-an-object",
			message: "cached state is not an object",
		});
		return { state: emptyCacheState(), problems };
	}

	if (value.schemaVersion !== CACHE_SCHEMA_VERSION) {
		problems.push({
			kind: "unsupported-schema",
			message: `unsupported cache schemaVersion: ${JSON.stringify(value.schemaVersion)}`,
		});
		return { state: emptyCacheState(), problems };
	}

	const records = parseRecords(value.bookmarks, problems);
	const location = parseLocation(value.drive, problems);
	const sync = parseSync(value.sync, problems);

	return {
		state: { bookmarks: Bookmarks.from(records), location, sync },
		problems,
	};
}
