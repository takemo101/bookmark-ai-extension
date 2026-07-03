import { describe, expect, it } from "vitest";

import {
	type AnalyzerPort,
	type BookmarkRepositoryPort,
	type Clock,
	type IdGenerator,
	type PageExtractorPort,
	type TabProviderPort,
	createBookmarkApp,
	ok as appOk,
} from "../lib/app/index";
import type { AnalysisInput, AnalysisOutcome } from "../lib/ai/index";
import {
	Bookmarks,
	type CanonicalUrl,
	bookmarkId,
	isoTimestamp,
} from "../lib/bookmarks/index";
import {
	type DriveFileId,
	type DriveFolderId,
	type DriveRevision,
	type RepositorySnapshot,
	type Result as DriveResult,
	ok as driveOk,
} from "../lib/drive/index";
import {
	type ExtractedPage,
	type ExtractionError,
	type Result as ExtractionResult,
	ok as extractionOk,
} from "../lib/extraction/index";
import type { CacheState, LocalCache } from "../lib/storage/index";
import type {
	PopupEnvironment,
	PopupEnvironmentProvider,
	SaveStage,
	TabInfo,
} from "./use-cases";
import { createPopupUseCases } from "./use-cases";

/**
 * The popup use-cases adapter is exercised over the *real* `createBookmarkApp`
 * with fakes for every external port. That is the proof that the per-stage save
 * progress the popup renders is genuine — each event is emitted as the matching
 * dependency is actually invoked, not fabricated around an atomic call.
 */

const URL = "https://example.test/page";

const FOLDER = { id: "folder-1" as DriveFolderId, name: "bookmark-ai" };
function fileMeta(rev: number) {
	return {
		id: "file-1" as DriveFileId,
		name: "bookmarks.jsonl",
		revision: `rev-${rev}` as DriveRevision,
	};
}

const PAGE: ExtractedPage = {
	url: URL,
	title: "Example Page",
	headings: [],
	mainText: ["Some body text to summarize."],
};

/** A timeline both the fakes and the progress observer write to, in call order. */
function timeline() {
	const events: string[] = [];
	return {
		events,
		mark: (event: string) => events.push(event),
	};
}

function makeApp(mark: (event: string) => void) {
	const repository: BookmarkRepositoryPort = {
		async bootstrap() {
			throw new Error("not used");
		},
		async load(): Promise<DriveResult<RepositorySnapshot, never>> {
			return driveOk({
				bookmarks: Bookmarks.empty(),
				problems: [],
				file: fileMeta(1),
				folder: FOLDER,
			});
		},
		async save(local): Promise<DriveResult<RepositorySnapshot, never>> {
			mark("save");
			return driveOk({
				bookmarks: local,
				problems: [],
				file: fileMeta(2),
				folder: FOLDER,
			});
		},
	};

	const analyzer: AnalyzerPort = {
		async analyze(_input: AnalysisInput): Promise<AnalysisOutcome> {
			mark("analyze");
			return {
				status: "ready",
				analysis: {
					description: "説明",
					genre: "開発",
					tags: ["a"],
					analysisMarkdown: "## 概要\n\n分析本文。",
				},
				profileId: "generic-page",
			};
		},
	};

	const extractor: PageExtractorPort = {
		async extract(): Promise<ExtractionResult<ExtractedPage, ExtractionError>> {
			mark("extract");
			return extractionOk(PAGE);
		},
	};

	const tabs: TabProviderPort = {
		async activeTab() {
			return appOk({ id: 7, url: URL, title: "Example Page" });
		},
	};

	let cached: CacheState = {
		bookmarks: Bookmarks.empty(),
		sync: { status: "idle" },
	};
	const cache: LocalCache = {
		async load() {
			return cached;
		},
		async save(state) {
			cached = state;
		},
		async clear() {
			cached = { bookmarks: Bookmarks.empty(), sync: { status: "idle" } };
		},
	};

	let counter = 0;
	const ids: IdGenerator = {
		next() {
			counter += 1;
			return bookmarkId(`id-${counter}`);
		},
	};
	const clock: Clock = {
		now() {
			return isoTimestamp("2026-03-01T00:00:00Z");
		},
	};

	return createBookmarkApp({
		repository,
		analyzer,
		extractor,
		tabs,
		cache,
		clock,
		ids,
	});
}

