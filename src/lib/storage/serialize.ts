/**
 * Serialize a trusted {@link CacheState} back into the loose
 * {@link CachedStateV1} shape persisted in `chrome.storage.local`.
 *
 * The inverse of `parseCachedState`. Records are serialized through the bookmark
 * domain's own {@link serializeBookmarkRecord}, so the cache stores exactly the
 * excerpt-free JSONL shape and never a raw page excerpt (docs/design.md "Local
 * Cache", docs/privacy-policy.md "Page Text Excerpts"). Snapshot order is
 * deterministic (oldest-created first) to keep persisted bytes stable.
 */
import {
	serializeBookmarkRecord,
	serializeTombstone,
} from "../bookmarks/index";
import {
	CACHE_SCHEMA_VERSION,
	type CacheState,
	type CachedStateV1,
} from "./types";

export function serializeCacheState(state: CacheState): CachedStateV1 {
	const serialized: CachedStateV1 = {
		schemaVersion: CACHE_SCHEMA_VERSION,
		bookmarks: state.bookmarks
			.sortedByCreated("asc")
			.map(serializeBookmarkRecord),
		sync: {
			status: state.sync.status,
		},
	};

	// Persist tombstones only when present, so an unchanged cache keeps its prior
	// byte shape and old readers that ignore the field are unaffected.
	const tombstones = state.bookmarks.tombstones();
	if (tombstones.length > 0) {
		serialized.tombstones = tombstones.map(serializeTombstone);
	}

	if (state.sync.lastSyncedAt !== undefined) {
		serialized.sync.lastSyncedAt = state.sync.lastSyncedAt;
	}
	if (state.sync.error !== undefined) {
		serialized.sync.error = state.sync.error;
	}

	if (state.location !== undefined) {
		serialized.drive = {
			folderId: state.location.folder.id,
			folderName: state.location.folder.name,
			fileId: state.location.file.id,
			fileName: state.location.file.name,
			revision: state.location.file.revision,
		};
	}

	return serialized;
}
