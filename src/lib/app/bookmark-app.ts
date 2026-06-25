/**
 * The application use cases: the only place that orchestrates the bookmark
 * domain, Drive repository, AI analyzer, page extractor, tab provider, and local
 * cache together. It mixes none of their internals — every external dependency
 * arrives as a port (see `./ports.ts`), so the whole surface is testable with
 * fakes and contains no Chrome, Drive, Prompt API, or extraction logic of its
 * own (docs/implementation-principles.md "Module boundary rules").
 *
 * State-transition decisions (upsert, apply analysis, mark pending/unavailable/
 * failed, delete) are delegated to first-class {@link Bookmarks} operations
 * rather than performed by hand here ("Tell, don't ask"). The cache is written
 * as a cache; Drive remains the source of truth.
 *
 * ## Known limitation: deletion vs. the union merge
 *
 * The MVP Drive repository's `save` merges local and remote by *union* of
 * canonical URLs (`Bookmarks.mergeRemote`), so it has no way to propagate a
 * deletion to Drive yet. `deleteBookmark` therefore removes the record from the
 * local cache (the render source) but a later `syncFromDrive` can resurrect it.
 * Durable cross-PC deletion needs a repository capability (tombstones or an
 * explicit delete) that is out of scope for this issue — see the report's
 * follow-up risks.
 */
import {
	type AiAnalysis,
	type AiStatus,
	type BookmarkRecord,
	type Bookmarks,
	type CanonicalUrl,
	type CollectionError,
	canonicalizeUrl,
} from "../bookmarks/index";
import type { DriveLocation } from "../drive/index";
import { buildExcerpt } from "../extraction/index";
import type { CacheState } from "../storage/index";
import {
	type AppError,
	appError,
	fromCollectionError,
	fromRepositoryError,
	toSyncError,
} from "./errors";
import type {
	AppDeps,
	ExtractionTarget,
	LogLevel,
	SaveProgress,
} from "./ports";
import { type Result, err, ok } from "./result";

/** The result of a save / re-analyze flow, shaped for popup status display. */
export type SaveOutcome = {
	/** The record as it now stands after the flow (pending/ready/unavailable/failed). */
	readonly record: BookmarkRecord;
	readonly aiStatus: AiStatus;
	/** Whether the final write reached Drive. `false` ⇒ saved locally only. */
	readonly driveSynced: boolean;
	/** Present only when `driveSynced` is `false`: why Drive did not accept it. */
	readonly driveError?: AppError;
};

/** The use-case surface exposed to the popup/options UI. */
export interface BookmarkApp {
	/** Render-fast read of the last cached state. Never hits Drive. */
	loadCachedState(): Promise<CacheState>;
	/** Pull the authoritative store from Drive and refresh the cache. */
	syncFromDrive(): Promise<Result<CacheState, AppError>>;
	/**
	 * Save the current active tab, then extract → analyze → apply AI status.
	 * `onProgress`, when supplied, fires as each stage genuinely begins.
	 */
	saveCurrentTab(
		onProgress?: SaveProgress,
	): Promise<Result<SaveOutcome, AppError>>;
	/** Delete a bookmark by canonical URL using the domain delete operation. */
	deleteBookmark(canonicalUrl: CanonicalUrl): Promise<Result<CacheState, AppError>>;
	/**
	 * Re-run AI analysis for an existing bookmark by canonical URL. `onProgress`,
	 * when supplied, fires as each stage genuinely begins.
	 */
	reAnalyzeBookmark(
		canonicalUrl: CanonicalUrl,
		onProgress?: SaveProgress,
	): Promise<Result<SaveOutcome, AppError>>;
}

type DrivePush = {
	readonly state: CacheState;
	readonly driveSynced: boolean;
	readonly driveError?: AppError;
};