const fakeEnv: PopupEnvironmentProvider = {
	async currentTab() {
		return appOk({ title: "Example Page", url: URL } satisfies TabInfo);
	},
	async environment(): Promise<PopupEnvironment> {
		return { connection: "connected", promptApi: "available" };
	},
};

/**
 * `analyzing`/`syncing` now happen inside the in-memory analysis queue
 * (MIK-019), *after* `saveCurrentTab`/`reAnalyzeBookmark` itself resolves — so
 * every test below that needs to see those later stages waits for
 * `onAnalysisSettled` before asserting on them, rather than assuming they
 * already happened by the time the save/re-analyze call returns.
 */
function waitForSettled(useCases: {
	onAnalysisSettled(listener: () => void): () => void;
}): Promise<void> {
	return new Promise((resolve) => {
		const unsubscribe = useCases.onAnalysisSettled(() => {
			unsubscribe();
			resolve();
		});
	});
}

describe("createPopupUseCases", () => {
	it("forwards genuine per-stage save progress in flow order", async () => {
		const t = timeline();
		const useCases = createPopupUseCases(makeApp(t.mark), fakeEnv);

		const stages: SaveStage[] = [];
		const settled = waitForSettled(useCases);
		const result = await useCases.saveCurrentTab(({ stage }) => {
			stages.push(stage);
			t.mark(`stage:${stage}`);
		});
		expect(result.ok).toBe(true);
		// `saving`/`extracting` have already fired by the time the call resolves;
		// `analyzing`/`syncing` now happen inside the queue, which may or may not
		// have caught up yet — only that it hasn't skipped ahead of `saving`.
		expect(stages.slice(0, 2)).toEqual(["saving", "extracting"]);

		await settled;
		expect(stages).toEqual(["saving", "extracting", "analyzing", "syncing"]);

		// Each stage is emitted before the work it announces actually runs.
		const { events } = t;
		expect(events.indexOf("stage:extracting")).toBeLessThan(
			events.indexOf("extract"),
		);
		expect(events.indexOf("stage:analyzing")).toBeLessThan(
			events.indexOf("analyze"),
		);
		// Extraction precedes analysis, which precedes the final sync write.
		expect(events.indexOf("extract")).toBeLessThan(events.indexOf("analyze"));
		expect(events.indexOf("stage:syncing")).toBeLessThan(
			events.lastIndexOf("save"),
		);
	});

	it("emits the same genuine stages for re-analyze", async () => {
		const t = timeline();
		const app = makeApp(t.mark);
		// Seed a saved bookmark to re-analyze; wait for its own queued analysis
		// to settle first so it doesn't race with the re-analyze below.
		const seedSettled = new Promise<void>((resolve) => {
			const unsubscribe = app.onAnalysisSettled(() => {
				unsubscribe();
				resolve();
			});
		});
		const saved = await app.saveCurrentTab();
		expect(saved.ok).toBe(true);
		await seedSettled;

		const useCases = createPopupUseCases(app, fakeEnv);
		const canonical = (await useCases.loadCachedState()).bookmarks.toArray()[0]
			?.canonicalUrl as CanonicalUrl;

		const stages: SaveStage[] = [];
		const settled = waitForSettled(useCases);
		const result = await useCases.reAnalyzeBookmark(canonical, ({ stage }) =>
			stages.push(stage),
		);
		expect(result.ok).toBe(true);
		expect(stages.slice(0, 2)).toEqual(["saving", "extracting"]);

		await settled;
		expect(stages).toEqual(["saving", "extracting", "analyzing", "syncing"]);
	});

	it("never emits progress when no observer is passed", async () => {
		const t = timeline();
		const useCases = createPopupUseCases(makeApp(t.mark), fakeEnv);
		const settled = waitForSettled(useCases);
		const result = await useCases.saveCurrentTab();
		expect(result.ok).toBe(true);
		expect(t.events).toContain("extract");

		// Analysis itself is queued and finishes in the background.
		await settled;
		expect(t.events).toContain("analyze");
	});

	it("relays the environment provider's badges unchanged", async () => {
		const useCases = createPopupUseCases(makeApp(timeline().mark), fakeEnv);
		expect(await useCases.environment()).toEqual({
			connection: "connected",
			promptApi: "available",
		});
	});
});
