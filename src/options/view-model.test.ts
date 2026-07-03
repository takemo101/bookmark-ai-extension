import { describe, expect, it } from "vitest";

import {
	Bookmarks,
	type BookmarkRecord,
	bookmarkId,
	isoTimestamp,
} from "../lib/bookmarks/index";
import type { CacheState } from "../lib/storage/index";
import type {
	AppError,
	CanonicalUrl,
	OptionsUseCases,
	Result,
	SaveOutcome,
} from "./use-cases";
import { createOptionsController } from "./view-model";

/**
 * The controller is exercised entirely through a fake {@link OptionsUseCases} —
 * no React, Chrome, Drive, or Prompt API. That is the structural proof the
 * options page never reaches past the view-model boundary, and that
 * search/filter/delete/re-analyze flow through app use cases and the first-class
 * collection rather than ad-hoc UI logic.
 */

let seq = 0;

function recordOf(opts: {
	url?: string;
	title?: string;
	aiStatus?: BookmarkRecord["aiStatus"];
	description?: string;
	genre?: string;
	tags?: string[];
	aiError?: string;
	id?: string;
	updatedAt?: string;
	analysisMarkdown?: string;
	analysisProfileId?: string;
}): BookmarkRecord {
	seq += 1;
	const url = opts.url ?? `https://example.test/p${seq}`;
	const res = Bookmarks.empty().upsert(
		{
			url,
			title: opts.title ?? "Example Page",
			aiStatus: opts.aiStatus ?? "ready",
			description: opts.description,
			genre: opts.genre,
			tags: opts.tags,
			aiError: opts.aiError,
			analysisMarkdown: opts.analysisMarkdown,
			analysisProfileId: opts.analysisProfileId,
		},
		{
			id: bookmarkId(opts.id ?? `id-${seq}`),
			now: isoTimestamp(opts.updatedAt ?? "2026-03-01T00:00:00Z"),
		},
	);
	if (!res.ok) {
		throw new Error(`bad fixture record: ${res.error.message}`);
	}
	const record = res.value.toArray()[0];
	if (!record) throw new Error("no record");
	return record;
}

function cacheOf(
	records: BookmarkRecord[],
	sync: CacheState["sync"] = {
		status: "synced",
		lastSyncedAt: isoTimestamp("2026-03-01T00:00:00Z"),
	},
): CacheState {
	return { bookmarks: Bookmarks.from(records), sync };
}

function outcomeOf(
	record: BookmarkRecord,
	driveSynced = true,
	driveError?: AppError,
): SaveOutcome {
	return { record, aiStatus: record.aiStatus, driveSynced, driveError };
}

class FakeUseCases implements OptionsUseCases {
	cache: CacheState = cacheOf([]);
	syncResult: Result<CacheState, AppError> | null = null;
	deleteResult: Result<CacheState, AppError> | null = null;
	reAnalyzeResult: Result<SaveOutcome, AppError> | null = null;
	deleteArgs: CanonicalUrl[] = [];
	reAnalyzeArgs: CanonicalUrl[] = [];
	/** When set, `reAnalyzeBookmark` awaits this before resolving (foreground timing tests). */
	reAnalyzeGate: Promise<void> | null = null;
	/** When set, `syncFromDrive` awaits this before resolving (progress timing tests). */
	syncGate: Promise<void> | null = null;
	/** When set, `deleteBookmark` awaits this before resolving (progress timing tests). */
	deleteGate: Promise<void> | null = null;
	syncCalls = 0;

	async loadCachedState() {
		return this.cache;
	}
	async syncFromDrive() {
		this.syncCalls += 1;
		if (this.syncGate) {
			await this.syncGate;
		}
		return this.syncResult ?? { ok: true as const, value: this.cache };
	}
	async deleteBookmark(canonicalUrl: CanonicalUrl) {
		this.deleteArgs.push(canonicalUrl);
		if (this.deleteGate) {
			await this.deleteGate;
		}
		if (this.deleteResult) {
			return this.deleteResult;
		}
		// Mirror the real domain delete: drop the record (leaving a tombstone) and
		// return the new cache.
		this.cache = {
			...this.cache,
			bookmarks: this.cache.bookmarks.delete(
				canonicalUrl,
				isoTimestamp("2026-06-25T12:00:00.000Z"),
			),
		};
		return { ok: true as const, value: this.cache };
	}
	async reAnalyzeBookmark(canonicalUrl: CanonicalUrl) {
		this.reAnalyzeArgs.push(canonicalUrl);
		if (this.reAnalyzeGate) {
			await this.reAnalyzeGate;
		}
		return (
			this.reAnalyzeResult ?? {
				ok: true as const,
				value: outcomeOf(this.cache.bookmarks.toArray()[0]!),
			}
		);
	}
}