export function createBookmarkApp(deps: AppDeps): BookmarkApp {
	function log(level: LogLevel, event: string, detail?: string): void {
		if (!deps.logger) {
			return;
		}
		const safe =
			detail === undefined
				? undefined
				: (deps.redactor?.redact(detail) ?? detail);
		deps.logger.log(level, event, safe);
	}

	/**
	 * Write `desired` to Drive, then reconcile the cache. On success the cache is
	 * refreshed from the authoritative repository snapshot; on failure the desired
	 * collection is kept locally with a typed sync error so the bookmark is not
	 * lost. `trustMerge: false` keeps `desired` rather than the repository's merged
	 * result — used by deletion, whose union merge would otherwise re-add the
	 * record.
	 */
	async function pushToDrive(
		desired: Bookmarks,
		opts: { trustMerge: boolean; prevLocation?: DriveLocation },
	): Promise<DrivePush> {
		const result = await deps.repository.save(desired);
		if (result.ok) {
			const snapshot = result.value;
			const state: CacheState = {
				bookmarks: opts.trustMerge ? snapshot.bookmarks : desired,
				location: { folder: snapshot.folder, file: snapshot.file },
				sync: { status: "synced", lastSyncedAt: deps.clock.now() },
			};
			await deps.cache.save(state);
			return { state, driveSynced: true };
		}

		const state: CacheState = {
			bookmarks: desired,
			location: opts.prevLocation,
			sync: { status: "error", error: toSyncError(result.error) },
		};
		await deps.cache.save(state);
		log("warn", "drive-save-failed", `${result.error.kind}: ${result.error.message}`);
		return {
			state,
			driveSynced: false,
			driveError: fromRepositoryError(result.error),
		};
	}

	/**
	 * The shared tail of save and re-analyze: extract the page, build an excerpt,
	 * ask the analyzer, and apply the resulting status to the record through the
	 * domain. Extraction failure keeps the bookmark and marks it `failed` (so it
	 * can be re-analyzed), it is not a hard error.
	 */
	async function applyAnalysis(
		bookmarks: Bookmarks,
		canonicalUrl: CanonicalUrl,
		target: ExtractionTarget,
		now: ReturnType<AppDeps["clock"]["now"]>,
		onProgress?: SaveProgress,
	): Promise<Result<Bookmarks, CollectionError>> {
		onProgress?.("extracting");
		const extraction = await deps.extractor.extract(target);
		if (!extraction.ok) {
			return bookmarks.markAiFailed(
				canonicalUrl,
				`extraction failed: ${extraction.error.message}`,
				now,
			);
		}

		const excerpt = buildExcerpt(extraction.value);
		onProgress?.("analyzing");
		const outcome = await deps.analyzer.analyze({
			title: target.title,
			url: target.url,
			excerpt: excerpt.text,
		});

		if (outcome.status === "ready") {
			const analysis: AiAnalysis = {
				description: outcome.analysis.description,
				genre: outcome.analysis.genre,
				tags: [...outcome.analysis.tags],
			};
			return bookmarks.applyAiAnalysis(canonicalUrl, analysis, now);
		}
		if (outcome.status === "unavailable") {
			return bookmarks.markAiUnavailable(canonicalUrl, now);
		}
		return bookmarks.markAiFailed(canonicalUrl, outcome.error.message, now);
	}

	async function analyzeAndApply(
		base: CacheState,
		canonicalUrl: CanonicalUrl,
		target: ExtractionTarget,
		onProgress?: SaveProgress,
	): Promise<Result<SaveOutcome, AppError>> {
		const now = deps.clock.now();
		const updated = await applyAnalysis(
			base.bookmarks,
			canonicalUrl,
			target,
			now,
			onProgress,
		);
		if (!updated.ok) {
			return err(fromCollectionError(updated.error));
		}

		onProgress?.("syncing");
		const push = await pushToDrive(updated.value, {
			trustMerge: true,
			prevLocation: base.location,
		});
		const record = push.state.bookmarks.get(canonicalUrl);
		if (!record) {
			// The record we just applied must be present; its absence is a defect.
			return err(appError("invalid-bookmark", "record missing after analysis save"));
		}
		return ok({
			record,
			aiStatus: record.aiStatus,
			driveSynced: push.driveSynced,
			driveError: push.driveSynced ? undefined : push.driveError,
		});
	}

	return {
		async loadCachedState(): Promise<CacheState> {
			return deps.cache.load();
		},

		async syncFromDrive(): Promise<Result<CacheState, AppError>> {
			const result = await deps.repository.load();
			if (!result.ok) {
				const cached = await deps.cache.load();
				const state: CacheState = {
					bookmarks: cached.bookmarks,
					location: cached.location,
					sync: { status: "error", error: toSyncError(result.error) },
				};
				await deps.cache.save(state);
				log("warn", "drive-sync-failed", `${result.error.kind}: ${result.error.message}`);
				return err(fromRepositoryError(result.error));
			}

			const snapshot = result.value;
			const state: CacheState = {
				bookmarks: snapshot.bookmarks,
				location: { folder: snapshot.folder, file: snapshot.file },
				sync: { status: "synced", lastSyncedAt: deps.clock.now() },
			};
			await deps.cache.save(state);
			log("info", "drive-synced", `${snapshot.bookmarks.size} bookmarks`);
			return ok(state);
		},

		async saveCurrentTab(
			onProgress?: SaveProgress,
		): Promise<Result<SaveOutcome, AppError>> {
			const tabResult = await deps.tabs.activeTab();
			if (!tabResult.ok) {
				return tabResult;
			}
			const tab = tabResult.value;

			const canonical = canonicalizeUrl(tab.url);
			if (!canonical.ok) {
				return err(
					appError(
						"invalid-tab",
						`active tab URL is not bookmarkable: ${canonical.error.message}`,
						{ detail: canonical.error.field },
					),
				);
			}
			const canonicalUrl = canonical.value;

			const cached = await deps.cache.load();
			const now = deps.clock.now();

			// 1. Create/update the pending record through the domain first.
			const pending = cached.bookmarks.upsert(
				{ url: tab.url, title: tab.title, aiStatus: "pending" },
				{ id: deps.ids.next(), now },
			);
			if (!pending.ok) {
				return err(fromCollectionError(pending.error));
			}

			// 2. Persist/cache the pending record before slow extraction/analysis so a
			//    closed popup still leaves a durable pending bookmark.
			onProgress?.("saving");
			await deps.cache.save({
				bookmarks: pending.value,
				location: cached.location,
				sync: { status: "syncing", lastSyncedAt: cached.sync.lastSyncedAt },
			});
			const pendingPush = await pushToDrive(pending.value, {
				trustMerge: true,
				prevLocation: cached.location,
			});

			// 3. Extract → analyze → apply the resulting AI status.
			return analyzeAndApply(
				pendingPush.state,
				canonicalUrl,
				{ url: tab.url, title: tab.title, tabId: tab.id },
				onProgress,
			);
		},

		async deleteBookmark(
			canonicalUrl: CanonicalUrl,
		): Promise<Result<CacheState, AppError>> {
			const cached = await deps.cache.load();
			// Domain delete (idempotent), not a UI-side array mutation.
			const reduced = cached.bookmarks.delete(canonicalUrl);
			const push = await pushToDrive(reduced, {
				trustMerge: false,
				prevLocation: cached.location,
			});
			return ok(push.state);
		},

		async reAnalyzeBookmark(
			canonicalUrl: CanonicalUrl,
			onProgress?: SaveProgress,
		): Promise<Result<SaveOutcome, AppError>> {
			const cached = await deps.cache.load();
			const record = cached.bookmarks.get(canonicalUrl);
			if (!record) {
				return err(appError("not-found", "no cached bookmark for that URL"));
			}

			const now = deps.clock.now();
			// Move the record back to pending through the domain before re-running AI.
			const pending = cached.bookmarks.markAiPending(canonicalUrl, now);
			if (!pending.ok) {
				return err(fromCollectionError(pending.error));
			}
			onProgress?.("saving");
			await deps.cache.save({
				bookmarks: pending.value,
				location: cached.location,
				sync: { status: "syncing", lastSyncedAt: cached.sync.lastSyncedAt },
			});
			const pendingPush = await pushToDrive(pending.value, {
				trustMerge: true,
				prevLocation: cached.location,
			});

			return analyzeAndApply(
				pendingPush.state,
				canonicalUrl,
				{ url: record.url, title: record.title },
				onProgress,
			);
		},
	};
}
