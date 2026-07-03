import { describe, expect, it } from "vitest";

import {
	Bookmarks,
	type CanonicalUrl,
	type IsoTimestamp,
	type BookmarkId,
	bookmarkId,
	isoTimestamp,
} from "../bookmarks/index";
import type {
	DriveFileId,
	DriveFolderId,
	DriveRevision,
	RepositoryError,
	RepositorySnapshot,
	Result as DriveResult,
} from "../drive/index";
import { ok as driveOk, err as driveErr } from "../drive/index";
import type {
	AnalysisInput,
	AnalysisOutcome,
	AnalysisProfile,
} from "../ai/index";
import type {
	ExtractedPage,
	ExtractionError,
	Result as ExtractionResult,
} from "../extraction/index";
import { ok as extractionOk, err as extractionErr } from "../extraction/index";
import type { CacheState, LocalCache } from "../storage/index";
import { createBookmarkApp } from "./bookmark-app";
import type {
	ActiveTab,
	AnalyzerPort,
	BookmarkRepositoryPort,
	Clock,
	IdGenerator,
	PageExtractorPort,
	TabProviderPort,
} from "./ports";
import type { AppError } from "./errors";
import type { Result } from "./result";
import { ok as appOk } from "./result";

/**
 * Every use case is exercised through fakes for *all* external dependencies — no
 * Chrome, no Drive, no Prompt API, no real extraction. The fakes implement only
 * the ports, which is the structural proof the use cases never reach past them.
 */

const FOLDER = { id: "folder-1" as DriveFolderId, name: "bookmark-ai" };
function fileMeta(rev: number) {
	return {
		id: "file-1" as DriveFileId,
		name: "bookmarks.jsonl",
		revision: `rev-${rev}` as DriveRevision,
	};
}

/** In-memory repository that mirrors the real union-merge `save` semantics. */
class FakeRepository implements BookmarkRepositoryPort {
	remote: Bookmarks;
	revision = 1;
	failKind: RepositoryError["kind"] | null = null;
	saveCalls = 0;

	constructor(remote: Bookmarks = Bookmarks.empty()) {
		this.remote = remote;
	}

	async bootstrap(): Promise<DriveResult<never, RepositoryError>> {
		throw new Error("not used");
	}

	async load(): Promise<DriveResult<RepositorySnapshot, RepositoryError>> {
		if (this.failKind) {
			return driveErr({ kind: this.failKind, message: "load boom" });
		}
		return driveOk(this.snapshot());
	}

	async save(
		local: Bookmarks,
	): Promise<DriveResult<RepositorySnapshot, RepositoryError>> {
		this.saveCalls += 1;
		if (this.failKind) {
			return driveErr({ kind: this.failKind, message: "save boom" });
		}
		// Domain merge (tombstone-aware), exactly like DriveBookmarkRepository.
		this.remote = local.mergeRemote(this.remote);
		this.revision += 1;
		return driveOk(this.snapshot());
	}

	private snapshot(): RepositorySnapshot {
		return {
			bookmarks: this.remote,
			problems: [],
			file: fileMeta(this.revision),
			folder: FOLDER,
		};
	}
}

class FakeAnalyzer implements AnalyzerPort {
	calls: AnalysisInput[] = [];
	customProfileCalls: (readonly AnalysisProfile[] | undefined)[] = [];
	constructor(private outcome: AnalysisOutcome) {}
	setOutcome(outcome: AnalysisOutcome) {
		this.outcome = outcome;
	}
	async analyze(
		input: AnalysisInput,
		customProfiles?: readonly AnalysisProfile[],
	): Promise<AnalysisOutcome> {
		this.calls.push(input);
		this.customProfileCalls.push(customProfiles);
		return this.outcome;
	}
}

class FakeExtractor implements PageExtractorPort {
	calls = 0;
	constructor(
		private result: ExtractionResult<ExtractedPage, ExtractionError>,
	) {}
	setResult(result: ExtractionResult<ExtractedPage, ExtractionError>) {
		this.result = result;
	}
	async extract(): Promise<ExtractionResult<ExtractedPage, ExtractionError>> {
		this.calls += 1;
		return this.result;
	}
}

class FakeTabs implements TabProviderPort {
	constructor(private result: Result<ActiveTab, AppError>) {}
	async activeTab(): Promise<Result<ActiveTab, AppError>> {
		return this.result;
	}
}

