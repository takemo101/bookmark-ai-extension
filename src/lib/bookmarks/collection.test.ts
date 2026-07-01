import { describe, expect, it } from "vitest";

import { Bookmarks } from "./collection";
import { type BookmarkRecord, parseBookmarkRecord } from "./record";
import { canonicalizeUrl } from "./url";
import { type BookmarkId, bookmarkId, isoTimestamp } from "./values";

function canon(url: string) {
	const result = canonicalizeUrl(url);
	if (!result.ok) throw new Error(`bad canonical fixture: ${url}`);
	return result.value;
}

const CANON_A = canon("https://example.com/a");

function ctx(id: string, now: string) {
	return { id: bookmarkId(id), now: isoTimestamp(now) };
}

function record(overrides: Record<string, unknown> = {}): BookmarkRecord {
	const result = parseBookmarkRecord({
		schemaVersion: 1,
		id: "bm-1",
		canonicalUrl: "https://example.com/a",
		url: "https://example.com/a",
		title: "Example",
		tags: [],
		aiStatus: "pending",
		createdAt: "2026-06-25T00:00:00.000Z",
		updatedAt: "2026-06-25T00:00:00.000Z",
		...overrides,
	});
	if (!result.ok) throw new Error(`bad fixture: ${result.error.message}`);
	return result.value;
}

describe("Bookmarks.upsert", () => {
	it("creates a new record on first save", () => {
		const result = Bookmarks.empty().upsert(
			{ url: "https://example.com/a", title: "A" },
			ctx("bm-1", "2026-06-25T00:00:00.000Z"),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(1);
			const saved = result.value.get(CANON_A);
			expect(saved?.title).toBe("A");
			expect(saved?.aiStatus).toBe("pending");
		}
	});

	it("updates the existing record on a duplicate canonical URL", () => {
		const first = Bookmarks.empty().upsert(
			{ url: "https://example.com/a", title: "A" },
			ctx("bm-1", "2026-06-25T00:00:00.000Z"),
		);
		if (!first.ok) throw new Error("first upsert failed");

		// Different raw URL (www + tracking) but same canonical key.
		const second = first.value.upsert(
			{ url: "https://www.example.com/a?utm_source=x", title: "A updated" },
			ctx("bm-IGNORED", "2026-06-25T05:00:00.000Z"),
		);
		expect(second.ok).toBe(true);
		if (second.ok) {
			expect(second.value.size).toBe(1);
			const saved = second.value.get(CANON_A);
			expect(saved?.title).toBe("A updated");
			// id is preserved from the original record, not the new context id.
			expect(saved?.id).toBe("bm-1");
		}
	});

	it("preserves createdAt and advances updatedAt on duplicate save", () => {
		const first = Bookmarks.empty().upsert(
			{ url: "https://example.com/a" },
			ctx("bm-1", "2026-06-25T00:00:00.000Z"),
		);
		if (!first.ok) throw new Error("first upsert failed");
		const second = first.value.upsert(
			{ url: "https://example.com/a" },
			ctx("bm-2", "2026-06-26T00:00:00.000Z"),
		);
		if (!second.ok) throw new Error("second upsert failed");
		const saved = second.value.get(CANON_A);
		expect(saved?.createdAt).toBe("2026-06-25T00:00:00.000Z");
		expect(saved?.updatedAt).toBe("2026-06-26T00:00:00.000Z");
	});

	it("does not move updatedAt backward on duplicate save", () => {
		const first = Bookmarks.empty().upsert(
			{ url: "https://example.com/a" },
			ctx("bm-1", "2026-06-25T00:00:00.000Z"),
		);
		if (!first.ok) throw new Error("first upsert failed");
		const second = first.value.upsert(
			{ url: "https://example.com/a" },
			ctx("bm-2", "2026-06-24T00:00:00.000Z"),
		);
		if (!second.ok) throw new Error("second upsert failed");
		const saved = second.value.get(CANON_A);
		expect(saved?.createdAt).toBe("2026-06-25T00:00:00.000Z");
		expect(saved?.updatedAt).toBe("2026-06-25T00:00:00.000Z");
	});

	it("rejects an invalid URL", () => {
		const result = Bookmarks.empty().upsert(
			{ url: "not-a-url" },
			ctx("bm-1", "2026-06-25T00:00:00.000Z"),
		);
		expect(result.ok).toBe(false);
	});
});

