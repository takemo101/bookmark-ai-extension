import { describe, expect, it } from "vitest";

import {
	Bookmarks,
	bookmarkId,
	isoTimestamp,
	serializeBookmarkRecord,
} from "../bookmarks/index";
import { parseCachedState } from "./parse";
import { serializeCacheState } from "./serialize";
import { CACHE_SCHEMA_VERSION, type CacheState } from "./types";

/**
 * The parser is the cache's trust boundary: whatever `chrome.storage.local`
 * hands back must be turned into an always-valid {@link CacheState} or safely
 * discarded. These tests pin that no malformed payload throws and that a valid
 * state round-trips through serialize → parse.
 */

function bookmarksOf(
	entries: Array<{ url: string; title: string; now: string; id: string }>,
): Bookmarks {
	let bookmarks = Bookmarks.empty();
	for (const entry of entries) {
		const result = bookmarks.upsert(
			{ url: entry.url, title: entry.title },
			{ id: bookmarkId(entry.id), now: isoTimestamp(entry.now) },
		);
		if (!result.ok) {
			throw new Error(`fixture upsert failed: ${JSON.stringify(result.error)}`);
		}
		bookmarks = result.value;
	}
	return bookmarks;
}

describe("parseCachedState", () => {
	it("returns the empty state for a non-object payload", () => {
		for (const value of [undefined, null, "x", 42, []]) {
			const { state, problems } = parseCachedState(value);
			expect(state.bookmarks.size).toBe(0);
			expect(state.sync.status).toBe("idle");
			expect(problems.length).toBeGreaterThan(0);
		}
	});

	it("rejects an unsupported schema version without throwing", () => {
		const { state, problems } = parseCachedState({ schemaVersion: 99, bookmarks: [] });
		expect(state.bookmarks.size).toBe(0);
		expect(problems[0].kind).toBe("unsupported-schema");
	});

	it("quarantines malformed records but keeps the valid ones", () => {
		const good = serializeBookmarkRecord(
			bookmarksOf([
				{ url: "https://a.test/", title: "A", now: "2026-01-01T00:00:00Z", id: "a" },
			]).toArray()[0],
		);
		const { state, problems } = parseCachedState({
			schemaVersion: CACHE_SCHEMA_VERSION,
			bookmarks: [good, { schemaVersion: 1, id: "" }, "not-an-object"],
			sync: { status: "synced" },
		});
		expect(state.bookmarks.size).toBe(1);
		expect(state.bookmarks.toArray()[0].url).toBe("https://a.test/");
		expect(problems.filter((p) => p.kind === "invalid-record")).toHaveLength(2);
	});

	it("parses a drive location and a valid sync state", () => {
		const { state, problems } = parseCachedState({
			schemaVersion: CACHE_SCHEMA_VERSION,
			bookmarks: [],
			drive: {
				folderId: "folder-1",
				folderName: "bookmark-ai",
				fileId: "file-1",
				fileName: "bookmarks.jsonl",
				revision: "rev-7",
			},
			sync: {
				status: "synced",
				lastSyncedAt: "2026-02-01T00:00:00Z",
			},
		});
		expect(problems).toHaveLength(0);
		expect(state.location?.folder.id).toBe("folder-1");
		expect(state.location?.file.revision).toBe("rev-7");
		expect(state.sync.status).toBe("synced");
		expect(state.sync.lastSyncedAt).toBe("2026-02-01T00:00:00Z");
	});

	it("drops an incomplete drive location and reports it", () => {
		const { state, problems } = parseCachedState({
			schemaVersion: CACHE_SCHEMA_VERSION,
			bookmarks: [],
			drive: { folderId: "folder-1" },
			sync: { status: "idle" },
		});
		expect(state.location).toBeUndefined();
		expect(problems.some((p) => p.kind === "invalid-location")).toBe(true);
	});

	it("falls back to idle for an unknown sync status", () => {
		const { state } = parseCachedState({
			schemaVersion: CACHE_SCHEMA_VERSION,
			bookmarks: [],
			sync: { status: "bogus" },
		});
		expect(state.sync.status).toBe("idle");
	});

	it("round-trips deletion tombstones through serialize → parse", () => {
		const live = bookmarksOf([
			{ url: "https://a.test/", title: "A", now: "2026-01-01T00:00:00Z", id: "a" },
			{ url: "https://b.test/", title: "B", now: "2026-01-02T00:00:00Z", id: "b" },
		]);
		const canonicalB = live.toArray().find((r) => r.url === "https://b.test/")!
			.canonicalUrl;
		const original: CacheState = {
			bookmarks: live.delete(canonicalB, isoTimestamp("2026-02-03T00:00:00Z")),
			sync: { status: "synced" },
		};
		expect(original.bookmarks.tombstones()).toHaveLength(1);

		const { state, problems } = parseCachedState(serializeCacheState(original));

		expect(problems).toHaveLength(0);
		// One live record remains, and the deletion is preserved as a tombstone so
		// it is not resurrected before the next Drive sync.
		expect(state.bookmarks.size).toBe(1);
		expect(state.bookmarks.get(canonicalB)).toBeUndefined();
		expect(state.bookmarks.tombstones().map((t) => t.canonicalUrl)).toEqual([
			canonicalB,
		]);
	});

	it("omits the tombstones field entirely when there are none", () => {
		const serialized = serializeCacheState({
			bookmarks: bookmarksOf([
				{ url: "https://a.test/", title: "A", now: "2026-01-01T00:00:00Z", id: "a" },
			]),
			sync: { status: "synced" },
		});
		expect(serialized.tombstones).toBeUndefined();
	});

	it("round-trips the unsynced-mutation pending flag and omits it when false", () => {
		const base = bookmarksOf([
			{ url: "https://a.test/", title: "A", now: "2026-01-01T00:00:00Z", id: "a" },
		]);

		const pendingSerialized = serializeCacheState({
			bookmarks: base,
			sync: { status: "error", pending: true },
		});
		expect(pendingSerialized.sync.pending).toBe(true);
		const { state } = parseCachedState(pendingSerialized);
		expect(state.sync.pending).toBe(true);

		// A synced cache carries no pending flag, keeping the persisted shape stable.
		const syncedSerialized = serializeCacheState({
			bookmarks: base,
			sync: { status: "synced" },
		});
		expect(syncedSerialized.sync.pending).toBeUndefined();
		expect(parseCachedState(syncedSerialized).state.sync.pending).toBeUndefined();
	});

	it("treats a non-boolean or missing pending value as no pending changes", () => {
		for (const pending of [undefined, "yes", 1, null, false]) {
			const { state } = parseCachedState({
				schemaVersion: CACHE_SCHEMA_VERSION,
				bookmarks: [],
				sync: { status: "synced", pending },
			});
			expect(state.sync.pending).toBeUndefined();
		}
	});

	it("round-trips a full state through serialize → parse", () => {
		const original: CacheState = {
			bookmarks: bookmarksOf([
				{ url: "https://a.test/", title: "A", now: "2026-01-01T00:00:00Z", id: "a" },
				{ url: "https://b.test/", title: "B", now: "2026-01-02T00:00:00Z", id: "b" },
			]),
			location: {
				folder: { id: "folder-1" as never, name: "bookmark-ai" },
				file: {
					id: "file-1" as never,
					name: "bookmarks.jsonl",
					revision: "rev-1" as never,
				},
			},
			sync: { status: "synced", lastSyncedAt: isoTimestamp("2026-02-01T00:00:00Z") },
		};

		const { state, problems } = parseCachedState(serializeCacheState(original));

		expect(problems).toHaveLength(0);
		expect(state.bookmarks.size).toBe(2);
		expect(state.location?.file.revision).toBe("rev-1");
		expect(state.sync.lastSyncedAt).toBe("2026-02-01T00:00:00Z");
	});
});