class FakeCache implements LocalCache {
	state: CacheState;
	saves: CacheState[] = [];
	constructor(state?: CacheState) {
		this.state = state ?? {
			bookmarks: Bookmarks.empty(),
			sync: { status: "idle" },
		};
	}
	async load(): Promise<CacheState> {
		return this.state;
	}
	async save(state: CacheState): Promise<void> {
		this.state = state;
		this.saves.push(state);
	}
	async clear(): Promise<void> {
		this.state = { bookmarks: Bookmarks.empty(), sync: { status: "idle" } };
	}
}

/** Deterministic clock that advances one minute per read. */
function fakeClock(): Clock {
	let minute = 0;
	return {
		now(): IsoTimestamp {
			const mm = String(minute++).padStart(2, "0");
			return isoTimestamp(`2026-03-01T00:${mm}:00Z`);
		},
	};
}

function fakeIds(): IdGenerator {
	let n = 0;
	return {
		next(): BookmarkId {
			return bookmarkId(`id-${n++}`);
		},
	};
}

function samplePage(url: string, title: string): ExtractedPage {
	return {
		url,
		title,
		headings: [],
		mainText: ["Some body text for the excerpt."],
	};
}

const READY: AnalysisOutcome = {
	status: "ready",
	analysis: {
		description: "説明文",
		genre: "開発ツール",
		tags: ["GitHub", "TypeScript"],
		analysisMarkdown: "## 概要\n\n分析本文。",
	},
	profileId: "github-repository",
};

type Harness = {
	app: ReturnType<typeof createBookmarkApp>;
	repo: FakeRepository;
	analyzer: FakeAnalyzer;
	extractor: FakeExtractor;
	cache: FakeCache;
};

function makeHarness(
	opts: {
		tab?: Result<ActiveTab, AppError>;
		remote?: Bookmarks;
		outcome?: AnalysisOutcome;
		extraction?: ExtractionResult<ExtractedPage, ExtractionError>;
		cache?: CacheState;
		settingsProvider?: {
			currentCustomProfiles(): Promise<readonly AnalysisProfile[]>;
		};
	} = {},
): Harness {
	const tab =
		opts.tab ??
		appOk({ id: 7, url: "https://example.test/page", title: "Example Page" });
	const repo = new FakeRepository(opts.remote);
	const analyzer = new FakeAnalyzer(opts.outcome ?? READY);
	const extractor = new FakeExtractor(
		opts.extraction ??
			extractionOk(samplePage("https://example.test/page", "Example Page")),
	);
	const cache = new FakeCache(opts.cache);
	const app = createBookmarkApp({
		repository: repo,
		analyzer,
		extractor,
		tabs: new FakeTabs(tab),
		cache,
		clock: fakeClock(),
		ids: fakeIds(),
		settingsProvider: opts.settingsProvider,
	});
	return { app, repo, analyzer, extractor, cache };
}