describe("Bookmarks AI status transitions", () => {
	const base = Bookmarks.from([record({ aiStatus: "pending" })]);
	const later = isoTimestamp("2026-06-26T00:00:00.000Z");

	it("applies AI analysis and moves to ready", () => {
		const result = base.applyAiAnalysis(
			CANON_A,
			{ description: "説明", genre: "開発ツール", tags: ["GitHub"] },
			later,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const saved = result.value.get(CANON_A);
			expect(saved?.aiStatus).toBe("ready");
			expect(saved?.description).toBe("説明");
			expect(saved?.genre).toBe("開発ツール");
			expect(saved?.tags).toEqual(["GitHub"]);
			expect(saved?.aiModel).toBe("chrome-prompt-api");
			expect(saved?.lastAnalyzedAt).toBe(later);
			expect(saved?.updatedAt).toBe(later);
			expect(saved?.createdAt).toBe("2026-06-25T00:00:00.000Z");
		}
	});

	it("does not move updatedAt backward when applying AI analysis", () => {
		const result = base.applyAiAnalysis(
			CANON_A,
			{ description: "説明" },
			isoTimestamp("2026-06-24T00:00:00.000Z"),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const saved = result.value.get(CANON_A);
			expect(saved?.updatedAt).toBe("2026-06-25T00:00:00.000Z");
			expect(saved?.lastAnalyzedAt).toBe("2026-06-25T00:00:00.000Z");
		}
	});

	it("marks unavailable and failed, recording an error for failure", () => {
		const unavailable = base.markAiUnavailable(CANON_A, later);
		expect(unavailable.ok).toBe(true);
		if (unavailable.ok) {
			expect(unavailable.value.get(CANON_A)?.aiStatus).toBe("unavailable");
		}

		const failed = base.markAiFailed(CANON_A, "boom", later);
		expect(failed.ok).toBe(true);
		if (failed.ok) {
			expect(failed.value.get(CANON_A)?.aiStatus).toBe("failed");
			expect(failed.value.get(CANON_A)?.aiError).toBe("boom");
		}
	});

	it("does not move updatedAt backward during status transitions", () => {
		const result = base.markAiFailed(
			CANON_A,
			"boom",
			isoTimestamp("2026-06-24T00:00:00.000Z"),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.get(CANON_A)?.updatedAt).toBe(
				"2026-06-25T00:00:00.000Z",
			);
		}
	});

	it("returns not-found for an unknown canonical URL", () => {
		const missing = canon("https://example.com/missing");
		const result = base.markAiUnavailable(missing, later);
		expect(result.ok).toBe(false);
	});
});

describe("Bookmarks.delete", () => {
	const at = isoTimestamp("2026-06-26T00:00:00.000Z");

	it("removes by canonical URL and by id, leaving a tombstone", () => {
		const set = Bookmarks.from([record({ id: "bm-1" })]);
		const byUrl = set.delete(CANON_A, at);
		expect(byUrl.size).toBe(0);
		expect(byUrl.get(CANON_A)).toBeUndefined();
		expect(byUrl.tombstones().map((t) => t.canonicalUrl)).toEqual([CANON_A]);

		const byId = set.deleteById("bm-1" as unknown as BookmarkId, at);
		expect(byId.size).toBe(0);
		expect(byId.tombstones()).toHaveLength(1);
	});

	it("is a no-op for unknown keys and records no tombstone", () => {
		const set = Bookmarks.from([record()]);
		const after = set.delete(canon("https://example.com/z"), at);
		expect(after.size).toBe(1);
		expect(after.tombstones()).toHaveLength(0);
	});

	it("does not move an existing tombstone's deletedAt backward", () => {
		const set = Bookmarks.from([record()]).delete(CANON_A, at);
		const earlier = set.delete(
			CANON_A,
			isoTimestamp("2026-06-25T00:00:00.000Z"),
		);
		expect(earlier.tombstones()[0].deletedAt).toBe("2026-06-26T00:00:00.000Z");
	});

	it("re-saving a deleted URL clears its tombstone", () => {
		const deleted = Bookmarks.from([record()]).delete(CANON_A, at);
		const resaved = deleted.upsert(
			{ url: "https://example.com/a", title: "Back" },
			ctx("bm-2", "2026-06-27T00:00:00.000Z"),
		);
		expect(resaved.ok).toBe(true);
		if (resaved.ok) {
			expect(resaved.value.size).toBe(1);
			expect(resaved.value.tombstones()).toHaveLength(0);
			expect(resaved.value.get(CANON_A)?.title).toBe("Back");
		}
	});
});

