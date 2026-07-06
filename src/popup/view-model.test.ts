import { describe, expect, it } from "vitest";

import {
	type BookmarkRecord,
	Bookmarks,
	bookmarkId,
	isoTimestamp,
} from "../lib/bookmarks/index";
import type { CacheState } from "../lib/storage/index";
import type {
	AppError,
	CanonicalUrl,
	PopupEnvironment,
	PopupUseCases,
	ProgressObserver,
	Result,
	SaveOutcome,
	SaveProgress,
	SaveStage,
	TabInfo,
} from "./use-cases";
import {
	createPopupController,
	type FlowView,
	type ModelSetupView,
} from "./view-model";

/**
 * The controller is exercised entirely through a fake {@link PopupUseCases} — no
 * React, Chrome, Drive, or Prompt API. That is the structural proof the popup
 * never reaches past the view-model boundary.
 */

const URL = "https://example.test/page";

function recordOf(opts: {
	url?: string;
	title?: string;
	aiStatus?: BookmarkRecord["aiStatus"];
	description?: string;
	genre?: string;
	tags?: string[];
	aiError?: string;
	id?: string;
	analysisMarkdown?: string;
	analysisProfileId?: string;
}): BookmarkRecord {
	const res = Bookmarks.empty().upsert(
		{
			url: opts.url ?? URL,
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
			id: bookmarkId(opts.id ?? "id-1"),
			now: isoTimestamp("2026-03-01T00:00:00Z"),
		},
	);
	if (!res.ok) {
		throw new Error(`bad fixture record: ${res.error.message}`);
	}
	const record = res.value.toArray()[0];
	if (!record) throw new Error("no record");
	return record;
}

function cacheOf(records: BookmarkRecord[]): CacheState {
	return {
		bookmarks: Bookmarks.from(records),
		sync: {
			status: "synced",
			lastSyncedAt: isoTimestamp("2026-03-01T00:00:00Z"),
		},
	};
}

function outcomeOf(
	record: BookmarkRecord,
	driveSynced = true,
	driveError?: AppError,
): SaveOutcome {
	return { record, aiStatus: record.aiStatus, driveSynced, driveError };
}

class FakeUseCases implements PopupUseCases {
	tab: Result<TabInfo, AppError> = {
		ok: true,
		value: { title: "Example Page", url: URL },
	};
	env: PopupEnvironment = { connection: "unknown", promptApi: "available" };
	cache: CacheState = cacheOf([]);
	saveResult: Result<SaveOutcome, AppError> = {
		ok: true,
		value: outcomeOf(recordOf({ aiStatus: "ready" })),
	};
	reAnalyzeResult: Result<SaveOutcome, AppError> | null = null;
	syncResult: Result<CacheState, AppError> | null = null;
	progressEvents: SaveProgress[] = [
		{ stage: "saving" },
		{ stage: "extracting" },
		{ stage: "analyzing" },
		{ stage: "syncing" },
	];
	saveCalls = 0;
	reAnalyzeArgs: CanonicalUrl[] = [];
	deleteResult: Result<CacheState, AppError> | null = null;
	deleteArgs: CanonicalUrl[] = [];

	async currentTab() {
		return this.tab;
	}
	async environment() {
		return this.env;
	}
	async loadCachedState() {
		return this.cache;
	}
	async syncFromDrive() {
		return this.syncResult ?? { ok: true as const, value: this.cache };
	}
	async saveCurrentTab(onProgress?: ProgressObserver) {
		this.saveCalls += 1;
		for (const event of this.progressEvents) {
			onProgress?.(event);
		}
		return this.saveResult;
	}
	async reAnalyzeBookmark(
		canonicalUrl: CanonicalUrl,
		onProgress?: ProgressObserver,
	) {
		this.reAnalyzeArgs.push(canonicalUrl);
		for (const event of this.progressEvents) {
			onProgress?.(event);
		}
		return this.reAnalyzeResult ?? this.saveResult;
	}
	async deleteBookmark(canonicalUrl: CanonicalUrl) {
		this.deleteArgs.push(canonicalUrl);
		return this.deleteResult ?? { ok: true as const, value: this.cache };
	}
}