describe("createBookmarkApp", () => {
	describe("saveCurrentTab", () => {
		it("saves, analyzes, and marks the bookmark ready on success", async () => {
			const { app, repo, cache } = makeHarness();

			const result = await app.saveCurrentTab();

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.aiStatus).toBe("ready");
			expect(result.value.driveSynced).toBe(true);
			expect(result.value.record.description).toBe("説明文");
			expect(result.value.record.genre).toBe("開発ツール");
			expect(result.value.record.tags).toEqual(["GitHub", "TypeScript"]);
			expect(result.value.record.analysisMarkdown).toBe(
				"## 概要\n\n分析本文。",
			);
			expect(result.value.record.analysisProfileId).toBe("github-repository");
			// Pending was written first (create/update pending → persist → analyze),
			// so Drive was saved twice: once pending, once final.
			expect(repo.saveCalls).toBe(2);
			expect(cache.state.bookmarks.size).toBe(1);
			expect(cache.state.sync.status).toBe("synced");
		});

		it("returns an error when there is no active tab", async () => {
			const { app } = makeHarness({
				tab: { ok: false, error: { kind: "no-active-tab", message: "none" } },
			});
			const result = await app.saveCurrentTab();
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("no-active-tab");
		});

		it("rejects a tab whose URL is not bookmarkable", async () => {
			const { app } = makeHarness({
				tab: appOk({ id: 1, url: "about:blank", title: "blank" }),
			});
			const result = await app.saveCurrentTab();
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("invalid-tab");
		});

		it("keeps the bookmark as unavailable when the Prompt API is unavailable", async () => {
			const { app, analyzer } = makeHarness({
				outcome: { status: "unavailable", reason: "Prompt API unavailable" },
			});
			const result = await app.saveCurrentTab();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.aiStatus).toBe("unavailable");
			expect(result.value.driveSynced).toBe(true);
			expect(analyzer.calls).toHaveLength(1);
		});

		it("marks the bookmark failed on malformed AI output", async () => {
			const { app } = makeHarness({
				outcome: {
					status: "failed",
					error: { kind: "invalid-json", message: "model returned no JSON" },
				},
			});
			const result = await app.saveCurrentTab();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.aiStatus).toBe("failed");
			expect(result.value.record.aiError).toBe("model returned no JSON");
		});

		it("marks the bookmark failed when extraction fails and never calls AI", async () => {
			const { app, analyzer, extractor } = makeHarness({
				extraction: extractionErr({ field: "page", message: "no document" }),
			});
			const result = await app.saveCurrentTab();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.aiStatus).toBe("failed");
			expect(result.value.record.aiError).toContain("extraction failed");
			expect(extractor.calls).toBe(1);
			expect(analyzer.calls).toHaveLength(0);
		});

		it("saves locally and reports the failure when Drive is down", async () => {
			const { app, repo, cache } = makeHarness();
			repo.failKind = "network";

			const result = await app.saveCurrentTab();

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			// AI still ran and applied locally; only the Drive write failed.
			expect(result.value.aiStatus).toBe("ready");
			expect(result.value.driveSynced).toBe(false);
			expect(result.value.driveError?.kind).toBe("drive");
			// The bookmark is preserved in the cache despite the Drive failure.
			expect(cache.state.bookmarks.size).toBe(1);
			expect(cache.state.sync.status).toBe("error");
		});
	});

	describe("syncFromDrive", () => {
		it("refreshes the cache from the authoritative Drive store", async () => {
			let remote = Bookmarks.empty();
			const seeded = remote.upsert(
				{ url: "https://remote.test/", title: "R" },
				{ id: bookmarkId("r"), now: isoTimestamp("2026-01-01T00:00:00Z") },
			);
			if (!seeded.ok) throw new Error("seed failed");
			remote = seeded.value;
			const { app, cache } = makeHarness({ remote });

			const result = await app.syncFromDrive();

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.bookmarks.size).toBe(1);
			expect(result.value.sync.status).toBe("synced");
			expect(cache.state.location?.folder.name).toBe("bookmark-ai");
		});

		it("records a sync error and preserves the cache on Drive failure", async () => {
			const { app, repo, cache } = makeHarness();
			repo.failKind = "auth";

			const result = await app.syncFromDrive();

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("drive");
			expect(result.error.detail).toBe("auth");
			expect(cache.state.sync.status).toBe("error");
			expect(cache.state.sync.error?.kind).toBe("auth");
		});
	});

	describe("unsynced local mutations (MIK-014)", () => {
		it("flags pending and preserves a delete tombstone across a sync while Drive is down, then pushes it on recovery", async () => {
			const { app, repo, cache } = makeHarness();
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;

			// Drive goes down; the delete only reaches the cache as a tombstone.
			repo.failKind = "network";
			const deleted = await app.deleteBookmark(canonicalUrl);
			expect(deleted.ok).toBe(true);
			expect(cache.state.sync.pending).toBe(true);
			expect(cache.state.bookmarks.size).toBe(0);
			expect(cache.state.bookmarks.tombstones()).toHaveLength(1);

			// A sync while Drive is still down must not discard the tombstone: it is
			// re-pushed (and fails again), so it survives for the next attempt.
			const stillDown = await app.syncFromDrive();
			expect(stillDown.ok).toBe(false);
			expect(cache.state.sync.pending).toBe(true);
			expect(cache.state.bookmarks.tombstones()).toHaveLength(1);
			// Drive still holds the live record because nothing was written to it yet.
			expect(repo.remote.get(canonicalUrl)).toBeDefined();

			// Drive recovers; the next sync pushes the tombstone and the delete sticks.
			repo.failKind = null;
			const recovered = await app.syncFromDrive();
			expect(recovered.ok).toBe(true);
			if (!recovered.ok) return;
			expect(recovered.value.bookmarks.get(canonicalUrl)).toBeUndefined();
			expect(recovered.value.sync.pending).toBeFalsy();
			expect(recovered.value.sync.status).toBe("synced");
			expect(repo.remote.get(canonicalUrl)).toBeUndefined();
			expect(repo.remote.tombstones()).toHaveLength(1);
		});

		it("does not discard an unsynced local save on remote sync and pushes it on recovery", async () => {
			const { app, repo, cache } = makeHarness();
			// Drive is down for the whole save: AI applies locally, the write fails.
			repo.failKind = "network";
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			expect(saved.value.driveSynced).toBe(false);
			expect(cache.state.sync.pending).toBe(true);
			expect(cache.state.bookmarks.size).toBe(1);
			const canonicalUrl = saved.value.record.canonicalUrl;
			// Drive never received the record.
			expect(repo.remote.size).toBe(0);

			// Drive recovers; syncing must push the local save rather than replacing
			// the cache with the (empty) remote state and silently losing it.
			repo.failKind = null;
			const synced = await app.syncFromDrive();
			expect(synced.ok).toBe(true);
			if (!synced.ok) return;
			expect(synced.value.bookmarks.size).toBe(1);
			expect(synced.value.bookmarks.get(canonicalUrl)).toBeDefined();
			expect(synced.value.sync.pending).toBeFalsy();
			expect(repo.remote.get(canonicalUrl)).toBeDefined();
		});

		it("preserves an unsynced re-analyze mutation and pushes it on recovery", async () => {
			const { app, repo, cache, analyzer } = makeHarness({
				outcome: { status: "unavailable", reason: "Prompt API unavailable" },
			});
			// First save lands as unavailable but reaches Drive.
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;

			// Now AI works but Drive is down: the re-analyze is applied locally only.
			analyzer.setOutcome(READY);
			repo.failKind = "network";
			const reAnalyzed = await app.reAnalyzeBookmark(canonicalUrl);
			expect(reAnalyzed.ok).toBe(true);
			if (!reAnalyzed.ok) return;
			expect(reAnalyzed.value.aiStatus).toBe("ready");
			expect(reAnalyzed.value.driveSynced).toBe(false);
			expect(cache.state.sync.pending).toBe(true);

			// Drive recovers; the re-analyzed record is pushed, not lost.
			repo.failKind = null;
			const synced = await app.syncFromDrive();
			expect(synced.ok).toBe(true);
			if (!synced.ok) return;
			const pushed = repo.remote.get(canonicalUrl);
			expect(pushed?.aiStatus).toBe("ready");
			expect(pushed?.description).toBe("説明文");
			expect(synced.value.sync.pending).toBeFalsy();
		});

		it("still pulls and replaces the cache when there are no pending local changes", async () => {
			let remote = Bookmarks.empty();
			const seeded = remote.upsert(
				{ url: "https://remote.test/", title: "R" },
				{ id: bookmarkId("r"), now: isoTimestamp("2026-01-01T00:00:00Z") },
			);
			if (!seeded.ok) throw new Error("seed failed");
			remote = seeded.value;
			const { app, repo } = makeHarness({ remote });

			const result = await app.syncFromDrive();

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			// A plain pull: no write was issued, the remote store is authoritative.
			expect(repo.saveCalls).toBe(0);
			expect(result.value.bookmarks.size).toBe(1);
			expect(result.value.sync.pending).toBeFalsy();
		});
	});

	describe("deleteBookmark", () => {
		it("removes the record from the cache via the domain delete", async () => {
			const { app } = makeHarness();
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;

			const result = await app.deleteBookmark(canonicalUrl);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.bookmarks.size).toBe(0);
			expect(result.value.bookmarks.get(canonicalUrl)).toBeUndefined();
		});

		it("is idempotent for an unknown canonical URL", async () => {
			const { app } = makeHarness();
			const result = await app.deleteBookmark(
				"https://missing.test/" as CanonicalUrl,
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.bookmarks.size).toBe(0);
		});

		it("does not resurrect a deleted bookmark on a later syncFromDrive", async () => {
			const { app } = makeHarness();
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;

			const deleted = await app.deleteBookmark(canonicalUrl);
			expect(deleted.ok).toBe(true);

			// Pull the authoritative store back from Drive: the deletion must hold,
			// which is the whole point of durable cross-device deletion.
			const synced = await app.syncFromDrive();
			expect(synced.ok).toBe(true);
			if (!synced.ok) return;
			expect(synced.value.bookmarks.size).toBe(0);
			expect(synced.value.bookmarks.get(canonicalUrl)).toBeUndefined();
		});

		it("propagates a deletion to a second device that still holds the record", async () => {
			// Device A saves, syncing the record into shared Drive state.
			const { app, repo } = makeHarness();
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;

			// Device B holds the same live record in its own cache.
			const deviceB = makeHarness({
				remote: repo.remote,
				cache: { bookmarks: repo.remote, sync: { status: "synced" } },
			});

			// Device A deletes; the tombstone lands in shared Drive state, which we
			// then hand to device B's Drive (Bookmarks is immutable, so this models
			// device B downloading the file device A just wrote).
			const deleted = await app.deleteBookmark(canonicalUrl);
			expect(deleted.ok).toBe(true);
			deviceB.repo.remote = repo.remote;

			// Device B syncs and the record is gone for it too.
			const synced = await deviceB.app.syncFromDrive();
			expect(synced.ok).toBe(true);
			if (!synced.ok) return;
			expect(synced.value.bookmarks.get(canonicalUrl)).toBeUndefined();
		});
	});

	describe("reAnalyzeBookmark", () => {
		it("re-runs analysis through the domain and reaches ready", async () => {
			const { app, analyzer } = makeHarness({
				outcome: { status: "unavailable", reason: "Prompt API unavailable" },
			});
			// First save lands as unavailable.
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;
			expect(saved.value.aiStatus).toBe("unavailable");

			// Now the Prompt API works; re-analyze should reach ready.
			analyzer.setOutcome(READY);
			const result = await app.reAnalyzeBookmark(canonicalUrl);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.aiStatus).toBe("ready");
			expect(result.value.record.description).toBe("説明文");
		});

		it("returns not-found for an unknown canonical URL", async () => {
			const { app } = makeHarness();
			const result = await app.reAnalyzeBookmark(
				"https://missing.test/" as CanonicalUrl,
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not-found");
		});

		it("returns a safe error and leaves the bookmark unchanged when the page is not the active tab (MIK-015)", async () => {
			const { app, repo, extractor, cache } = makeHarness();
			// Save lands `ready` while the page is the active tab and extractable.
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;
			const before = cache.state.bookmarks.get(canonicalUrl);
			const savesBefore = repo.saveCalls;

			// The page is no longer the active tab: the runtime extractor reports the
			// typed `tab` precondition error rather than reaching for another tab.
			extractor.setResult(
				extractionErr({
					field: "tab",
					message:
						"Open the page in the active tab to re-analyze it from here.",
				}),
			);

			const result = await app.reAnalyzeBookmark(canonicalUrl);

			expect(result.ok).toBe(false);
			if (result.ok) return;
			// A safe action error surfaces the precondition; nothing is mutated.
			expect(result.error.kind).toBe("extraction");
			expect(result.error.detail).toBe("tab");
			expect(result.error.message).toContain("active tab");
			// The cached record is unchanged and no Drive write was attempted for the
			// (non-)mutation: the bookmark keeps its prior `ready` status.
			expect(cache.state.bookmarks.get(canonicalUrl)).toBe(before);
			expect(cache.state.bookmarks.get(canonicalUrl)?.aiStatus).toBe("ready");
			expect(repo.saveCalls).toBe(savesBefore);
		});

		it("still marks the bookmark failed when extraction fails for a real reason after a valid target (MIK-015)", async () => {
			const { app, extractor, cache } = makeHarness();
			const saved = await app.saveCurrentTab();
			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			const canonicalUrl = saved.value.record.canonicalUrl;

			// The page *is* the active tab (no `tab` error), but its content could not
			// be read. This is a recoverable failure, not the activeTab precondition.
			extractor.setResult(
				extractionErr({ field: "page", message: "no document" }),
			);

			const result = await app.reAnalyzeBookmark(canonicalUrl);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.aiStatus).toBe("failed");
			expect(result.value.record.aiError).toContain("extraction failed");
			expect(cache.state.bookmarks.get(canonicalUrl)?.aiStatus).toBe("failed");
		});
	});

	describe("loadCachedState", () => {
		it("returns the cached state without touching Drive", async () => {
			const { app, repo } = makeHarness();
			await app.loadCachedState();
			expect(repo.saveCalls).toBe(0);
		});
	});

	describe("settingsProvider wiring (MIK-018)", () => {
		it("forwards the settings provider's custom profiles into the analyzer", async () => {
			const custom: AnalysisProfile = {
				id: "custom-1",
				name: "Custom",
				priority: 99,
				urlPatterns: ["example.test/*"],
				instruction: "Custom emphasis.",
			};
			const { app, analyzer } = makeHarness({
				settingsProvider: {
					async currentCustomProfiles() {
						return [custom];
					},
				},
			});

			await app.saveCurrentTab();

			expect(analyzer.customProfileCalls).toHaveLength(1);
			expect(analyzer.customProfileCalls[0]).toEqual([custom]);
		});

		it("degrades to an empty profile list when the settings provider throws", async () => {
			const { app, analyzer } = makeHarness({
				settingsProvider: {
					async currentCustomProfiles() {
						throw new Error("cache read failed");
					},
				},
			});

			const result = await app.saveCurrentTab();

			expect(result.ok).toBe(true);
			expect(analyzer.customProfileCalls).toEqual([[]]);
		});

		it("passes an empty profile list when no settings provider is supplied", async () => {
			const { app, analyzer } = makeHarness();

			await app.saveCurrentTab();

			expect(analyzer.customProfileCalls).toEqual([[]]);
		});
	});
});