function controllerWith(fake: FakeUseCases) {
	return createOptionsController(fake);
}

describe("createOptionsController", () => {
	describe("init / list", () => {
		it("loads the full cached list and sync state", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({ title: "Alpha", id: "a" }),
				recordOf({ title: "Beta", id: "b" }),
			]);
			const controller = controllerWith(fake);

			await controller.init();
			const view = controller.getView();

			expect(view.loading).toBe(false);
			expect(view.totalCount).toBe(2);
			expect(view.filteredCount).toBe(2);
			expect(view.rows.map((r) => r.title).sort()).toEqual(["Alpha", "Beta"]);
			expect(view.sync.status).toBe("synced");
			expect(view.sync.pendingLocalChanges).toBe(false);
			expect(view.empty).toBe(false);
		});

		it("surfaces pending local changes from the cached sync state", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ title: "Alpha", id: "a" })], {
				status: "error",
				pending: true,
			});
			const controller = controllerWith(fake);

			await controller.init();

			expect(controller.getView().sync.pendingLocalChanges).toBe(true);
		});

		it("reports the empty state when there are no bookmarks", async () => {
			const fake = new FakeUseCases();
			const controller = controllerWith(fake);

			await controller.init();
			const view = controller.getView();

			expect(view.empty).toBe(true);
			expect(view.totalCount).toBe(0);
			expect(view.rows).toHaveLength(0);
		});
	});

	describe("search and filter", () => {
		function seeded() {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({
					id: "gh",
					url: "https://github.test/repo",
					title: "GitHub repo",
					description: "ブラウザ拡張のソース",
					genre: "開発ツール",
					tags: ["TypeScript", "拡張機能"],
					aiStatus: "ready",
				}),
				recordOf({
					id: "news",
					url: "https://news.test/story",
					title: "News article",
					description: "今日のニュース",
					genre: "ニュース",
					tags: ["時事"],
					aiStatus: "pending",
				}),
			]);
			return fake;
		}

		it("filters by text search through the collection", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setQuery("github");
			const view = controller.getView();

			expect(view.filteredCount).toBe(1);
			expect(view.rows[0].title).toBe("GitHub repo");
			expect(view.noMatches).toBe(false);
		});

		it("exposes genre/tag facets and filters by genre", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			expect(controller.getView().facets.genres).toEqual([
				"ニュース",
				"開発ツール",
			]);
			expect(controller.getView().facets.tags).toEqual([
				"TypeScript",
				"拡張機能",
				"時事",
			]);

			controller.setGenre("ニュース");
			expect(controller.getView().rows.map((r) => r.title)).toEqual([
				"News article",
			]);
		});

		it("filters by tag and by AI status", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setTag("TypeScript");
			expect(controller.getView().rows.map((r) => r.title)).toEqual([
				"GitHub repo",
			]);

			controller.clearFilters();
			controller.setStatus("pending");
			expect(controller.getView().rows.map((r) => r.title)).toEqual([
				"News article",
			]);
		});

		it("reports no-matches when filters exclude everything", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setQuery("nothing-matches-this");
			const view = controller.getView();

			expect(view.filteredCount).toBe(0);
			expect(view.noMatches).toBe(true);
			expect(view.empty).toBe(false);
		});

		it("clears all filters", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setQuery("github");
			controller.setStatus("ready");
			controller.clearFilters();
			const view = controller.getView();

			expect(view.filters).toEqual({ query: "" });
			expect(view.filteredCount).toBe(2);
		});
	});

	describe("domain filter (MIK-028)", () => {
		function seeded() {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({
					id: "gh-1",
					url: "https://www.github.test/repo?utm_source=x",
					title: "GitHub repo",
					tags: ["TypeScript"],
					aiStatus: "ready",
				}),
				recordOf({
					id: "gh-2",
					url: "https://github.test/other",
					title: "GitHub other",
					aiStatus: "pending",
				}),
				recordOf({
					id: "news",
					url: "https://news.test/story",
					title: "News article",
					aiStatus: "ready",
				}),
			]);
			return fake;
		}

		it("derives sorted www-free domain facets from canonical URLs", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			expect(controller.getView().facets.domains).toEqual([
				"github.test",
				"news.test",
			]);
		});

		it("filters rows by domain", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setDomain("github.test");
			const view = controller.getView();

			expect(view.filters.domain).toBe("github.test");
			expect(view.rows.map((r) => r.title).sort()).toEqual([
				"GitHub other",
				"GitHub repo",
			]);
		});

		it("combines the domain filter with query/tag/status filters", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setDomain("github.test");
			controller.setStatus("ready");
			expect(controller.getView().rows.map((r) => r.title)).toEqual([
				"GitHub repo",
			]);

			controller.setTag("TypeScript");
			expect(controller.getView().rows.map((r) => r.title)).toEqual([
				"GitHub repo",
			]);

			controller.setQuery("news");
			expect(controller.getView().noMatches).toBe(true);
		});

		it("clearFilters resets the domain filter too", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setDomain("news.test");
			expect(controller.getView().filteredCount).toBe(1);

			controller.clearFilters();
			const view = controller.getView();

			expect(view.filters).toEqual({ query: "" });
			expect(view.filteredCount).toBe(3);
		});

		it("setDomain(undefined) removes the domain filter", async () => {
			const controller = controllerWith(seeded());
			await controller.init();

			controller.setDomain("news.test");
			controller.setDomain(undefined);

			expect(controller.getView().filters.domain).toBeUndefined();
			expect(controller.getView().filteredCount).toBe(3);
		});
	});

	describe("select", () => {
		it("selects a bookmark and shows its detail", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({
					id: "x",
					url: "https://example.test/x",
					title: "Selected",
					description: "詳細説明",
					genre: "技術",
					tags: ["a", "b"],
					aiStatus: "ready",
					analysisMarkdown: "## 概要\n\n分析本文。",
					analysisProfileId: "github-repository",
				}),
			]);
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			controller.select(url);
			const detail = controller.getView().selected;

			expect(detail?.title).toBe("Selected");
			expect(detail?.description).toBe("詳細説明");
			expect(detail?.genre).toBe("技術");
			expect(detail?.tags).toEqual(["a", "b"]);
			expect(detail?.canReAnalyze).toBe(false);
			expect(detail?.analysisMarkdown).toBe("## 概要\n\n分析本文。");
			expect(detail?.analysisProfileId).toBe("github-repository");
			expect(controller.getView().rows[0].selected).toBe(true);
		});

		it("clearSelection closes the detail and keeps query/filter state (MIK-022)", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({ id: "a", title: "Alpha", genre: "技術", aiStatus: "ready" }),
				recordOf({ id: "b", title: "Beta", genre: "技術", aiStatus: "ready" }),
			]);
			const controller = controllerWith(fake);
			await controller.init();

			controller.setQuery("Alpha");
			controller.setGenre("技術");
			const url = controller.getView().rows[0].canonicalUrl;
			controller.select(url);
			expect(controller.getView().selected).toBeDefined();
			expect(controller.getView().rows[0].selected).toBe(true);

			controller.clearSelection();
			const view = controller.getView();

			expect(view.selected).toBeUndefined();
			expect(view.rows[0].selected).toBe(false);
			expect(view.filters).toEqual({ query: "Alpha", genre: "技術" });
			expect(view.rows.map((r) => r.title)).toEqual(["Alpha"]);
		});

		it("keeps the selection open and updates the detail after re-analyze (MIK-022)", async () => {
			const fake = new FakeUseCases();
			const stale = recordOf({
				id: "r",
				url: "https://example.test/r",
				title: "Stale",
				aiStatus: "failed",
			});
			fake.cache = cacheOf([stale]);
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			controller.select(url);

			const ready = recordOf({
				id: "r",
				url: "https://example.test/r",
				title: "Stale",
				description: "再分析済み",
				aiStatus: "ready",
				analysisMarkdown: "## 更新後\n\n新しい分析。",
			});
			fake.cache = cacheOf([ready]);
			fake.reAnalyzeResult = { ok: true, value: outcomeOf(ready) };
			await controller.reAnalyze(url);

			const view = controller.getView();
			expect(view.selected?.aiStatus).toBe("ready");
			expect(view.selected?.analysisMarkdown).toBe("## 更新後\n\n新しい分析。");
			expect(view.rows[0].selected).toBe(true);
		});

		it("exposes analysisProfileId on rows for the richer row metadata (MIK-022)", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({ id: "p", analysisProfileId: "github-repository" }),
			]);
			const controller = controllerWith(fake);
			await controller.init();

			expect(controller.getView().rows[0].analysisProfileId).toBe(
				"github-repository",
			);
		});

		it("keeps the detail visible even when filtered out of the list", async () => {
			const controller = controllerWith(
				(() => {
					const f = new FakeUseCases();
					f.cache = cacheOf([
						recordOf({ id: "k", title: "Keepme", aiStatus: "ready" }),
						recordOf({ id: "o", title: "Other", aiStatus: "ready" }),
					]);
					return f;
				})(),
			);
			await controller.init();

			const url = controller
				.getView()
				.rows.find((r) => r.title === "Keepme")!.canonicalUrl;
			controller.select(url);
			controller.setQuery("Other");

			expect(controller.getView().rows.map((r) => r.title)).toEqual(["Other"]);
			expect(controller.getView().selected?.title).toBe("Keepme");
		});
	});

	describe("delete", () => {
		it("deletes through the use case and clears the selection", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({ id: "d", title: "Doomed", aiStatus: "ready" }),
				recordOf({ id: "s", title: "Survivor", aiStatus: "ready" }),
			]);
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller
				.getView()
				.rows.find((r) => r.title === "Doomed")!.canonicalUrl;
			controller.select(url);
			await controller.deleteBookmark(url);

			expect(fake.deleteArgs).toHaveLength(1);
			const view = controller.getView();
			expect(view.totalCount).toBe(1);
			expect(view.rows.map((r) => r.title)).toEqual(["Survivor"]);
			expect(view.selected).toBeUndefined();
		});

		it("surfaces a safe action error when delete fails", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ id: "d", title: "Doomed" })]);
			fake.deleteResult = {
				ok: false,
				error: { kind: "drive", message: "network down" },
			};
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			await controller.deleteBookmark(url);

			expect(controller.getView().actionError).toBe("network down");
			expect(controller.getView().totalCount).toBe(1);
		});
	});

	describe("re-analyze", () => {
		it("re-analyzes a non-ready record and reflects the new status", async () => {
			const fake = new FakeUseCases();
			const stale = recordOf({
				id: "r",
				url: "https://example.test/r",
				title: "Stale",
				aiStatus: "unavailable",
			});
			fake.cache = cacheOf([stale]);
			const ready = recordOf({
				id: "r",
				url: "https://example.test/r",
				title: "Stale",
				description: "再分析済み",
				aiStatus: "ready",
			});
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			expect(controller.getView().rows[0].canReAnalyze).toBe(true);

			// The use case updates the cache; the controller reloads from it.
			fake.cache = cacheOf([ready]);
			fake.reAnalyzeResult = { ok: true, value: outcomeOf(ready) };
			await controller.reAnalyze(url);

			expect(fake.reAnalyzeArgs).toHaveLength(1);
			const view = controller.getView();
			expect(view.rows[0].aiStatus).toBe("ready");
			expect(view.actionError).toBeUndefined();
		});

		it("notes a Drive-only failure as saved locally", async () => {
			const fake = new FakeUseCases();
			const rec = recordOf({ id: "r", title: "Stale", aiStatus: "failed" });
			fake.cache = cacheOf([rec]);
			const ready = recordOf({ id: "r", title: "Stale", aiStatus: "ready" });
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			fake.cache = cacheOf([ready]);
			fake.reAnalyzeResult = {
				ok: true,
				value: outcomeOf(ready, false, {
					kind: "drive",
					message: "network down",
				}),
			};
			await controller.reAnalyze(url);

			expect(controller.getView().actionNotice).toContain("network down");
		});

		it("leaves the row unchanged and surfaces a safe error on the activeTab precondition (MIK-015)", async () => {
			const fake = new FakeUseCases();
			const rec = recordOf({
				id: "r",
				title: "Stale",
				aiStatus: "unavailable",
			});
			fake.cache = cacheOf([rec]);
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			// The page is not the active tab: the app returns a safe error and never
			// mutates the cache, so reloading it must not change the row's status.
			fake.reAnalyzeResult = {
				ok: false,
				error: {
					kind: "extraction",
					message:
						"Open the page in the active tab to re-analyze it from here.",
					detail: "tab",
				},
			};
			await controller.reAnalyze(url);

			const view = controller.getView();
			expect(view.actionError).toBe(
				"Open the page in the active tab to re-analyze it from here.",
			);
			expect(view.rows[0].aiStatus).toBe("unavailable");
			expect(view.rows[0].canReAnalyze).toBe(true);
		});

		it("surfaces a safe action error when re-analyze fails", async () => {
			const fake = new FakeUseCases();
			const rec = recordOf({ id: "r", title: "Stale", aiStatus: "failed" });
			fake.cache = cacheOf([rec]);
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			fake.reAnalyzeResult = {
				ok: false,
				error: { kind: "drive", message: "token expired" },
			};
			await controller.reAnalyze(url);

			expect(controller.getView().actionError).toBe("token expired");
		});

		it("stays busy for the whole foreground re-analyze and clears when it resolves (MIK-021)", async () => {
			const fake = new FakeUseCases();
			const rec = recordOf({ id: "r", title: "Stale", aiStatus: "failed" });
			fake.cache = cacheOf([rec]);
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			const ready = recordOf({ id: "r", title: "Stale", aiStatus: "ready" });
			let finishAnalysis!: () => void;
			fake.reAnalyzeGate = new Promise((resolve) => {
				finishAnalysis = resolve;
			});
			fake.reAnalyzeResult = { ok: true, value: outcomeOf(ready) };

			const action = controller.reAnalyze(url);
			// The foreground analysis has not resolved yet: the action stays busy,
			// telling the user to keep the screen open.
			expect(controller.getView().busy).toBe(true);

			fake.cache = cacheOf([ready]);
			finishAnalysis();
			await action;

			expect(controller.getView().busy).toBe(false);
			expect(controller.getView().rows[0].aiStatus).toBe("ready");
			expect(controller.getView().actionNotice).toBeUndefined();
		});
	});

	describe("sync/write progress (MIK-026)", () => {
		it("marks sync.syncing for the whole Drive pull and clears it after", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ id: "a", title: "Alpha" })]);
			const controller = controllerWith(fake);
			await controller.init();
			expect(controller.getView().sync.syncing).toBe(false);

			let finishSync!: () => void;
			fake.syncGate = new Promise((resolve) => {
				finishSync = resolve;
			});
			const refresh = controller.refresh();
			// The Drive pull has not resolved yet: the view says a sync is running.
			expect(controller.getView().sync.syncing).toBe(true);
			expect(controller.getView().sync.writing).toBe(false);

			finishSync();
			await refresh;

			expect(controller.getView().sync.syncing).toBe(false);
		});

		it("drops duplicate refresh calls while a sync is in flight", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ id: "a", title: "Alpha" })]);
			const controller = controllerWith(fake);
			await controller.init();
			expect(fake.syncCalls).toBe(1); // init's own refresh

			let finishSync!: () => void;
			fake.syncGate = new Promise((resolve) => {
				finishSync = resolve;
			});
			const first = controller.refresh();
			const second = controller.refresh(); // double click — must not stack
			finishSync();
			await Promise.all([first, second]);

			expect(fake.syncCalls).toBe(2);
		});

		it("clears syncing after a failed pull while keeping the safe error", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ id: "a", title: "Cached" })], {
				status: "error",
				error: { kind: "drive", message: "network down" },
				pending: true,
			});
			fake.syncResult = {
				ok: false,
				error: { kind: "drive", message: "network down" },
			};
			const controller = controllerWith(fake);
			await controller.init();

			await controller.refresh();
			const view = controller.getView();

			expect(view.sync.syncing).toBe(false);
			expect(view.sync.status).toBe("error");
			expect(view.sync.error).toBe("network down");
			// Failed writes stay visible as pending local changes.
			expect(view.sync.pendingLocalChanges).toBe(true);
		});

		it("marks sync.writing for the whole delete write and clears it after", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ id: "d", title: "Doomed" })]);
			const controller = controllerWith(fake);
			await controller.init();

			let finishDelete!: () => void;
			fake.deleteGate = new Promise((resolve) => {
				finishDelete = resolve;
			});
			const url = controller.getView().rows[0].canonicalUrl;
			const action = controller.deleteBookmark(url);
			// The Drive write has not resolved yet: the view says a write is running.
			expect(controller.getView().sync.writing).toBe(true);
			expect(controller.getView().busy).toBe(true);
			expect(controller.getView().sync.syncing).toBe(false);

			finishDelete();
			await action;

			expect(controller.getView().sync.writing).toBe(false);
			expect(controller.getView().busy).toBe(false);
		});

		it("marks sync.writing during a foreground re-analyze", async () => {
			const fake = new FakeUseCases();
			const rec = recordOf({ id: "r", title: "Stale", aiStatus: "failed" });
			fake.cache = cacheOf([rec]);
			const controller = controllerWith(fake);
			await controller.init();

			const url = controller.getView().rows[0].canonicalUrl;
			const ready = recordOf({ id: "r", title: "Stale", aiStatus: "ready" });
			let finishAnalysis!: () => void;
			fake.reAnalyzeGate = new Promise((resolve) => {
				finishAnalysis = resolve;
			});
			fake.reAnalyzeResult = { ok: true, value: outcomeOf(ready) };

			const action = controller.reAnalyze(url);
			expect(controller.getView().sync.writing).toBe(true);

			fake.cache = cacheOf([ready]);
			finishAnalysis();
			await action;

			expect(controller.getView().sync.writing).toBe(false);
		});

		it("drops a refresh requested while a write is in flight", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ id: "d", title: "Doomed" })]);
			const controller = controllerWith(fake);
			await controller.init();
			expect(fake.syncCalls).toBe(1); // init's own refresh

			let finishDelete!: () => void;
			fake.deleteGate = new Promise((resolve) => {
				finishDelete = resolve;
			});
			const url = controller.getView().rows[0].canonicalUrl;
			const action = controller.deleteBookmark(url);
			await controller.refresh(); // e.g. a Manage-triggered request mid-write

			expect(fake.syncCalls).toBe(1);

			finishDelete();
			await action;
		});
	});

	describe("sync state", () => {
		it("surfaces a safe sync error when the Drive pull fails", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ id: "a", title: "Cached" })], {
				status: "error",
				error: { kind: "auth", message: "token expired" },
			});
			fake.syncResult = {
				ok: false,
				error: { kind: "drive", message: "token expired", detail: "auth" },
			};
			const controller = controllerWith(fake);

			await controller.init();
			const view = controller.getView();

			expect(view.sync.status).toBe("error");
			expect(view.sync.error).toBe("token expired");
			// The cached list still renders despite the sync failure.
			expect(view.rows.map((r) => r.title)).toEqual(["Cached"]);
		});
	});

	describe("long lists", () => {
		it("handles a large list and narrows it via search", async () => {
			const fake = new FakeUseCases();
			const records: BookmarkRecord[] = [];
			for (let i = 0; i < 200; i += 1) {
				records.push(
					recordOf({
						id: `bm-${i}`,
						url: `https://example.test/item-${i}`,
						title: i === 137 ? "Needle in the haystack" : `Item ${i}`,
						aiStatus: "ready",
					}),
				);
			}
			fake.cache = cacheOf(records);
			const controller = controllerWith(fake);
			await controller.init();

			expect(controller.getView().totalCount).toBe(200);

			controller.setQuery("needle");
			const view = controller.getView();
			expect(view.filteredCount).toBe(1);
			expect(view.rows[0].title).toBe("Needle in the haystack");
		});
	});
});
