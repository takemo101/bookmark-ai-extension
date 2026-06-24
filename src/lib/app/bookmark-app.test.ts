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
		// Union merge, exactly like DriveBookmarkRepository.
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
	constructor(private outcome: AnalysisOutcome) {}
	setOutcome(outcome: AnalysisOutcome) {
		this.outcome = outcome;
	}
	async analyze(input: AnalysisInput): Promise<AnalysisOutcome> {
		this.calls.push(input);
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
		this.state = state ?? { bookmarks: Bookmarks.empty(), sync: { status: "idle" } };
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
	analysis: { description: "説明文", genre: "開発ツール", tags: ["GitHub", "TypeScript"] },
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
	} = {},
): Harness {
	const tab =
		opts.tab ??
		appOk({ id: 7, url: "https://example.test/page", title: "Example Page" });
	const repo = new FakeRepository(opts.remote);
	const analyzer = new FakeAnalyzer(opts.outcome ?? READY);
	const extractor = new FakeExtractor(
		opts.extraction ?? extractionOk(samplePage("https://example.test/page", "Example Page")),
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
	});

	describe("loadCachedState", () => {
		it("returns the cached state without touching Drive", async () => {
			const { app, repo } = makeHarness();
			await app.loadCachedState();
			expect(repo.saveCalls).toBe(0);
		});
	});
});