describe("Bookmarks.mergeRemote", () => {
	const canonA = CANON_A;

	function pair() {
		const local = record({
			id: "local",
			title: "local title",
			createdAt: "2026-06-25T00:00:00.000Z",
			updatedAt: "2026-06-25T02:00:00.000Z",
		});
		const remote = record({
			id: "remote",
			title: "remote title",
			createdAt: "2026-06-24T00:00:00.000Z",
			updatedAt: "2026-06-25T05:00:00.000Z",
		});
		return { local, remote };
	}

	it("takes the later updatedAt fields and preserves the earliest createdAt", () => {
		const { local, remote } = pair();
		const merged = Bookmarks.from([local]).mergeRemote(
			Bookmarks.from([remote]),
		);
		const saved = merged.get(canonA);
		expect(saved?.title).toBe("remote title");
		expect(saved?.createdAt).toBe("2026-06-24T00:00:00.000Z");
		expect(saved?.updatedAt).toBe("2026-06-25T05:00:00.000Z");
	});

	it("is order-independent for the winning fields", () => {
		const { local, remote } = pair();
		const a = Bookmarks.from([local]).mergeRemote(Bookmarks.from([remote]));
		const b = Bookmarks.from([remote]).mergeRemote(Bookmarks.from([local]));
		expect(a.get(canonA)).toEqual(b.get(canonA));
	});

	it("keeps records that exist on only one side", () => {
		const remoteOnly = record({
			id: "r-only",
			url: "https://example.com/b",
			canonicalUrl: "https://example.com/b",
		});
		const merged = Bookmarks.from([record()]).mergeRemote(
			Bookmarks.from([remoteOnly]),
		);
		expect(merged.size).toBe(2);
	});

	it("breaks updatedAt ties deterministically by id", () => {
		const local = record({
			id: "zzz",
			title: "local",
			updatedAt: "2026-06-25T03:00:00.000Z",
		});
		const remote = record({
			id: "aaa",
			title: "remote",
			updatedAt: "2026-06-25T03:00:00.000Z",
		});
		const a = Bookmarks.from([local]).mergeRemote(Bookmarks.from([remote]));
		const b = Bookmarks.from([remote]).mergeRemote(Bookmarks.from([local]));
		// Lower id ("aaa") wins regardless of merge direction.
		expect(a.get(canonA)?.title).toBe("remote");
		expect(b.get(canonA)?.title).toBe("remote");
	});
});

describe("Bookmarks.mergeRemote tombstones (delete propagation)", () => {
	// A device deletes a record locally; the remote still holds the live record.
	function deletedLocally(deletedAt: string) {
		const remote = Bookmarks.from([
			record({ updatedAt: "2026-06-25T00:00:00.000Z" }),
		]);
		const local = Bookmarks.from([
			record({ updatedAt: "2026-06-25T00:00:00.000Z" }),
		]).delete(CANON_A, isoTimestamp(deletedAt));
		return { local, remote };
	}

	it("a deletion survives a merge with a remote that still has the record", () => {
		const { local, remote } = deletedLocally("2026-06-25T01:00:00.000Z");
		const merged = local.mergeRemote(remote);
		expect(merged.size).toBe(0);
		expect(merged.get(CANON_A)).toBeUndefined();
		expect(merged.tombstones()).toHaveLength(1);
	});

	it("is order-independent: the remote merging a local delete also drops it", () => {
		const { local, remote } = deletedLocally("2026-06-25T01:00:00.000Z");
		// Simulate the other device pulling our tombstone in.
		const onOtherDevice = remote.mergeRemote(local);
		expect(onOtherDevice.size).toBe(0);
		expect(onOtherDevice.tombstones()).toHaveLength(1);
	});

	it("a strictly newer explicit update wins over an older tombstone", () => {
		// deletedAt is older than the remote record's updatedAt → resurrection is
		// the documented, intended behavior.
		const remote = Bookmarks.from([
			record({ title: "edited", updatedAt: "2026-06-25T05:00:00.000Z" }),
		]);
		const local = Bookmarks.from([record()]).delete(
			CANON_A,
			isoTimestamp("2026-06-25T01:00:00.000Z"),
		);
		const merged = local.mergeRemote(remote);
		expect(merged.size).toBe(1);
		expect(merged.get(CANON_A)?.title).toBe("edited");
		expect(merged.tombstones()).toHaveLength(0);
	});

	it("a tie between delete and update keeps the deletion durable", () => {
		const sameInstant = "2026-06-25T03:00:00.000Z";
		const remote = Bookmarks.from([record({ updatedAt: sameInstant })]);
		const local = Bookmarks.from([record({ updatedAt: sameInstant })]).delete(
			CANON_A,
			isoTimestamp(sameInstant),
		);
		const merged = local.mergeRemote(remote);
		expect(merged.size).toBe(0);
		expect(merged.tombstones()).toHaveLength(1);
	});

	it("merging two tombstones keeps the later deletedAt", () => {
		const earlier = Bookmarks.from([record()]).delete(
			CANON_A,
			isoTimestamp("2026-06-25T01:00:00.000Z"),
		);
		const later = Bookmarks.from([record()]).delete(
			CANON_A,
			isoTimestamp("2026-06-25T09:00:00.000Z"),
		);
		const merged = earlier.mergeRemote(later);
		expect(merged.tombstones()[0].deletedAt).toBe("2026-06-25T09:00:00.000Z");
	});
});

