import { describe, expect, it } from "vitest";

import { Bookmarks, bookmarkId, isoTimestamp } from "../bookmarks/index";
import {
	type LocalCacheStorageArea,
	createChromeLocalCache,
} from "./local-cache";
import { CACHE_KEY, type CacheState } from "./types";

/**
 * The adapter is driven by an in-memory fake of the `chrome.storage.local`
 * area, so no real Chrome API is touched. The tests assert parse-on-read,
 * serialize-on-write, and that a corrupt payload degrades to the empty state
 * instead of throwing.
 */
class FakeStorageArea implements LocalCacheStorageArea {
	store = new Map<string, unknown>();

	async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
		const key = Array.isArray(keys) ? keys[0] : keys;
		if (key === null || key === undefined) {
			return Object.fromEntries(this.store);
		}
		return this.store.has(key) ? { [key]: this.store.get(key) } : {};
	}

	async set(items: Record<string, unknown>): Promise<void> {
		for (const [key, value] of Object.entries(items)) {
			this.store.set(key, value);
		}
	}

	async remove(keys: string | string[]): Promise<void> {
		for (const key of Array.isArray(keys) ? keys : [keys]) {
			this.store.delete(key);
		}
	}
}

function bookmarksOf(
	entries: Array<{ url: string; title: string; now: string; id: string }>,
): Bookmarks {
	let bookmarks = Bookmarks.empty();
	for (const entry of entries) {
		const result = bookmarks.upsert(
			{ url: entry.url, title: entry.title },
			{ id: bookmarkId(entry.id), now: isoTimestamp(entry.now) },
		);
		if (!result.ok) throw new Error("fixture upsert failed");
		bookmarks = result.value;
	}
	return bookmarks;
}

describe("createChromeLocalCache", () => {
	it("returns the empty state when nothing is stored", async () => {
		const cache = createChromeLocalCache(new FakeStorageArea());
		const state = await cache.load();
		expect(state.bookmarks.size).toBe(0);
		expect(state.sync.status).toBe("idle");
	});

	it("persists and reloads a state (serialize → store → parse)", async () => {
		const area = new FakeStorageArea();
		const cache = createChromeLocalCache(area);
		const state: CacheState = {
			bookmarks: bookmarksOf([
				{ url: "https://a.test/", title: "A", now: "2026-01-01T00:00:00Z", id: "a" },
			]),
			location: {
				folder: { id: "folder-1" as never, name: "bookmark-ai" },
				file: {
					id: "file-1" as never,
					name: "bookmarks.jsonl",
					revision: "rev-3" as never,
				},
			},
			sync: { status: "synced", lastSyncedAt: isoTimestamp("2026-02-01T00:00:00Z") },
		};

		await cache.save(state);
		// What lands in storage is the loose serialized shape, not the domain value.
		const raw = (await area.get(CACHE_KEY))[CACHE_KEY] as { schemaVersion: number };
		expect(raw.schemaVersion).toBe(1);

		const reloaded = await cache.load();
		expect(reloaded.bookmarks.size).toBe(1);
		expect(reloaded.location?.file.revision).toBe("rev-3");
		expect(reloaded.sync.status).toBe("synced");
	});

	it("degrades a corrupt stored payload to the empty state", async () => {
		const area = new FakeStorageArea();
		await area.set({ [CACHE_KEY]: "totally not a cache" });
		const cache = createChromeLocalCache(area);

		const state = await cache.load();
		expect(state.bookmarks.size).toBe(0);
		expect(state.sync.status).toBe("idle");
	});

	it("clears the stored entry", async () => {
		const area = new FakeStorageArea();
		const cache = createChromeLocalCache(area);
		await cache.save({ bookmarks: Bookmarks.empty(), sync: { status: "idle" } });
		await cache.clear();
		expect(area.store.has(CACHE_KEY)).toBe(false);
	});
});