function controllerWith(fake: FakeUseCases) {
	return createPopupController(fake);
}

describe("createPopupController", () => {
	describe("init", () => {
		it("loads tab, badges, recent bookmarks, and sync state", async () => {
			const fake = new FakeUseCases();
			fake.env = { connection: "connected", promptApi: "downloadable" };
			fake.cache = cacheOf([recordOf({ title: "Saved One", id: "id-1" })]);
			const controller = controllerWith(fake);

			await controller.init();
			const view = controller.getView();

			expect(view.loading).toBe(false);
			expect(view.tab).toEqual({ title: "Example Page", url: URL });
			expect(view.connection).toBe("connected");
			expect(view.promptApi).toBe("downloadable");
			expect(view.recent).toHaveLength(1);
			expect(view.recent[0].title).toBe("Saved One");
			expect(view.sync.status).toBe("synced");
			expect(view.sync.pendingLocalChanges).toBe(false);
			expect(view.canSave).toBe(true);
		});

		it("surfaces pending local changes from the cached sync state", async () => {
			const fake = new FakeUseCases();
			fake.cache = {
				bookmarks: Bookmarks.from([recordOf({ id: "id-1" })]),
				sync: { status: "error", pending: true },
			};
			const controller = controllerWith(fake);

			await controller.init();

			expect(controller.getView().sync.pendingLocalChanges).toBe(true);
		});

		it("renders without a tab when the active tab is unavailable", async () => {
			const fake = new FakeUseCases();
			fake.tab = {
				ok: false,
				error: { kind: "no-active-tab", message: "none" },
			};
			const controller = controllerWith(fake);

			await controller.init();

			expect(controller.getView().tab).toBeUndefined();
			expect(controller.getView().loading).toBe(false);
		});
	});

	describe("save flow", () => {
		it("walks the trail to a ready receipt on success", async () => {
			const record = recordOf({
				aiStatus: "ready",
				description: "説明文",
				genre: "開発ツール",
				tags: ["GitHub", "TypeScript"],
			});
			const fake = new FakeUseCases();
			fake.saveResult = { ok: true, value: outcomeOf(record) };
			fake.cache = cacheOf([record]);
			const controller = controllerWith(fake);
			await controller.init();

			await controller.save();
			const flow = controller.getView().flow;

			expect(flow.kind).toBe("done");
			if (flow.kind !== "done") return;
			expect(flow.receipt.aiStatus).toBe("ready");
			expect(flow.receipt.preview.description).toBe("説明文");
			expect(flow.receipt.preview.genre).toBe("開発ツール");
			expect(flow.receipt.preview.tags).toEqual(["GitHub", "TypeScript"]);
			expect(flow.trail.every((s) => s.status === "done")).toBe(true);
			// The saved bookmark is visible in recents.
			expect(controller.getView().recent).toHaveLength(1);
		});

		it("advances the running trail as progress stages arrive", async () => {
			const fake = new FakeUseCases();
			const controller = controllerWith(fake);
			await controller.init();

			const activeStages: SaveStage[] = [];
			controller.subscribe(() => {
				const flow = controller.getView().flow;
				if (flow.kind === "running") {
					const active = flow.trail.find((s) => s.status === "active");
					if (active) activeStages.push(active.key);
				}
			});

			await controller.save();

			// Every documented stage became active at some point during the run.
			expect(activeStages).toEqual(
				expect.arrayContaining([
					"saving",
					"extracting",
					"analyzing",
					"syncing",
				]),
			);
		});

		it("surfaces transient model setup/download detail during analyzing, then clears it", async () => {
			const fake = new FakeUseCases();
			fake.progressEvents = [
				{ stage: "saving" },
				{ stage: "extracting" },
				{ stage: "analyzing" },
				{ stage: "analyzing", detail: { kind: "model-preparing" } },
				{
					stage: "analyzing",
					detail: { kind: "model-downloading", ratio: 0 },
				},
				{
					stage: "analyzing",
					detail: { kind: "model-downloading", ratio: 0.42 },
				},
				{ stage: "analyzing", detail: { kind: "model-downloading" } },
				{ stage: "analyzing", detail: { kind: "model-ready" } },
				{ stage: "syncing" },
			];
			const controller = controllerWith(fake);
			await controller.init();

			const setups: Array<ModelSetupView | undefined> = [];
			controller.subscribe(() => {
				const flow = controller.getView().flow;
				if (flow.kind === "running") {
					setups.push(flow.modelSetup);
				}
			});

			await controller.save();

			expect(setups).toEqual([
				undefined, // flow start (trail at saving)
				undefined, // saving
				undefined, // extracting
				undefined, // analyzing began
				{ downloading: false }, // model-preparing
				{ downloading: true, percent: undefined }, // 0% stays percent-less
				{ downloading: true, percent: 42 }, // progress with ratio
				{ downloading: true, percent: undefined }, // progress without ratio
				undefined, // model-ready clears the line
				undefined, // syncing
			]);
			// The flow still finishes normally; the detail never leaks into the
			// durable receipt.
			expect(controller.getView().flow.kind).toBe("done");
		});

		it("keeps a visible saved bookmark when the Prompt API is unavailable", async () => {
			const record = recordOf({ aiStatus: "unavailable", title: "Saved Tab" });
			const fake = new FakeUseCases();
			fake.saveResult = { ok: true, value: outcomeOf(record) };
			fake.cache = cacheOf([record]);
			const controller = controllerWith(fake);
			await controller.init();

			await controller.save();
			const flow = controller.getView().flow;

			expect(flow.kind).toBe("done");
			if (flow.kind !== "done") return;
			expect(flow.receipt.aiStatus).toBe("unavailable");
			expect(stageStatus(flow, "saving")).toBe("done");
			expect(stageStatus(flow, "analyzing")).toBe("skipped");
			// Still visible in recents with the unavailable status.
			const recent = controller.getView().recent;
			expect(recent[0].aiStatus).toBe("unavailable");
			expect(recent[0].canReAnalyze).toBe(true);
		});

		it("keeps a visible saved bookmark and marks analyzing failed on AI failure", async () => {
			const record = recordOf({
				aiStatus: "failed",
				aiError: "model returned no JSON",
			});
			const fake = new FakeUseCases();
			fake.saveResult = { ok: true, value: outcomeOf(record) };
			fake.cache = cacheOf([record]);
			const controller = controllerWith(fake);
			await controller.init();

			await controller.save();
			const flow = controller.getView().flow;

			expect(flow.kind).toBe("done");
			if (flow.kind !== "done") return;
			expect(flow.receipt.aiStatus).toBe("failed");
			expect(flow.receipt.aiError).toBe("model returned no JSON");
			expect(stageStatus(flow, "analyzing")).toBe("failed");
		});

		it("points the trail at extraction when extraction failed", async () => {
			const record = recordOf({
				aiStatus: "failed",
				aiError: "extraction failed: no document",
			});
			const fake = new FakeUseCases();
			fake.saveResult = { ok: true, value: outcomeOf(record) };
			fake.cache = cacheOf([record]);
			const controller = controllerWith(fake);
			await controller.init();

			await controller.save();
			const flow = controller.getView().flow;
			if (flow.kind !== "done") throw new Error("expected done");
			expect(stageStatus(flow, "extracting")).toBe("failed");
			expect(stageStatus(flow, "analyzing")).toBe("skipped");
		});

		it("reports a Drive-only failure as saved locally with a warning", async () => {
			const record = recordOf({ aiStatus: "ready", description: "説明" });
			const fake = new FakeUseCases();
			fake.saveResult = {
				ok: true,
				value: outcomeOf(record, false, {
					kind: "drive",
					message: "network down",
				}),
			};
			fake.cache = cacheOf([record]);
			const controller = controllerWith(fake);
			await controller.init();

			await controller.save();
			const flow = controller.getView().flow;
			if (flow.kind !== "done") throw new Error("expected done");
			expect(flow.receipt.driveSynced).toBe(false);
			expect(flow.receipt.driveWarning).toContain("network down");
			expect(stageStatus(flow, "syncing")).toBe("failed");
		});

		it("shows a safe error when there is no active tab to save", async () => {
			const fake = new FakeUseCases();
			fake.saveResult = {
				ok: false,
				error: { kind: "no-active-tab", message: "no active tab to save" },
			};
			const controller = controllerWith(fake);
			await controller.init();

			await controller.save();
			const flow = controller.getView().flow;

			expect(flow.kind).toBe("error");
			if (flow.kind !== "error") return;
			expect(flow.message).toBe("no active tab to save");
			expect(stageStatus(flow, "saving")).toBe("failed");
		});

		it("ignores a second save while one is already running", async () => {
			const fake = new FakeUseCases();
			const controller = controllerWith(fake);
			await controller.init();

			const first = controller.save();
			const second = controller.save();
			await Promise.all([first, second]);

			expect(fake.saveCalls).toBe(1);
		});
	});

	describe("current bookmark", () => {
		it("detects the current tab as already bookmarked via canonical normalization", async () => {
			// The tab URL differs from the saved URL by www/tracking-param/fragment/
			// trailing-slash noise; both canonicalize to the same dedup key.
			const fake = new FakeUseCases();
			fake.tab = {
				ok: true,
				value: {
					title: "Example Page",
					url: "https://www.example.test/page/?utm_source=news#top",
				},
			};
			fake.cache = cacheOf([recordOf({ title: "Saved Before" })]);
			const controller = controllerWith(fake);

			await controller.init();
			const current = controller.getView().currentBookmark;

			expect(current).toBeDefined();
			expect(current?.title).toBe("Saved Before");
			expect(current?.aiStatus).toBe("ready");
		});

		it("leaves currentBookmark undefined when the page is not bookmarked", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ url: "https://other.test/x" })]);
			const controller = controllerWith(fake);

			await controller.init();

			expect(controller.getView().currentBookmark).toBeUndefined();
		});

		it("leaves currentBookmark undefined for a non-bookmarkable tab URL", async () => {
			const fake = new FakeUseCases();
			fake.tab = {
				ok: true,
				value: { title: "Extensions", url: "chrome://extensions" },
			};
			fake.cache = cacheOf([recordOf({})]);
			const controller = controllerWith(fake);

			await controller.init();

			expect(controller.getView().currentBookmark).toBeUndefined();
			expect(controller.getView().canSave).toBe(true);
		});

		it("marks the current page bookmarked after a successful save", async () => {
			const record = recordOf({ aiStatus: "ready" });
			const fake = new FakeUseCases();
			fake.cache = cacheOf([]);
			fake.saveResult = { ok: true, value: outcomeOf(record) };
			const controller = controllerWith(fake);
			await controller.init();
			expect(controller.getView().currentBookmark).toBeUndefined();

			fake.cache = cacheOf([record]);
			await controller.save();

			expect(controller.getView().currentBookmark?.title).toBe("Example Page");
		});
	});

	describe("deleteCurrentBookmark", () => {
		it("deletes through the use case and clears current/recent state", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({})]);
			const controller = controllerWith(fake);
			await controller.init();
			expect(controller.getView().currentBookmark).toBeDefined();

			fake.deleteResult = { ok: true, value: cacheOf([]) };
			await controller.deleteCurrentBookmark();

			expect(fake.deleteArgs).toHaveLength(1);
			expect(fake.deleteArgs[0]).toBe("https://example.test/page");
			const view = controller.getView();
			expect(view.currentBookmark).toBeUndefined();
			expect(view.recent).toHaveLength(0);
			expect(view.deleting).toBe(false);
			expect(view.deleteError).toBeUndefined();
		});

		it("surfaces a safe error and keeps state when delete fails", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({})]);
			const controller = controllerWith(fake);
			await controller.init();

			fake.deleteResult = {
				ok: false,
				error: { kind: "drive", message: "cache write  failed\nbadly" },
			};
			await controller.deleteCurrentBookmark();

			const view = controller.getView();
			// Whitespace is collapsed by the safe-message guard.
			expect(view.deleteError).toBe("cache write failed badly");
			expect(view.currentBookmark).toBeDefined();
			expect(view.recent).toHaveLength(1);
			expect(view.deleting).toBe(false);
		});

		it("is a no-op when the current page is not bookmarked", async () => {
			const fake = new FakeUseCases();
			const controller = controllerWith(fake);
			await controller.init();

			await controller.deleteCurrentBookmark();

			expect(fake.deleteArgs).toHaveLength(0);
		});

		it("is a no-op while a save flow is running", async () => {
			const record = recordOf({});
			const fake = new FakeUseCases();
			fake.cache = cacheOf([record]);
			let resolveSave!: (r: Result<SaveOutcome, AppError>) => void;
			fake.saveCurrentTab = () =>
				new Promise((resolve) => {
					resolveSave = resolve;
				});
			const controller = controllerWith(fake);
			await controller.init();

			const saving = controller.save();
			await controller.deleteCurrentBookmark();
			expect(fake.deleteArgs).toHaveLength(0);

			resolveSave({ ok: true, value: outcomeOf(record) });
			await saving;
		});
	});

	describe("reAnalyze", () => {
		it("re-runs analysis for a known recent bookmark and reaches ready", async () => {
			const stale = recordOf({ aiStatus: "unavailable", title: "Stale" });
			const ready = recordOf({
				aiStatus: "ready",
				title: "Stale",
				description: "再分析済み",
			});
			const fake = new FakeUseCases();
			fake.cache = cacheOf([stale]);
			fake.reAnalyzeResult = { ok: true, value: outcomeOf(ready) };
			const controller = controllerWith(fake);
			await controller.init();

			const target = controller.getView().recent[0].canonicalUrl;
			await controller.reAnalyze(target);

			expect(fake.reAnalyzeArgs).toHaveLength(1);
			const flow = controller.getView().flow;
			expect(flow.kind).toBe("done");
			if (flow.kind !== "done") return;
			expect(flow.receipt.aiStatus).toBe("ready");
			expect(flow.receipt.preview.description).toBe("再分析済み");
		});

		it("is a no-op for an unknown canonical URL", async () => {
			const fake = new FakeUseCases();
			const controller = controllerWith(fake);
			await controller.init();

			await controller.reAnalyze("https://unknown.test/");

			expect(fake.reAnalyzeArgs).toHaveLength(0);
			expect(controller.getView().flow.kind).toBe("idle");
		});
	});

	describe("recent detail (MIK-028)", () => {
		it("opens the compact detail for a known recent bookmark", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({
					title: "Saved One",
					description: "説明文",
					genre: "技術",
					tags: ["a", "b"],
					analysisMarkdown: "## 概要\n\n分析本文。",
					analysisProfileId: "github-repository",
				}),
			]);
			const controller = controllerWith(fake);
			await controller.init();

			const target = controller.getView().recent[0].canonicalUrl;
			controller.selectRecent(target);
			const detail = controller.getView().selectedRecent;

			expect(detail).toBeDefined();
			expect(detail?.title).toBe("Saved One");
			expect(detail?.description).toBe("説明文");
			expect(detail?.genre).toBe("技術");
			expect(detail?.tags).toEqual(["a", "b"]);
			expect(detail?.analysisMarkdown).toBe("## 概要\n\n分析本文。");
			expect(detail?.analysisProfileId).toBe("github-repository");
			// A built-in profile id resolves to its readable name (MIK-031).
			expect(detail?.analysisProfileName).toBe("GitHubリポジトリ");
		});

		it("falls back to the raw profile id for an unknown analysis profile (MIK-031)", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({ analysisProfileId: "custom-or-gone-skill" }),
			]);
			const controller = controllerWith(fake);
			await controller.init();

			controller.selectRecent(controller.getView().recent[0].canonicalUrl);
			const detail = controller.getView().selectedRecent;

			expect(detail?.analysisProfileName).toBe("custom-or-gone-skill");
		});

		it("resolves no profile name when the record has no analysis profile (MIK-031)", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({})]);
			const controller = controllerWith(fake);
			await controller.init();

			controller.selectRecent(controller.getView().recent[0].canonicalUrl);
			const detail = controller.getView().selectedRecent;

			expect(detail).toBeDefined();
			expect(detail?.analysisProfileName).toBeUndefined();
		});

		it("is a no-op for an unknown canonical URL", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({})]);
			const controller = controllerWith(fake);
			await controller.init();

			controller.selectRecent("https://unknown.test/");

			expect(controller.getView().selectedRecent).toBeUndefined();
		});

		it("clearRecentSelection closes the detail", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({})]);
			const controller = controllerWith(fake);
			await controller.init();

			const target = controller.getView().recent[0].canonicalUrl;
			controller.selectRecent(target);
			expect(controller.getView().selectedRecent).toBeDefined();

			controller.clearRecentSelection();

			expect(controller.getView().selectedRecent).toBeUndefined();
		});

		it("updates the open detail in place after a refresh", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({ aiStatus: "pending" })]);
			const controller = controllerWith(fake);
			await controller.init();

			const target = controller.getView().recent[0].canonicalUrl;
			controller.selectRecent(target);
			expect(controller.getView().selectedRecent?.aiStatus).toBe("pending");

			fake.syncResult = {
				ok: true,
				value: cacheOf([
					recordOf({ aiStatus: "ready", analysisMarkdown: "## 更新後" }),
				]),
			};
			await controller.refresh();

			const detail = controller.getView().selectedRecent;
			expect(detail?.aiStatus).toBe("ready");
			expect(detail?.analysisMarkdown).toBe("## 更新後");
		});

		it("drops the selection when the record disappears from the cache", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([recordOf({})]);
			const controller = controllerWith(fake);
			await controller.init();

			const target = controller.getView().recent[0].canonicalUrl;
			controller.selectRecent(target);
			expect(controller.getView().selectedRecent).toBeDefined();

			fake.syncResult = { ok: true, value: cacheOf([]) };
			await controller.refresh();

			expect(controller.getView().selectedRecent).toBeUndefined();
		});

		it("surfaces a safe aiError on the detail", async () => {
			const fake = new FakeUseCases();
			fake.cache = cacheOf([
				recordOf({ aiStatus: "failed", aiError: "model  returned\nno JSON" }),
			]);
			const controller = controllerWith(fake);
			await controller.init();

			controller.selectRecent(controller.getView().recent[0].canonicalUrl);

			// Whitespace is collapsed by the safe-message guard.
			expect(controller.getView().selectedRecent?.aiError).toBe(
				"model returned no JSON",
			);
		});
	});

	describe("refresh", () => {
		it("updates recents and sync from the authoritative store", async () => {
			const fake = new FakeUseCases();
			const controller = controllerWith(fake);
			await controller.init();

			fake.syncResult = {
				ok: true,
				value: cacheOf([recordOf({ title: "Pulled" })]),
			};
			await controller.refresh();

			expect(controller.getView().recent[0].title).toBe("Pulled");
			expect(controller.getView().sync.status).toBe("synced");
		});

		it("surfaces the cached sync error when the Drive pull fails", async () => {
			const fake = new FakeUseCases();
			fake.cache = {
				bookmarks: Bookmarks.empty(),
				sync: {
					status: "error",
					error: { kind: "auth", message: "token expired" },
				},
			};
			fake.syncResult = {
				ok: false,
				error: { kind: "drive", message: "token expired", detail: "auth" },
			};
			const controller = controllerWith(fake);
			await controller.init();

			await controller.refresh();

			expect(controller.getView().sync.status).toBe("error");
			expect(controller.getView().sync.error).toBe("token expired");
		});
	});
});

function stageStatus(
	flow: Extract<FlowView, { kind: "done" | "error" }>,
	key: SaveStage,
): string | undefined {
	return flow.trail.find((s) => s.key === key)?.status;
}