describe("Bookmarks.toArray ordering", () => {
	it("orders by most-recently-updated, deterministic on ties", () => {
		const older = record({
			id: "older",
			url: "https://example.com/a",
			canonicalUrl: "https://example.com/a",
			updatedAt: "2026-06-25T00:00:00.000Z",
		});
		const newer = record({
			id: "newer",
			url: "https://example.com/b",
			canonicalUrl: "https://example.com/b",
			updatedAt: "2026-06-26T00:00:00.000Z",
		});
		expect(
			Bookmarks.from([older, newer])
				.toArray()
				.map((r) => r.id),
		).toEqual(["newer", "older"]);
		// Building in the opposite order yields the same result.
		expect(
			Bookmarks.from([newer, older])
				.toArray()
				.map((r) => r.id),
		).toEqual(["newer", "older"]);
	});
});

describe("Bookmarks search and filter", () => {
	const collection = Bookmarks.from([
		record({
			id: "bm-1",
			url: "https://example.com/a",
			canonicalUrl: "https://example.com/a",
			title: "GitHub repository",
			description: "ブラウザ拡張のソース",
			genre: "開発ツール",
			tags: ["TypeScript", "拡張機能"],
			aiStatus: "ready",
		}),
		record({
			id: "bm-2",
			url: "https://news.example.org/story",
			canonicalUrl: "https://news.example.org/story",
			title: "News article",
			description: "今日のニュース",
			genre: "ニュース",
			tags: ["時事"],
			aiStatus: "pending",
		}),
	]);

	it("searches by title", () => {
		expect(collection.search("github").map((r) => r.id)).toEqual(["bm-1"]);
	});

	it("searches by URL", () => {
		expect(collection.search("news.example.org").map((r) => r.id)).toEqual([
			"bm-2",
		]);
	});

	it("searches by description", () => {
		expect(collection.search("ニュース").map((r) => r.id)).toEqual(["bm-2"]);
	});

	it("searches by genre", () => {
		expect(collection.search("開発ツール").map((r) => r.id)).toEqual(["bm-1"]);
	});

	it("searches by tag", () => {
		expect(collection.search("typescript").map((r) => r.id)).toEqual(["bm-1"]);
	});

	it("returns all records for a blank query", () => {
		expect(collection.search("   ")).toHaveLength(2);
	});

	it("lists distinct sorted genres as filter facets", () => {
		expect(collection.genres()).toEqual(["ニュース", "開発ツール"]);
	});

	it("lists distinct sorted tags as filter facets", () => {
		expect(collection.tags()).toEqual(["TypeScript", "拡張機能", "時事"]);
	});

	it("filters by genre, tag, and AI status", () => {
		expect(collection.filterByGenre("開発ツール").map((r) => r.id)).toEqual([
			"bm-1",
		]);
		expect(collection.filterByTag("時事").map((r) => r.id)).toEqual(["bm-2"]);
		expect(collection.filterByAiStatus("pending").map((r) => r.id)).toEqual([
			"bm-2",
		]);
	});

	it("combines criteria", () => {
		expect(
			collection
				.filter({ query: "github", aiStatus: "ready" })
				.map((r) => r.id),
		).toEqual(["bm-1"]);
		expect(
			collection.filter({ query: "github", aiStatus: "pending" }),
		).toHaveLength(0);
	});
});
