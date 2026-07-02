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
 * ## Durable deletion
 *
 * `deleteBookmark` records a deletion tombstone through the domain
 * (`Bookmarks.delete`) and pushes it like any other change. The Drive
 * repository's revision-conflict merge (`Bookmarks.mergeRemote`) carries
 * tombstones, so the deletion is written to Drive and is not resurrected by a
 * later `syncFromDrive` or by another device, unless that device holds a
 * strictly newer explicit update for the same URL (the documented delete-vs-
 * update rule; docs/design.md "Drive Write and Conflict Strategy").
 *
 * ## Unsynced local mutations
 *
 * When a Drive write fails, the desired collection is kept in the cache and the
 * sync state is flagged `pending` (a save/update/re-analyze, or a deletion
 * tombstone, that never reached Drive). `syncFromDrive` checks that flag first:
 * with pending changes it re-pushes the cached collection (letting the domain
 * merge reconcile it with Drive) rather than replacing the cache with the remote
 * state, so an offline mutation is never silently discarded and is eventually
 * pushed once Drive recovers (MIK-014).
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
import {
	type ExtractedPage,
	type ExtractionError,
	type Result as ExtractionResult,
	buildExcerpt,
} from "../extraction/index";
import type { CacheState } from "../storage/index";
import {
	type AppError,
	appError,
	fromCollectionError,
	fromExtractionError,
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
	deleteBookmark(
		canonicalUrl: CanonicalUrl,
	): Promise<Result<CacheState, AppError>>;
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
	 * refreshed from the authoritative repository snapshot (the domain merge of
	 * `desired` with Drive, tombstones included); on failure the desired
	 * collection is kept locally with a typed sync error so the change is not
	 * lost.
	 */
	async function pushToDrive(
		desired: Bookmarks,
		opts: { prevLocation?: DriveLocation },
	): Promise<DrivePush> {
		const result = await deps.repository.save(desired);
		if (result.ok) {
			const snapshot = result.value;
			const state: CacheState = {
				bookmarks: snapshot.bookmarks,
				location: { folder: snapshot.folder, file: snapshot.file },
				sync: { status: "synced", lastSyncedAt: deps.clock.now() },
			};
			await deps.cache.save(state);
			return { state, driveSynced: true };
		}

		const state: CacheState = {
			bookmarks: desired,
			location: opts.prevLocation,
			// The change reached only the cache: mark it pending so a later
			// `syncFromDrive` preserves and re-pushes it instead of replacing it
			// with the remote state (MIK-014; docs/design.md "Local Cache").
			sync: {
				status: "error",
				error: toSyncError(result.error),
				pending: true,
			},
		};
		await deps.cache.save(state);
		log(
			"warn",
			"drive-save-failed",
			`${result.error.kind}: ${result.error.message}`,
		);
		return {
			state,
			driveSynced: false,
			driveError: fromRepositoryError(result.error),
		};
	}

	/**
	 * The analysis tail once a page has been extracted: build the excerpt, ask the
	 * analyzer, and apply the resulting status to the record through the domain.
	 */
	async function analyzeExtractedPage(
		bookmarks: Bookmarks,
		canonicalUrl: CanonicalUrl,
		target: ExtractionTarget,
		page: ExtractedPage,
		now: ReturnType<AppDeps["clock"]["now"]>,
		onProgress?: SaveProgress,
	): Promise<Result<Bookmarks, CollectionError>> {
		const excerpt = buildExcerpt(page);
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
				analysisMarkdown: outcome.analysis.analysisMarkdown,
				analysisProfileId: outcome.profileId,
			};
			return bookmarks.applyAiAnalysis(canonicalUrl, analysis, now);
		}
		if (outcome.status === "unavailable") {
			return bookmarks.markAiUnavailable(canonicalUrl, now);
		}
		return bookmarks.markAiFailed(canonicalUrl, outcome.error.message, now);
	}

	/**
	 * The shared tail of save and re-analyze once extraction has run: apply the
	 * extracted page's analysis, then sync to Drive. A failed extraction *after a
	 * valid target* keeps the bookmark and marks it `failed` so it can be retried;
	 * it is recoverable, not a hard error. (Re-analyze handles the separate
	 * activeTab precondition — a `tab` extraction error — before reaching here, so
	 * that case never mutates the record.)
	 */
	async function finishAnalysis(
		base: CacheState,
		canonicalUrl: CanonicalUrl,
		target: ExtractionTarget,
		extraction: ExtractionResult<ExtractedPage, ExtractionError>,
		onProgress?: SaveProgress,
	): Promise<Result<SaveOutcome, AppError>> {
		const now = deps.clock.now();
		const updated = extraction.ok
			? await analyzeExtractedPage(
					base.bookmarks,
					canonicalUrl,
					target,
					extraction.value,
					now,
					onProgress,
				)
			: base.bookmarks.markAiFailed(
					canonicalUrl,
					`extraction failed: ${extraction.error.message}`,
					now,
				);
		if (!updated.ok) {
			return err(fromCollectionError(updated.error));
		}

		onProgress?.("syncing");
		const push = await pushToDrive(updated.value, {
			prevLocation: base.location,
		});
		const record = push.state.bookmarks.get(canonicalUrl);
		if (!record) {
			// The record we just applied must be present; its absence is a defect.
			return err(
				appError("invalid-bookmark", "record missing after analysis save"),
			);
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
			const cached = await deps.cache.load();

			// Unsynced local mutations (a failed save/update/re-analyze or a deletion
			// tombstone) live in the cache with `pending` set. Treating Drive as
			// authoritative here would silently discard them, so instead push the
			// cached collection: the repository delegates the reconciliation to the
			// domain merge (`Bookmarks.mergeRemote`, tombstones included), which makes
			// the mutation durable on Drive while still honoring newer remote changes
			// (docs/design.md "Drive Write and Conflict Strategy"). If Drive is still
			// unavailable the mutation is kept locally and stays pending for the next
			// attempt, so it survives this sync rather than being lost (MIK-014).
			if (cached.sync.pending) {
				const push = await pushToDrive(cached.bookmarks, {
					prevLocation: cached.location,
				});
				if (push.driveSynced) {
					log(
						"info",
						"drive-pending-pushed",
						`${push.state.bookmarks.size} bookmarks`,
					);
					return ok(push.state);
				}
				log(
					"warn",
					"drive-pending-push-failed",
					push.driveError
						? `${push.driveError.detail ?? push.driveError.kind}: ${push.driveError.message}`
						: "pending push failed",
				);
				return err(
					push.driveError ??
						appError("drive", "pending local changes could not be pushed"),
				);
			}

			const result = await deps.repository.load();
			if (!result.ok) {
				const state: CacheState = {
					bookmarks: cached.bookmarks,
					location: cached.location,
					sync: { status: "error", error: toSyncError(result.error) },
				};
				await deps.cache.save(state);
				log(
					"warn",
					"drive-sync-failed",
					`${result.error.kind}: ${result.error.message}`,
				);
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
				// The pending record is cached before the (slow) Drive write begins, so
				// it is an unsynced local mutation until that write lands; mark it
				// pending so a sync racing a closed popup re-pushes it (MIK-014).
				sync: {
					status: "syncing",
					lastSyncedAt: cached.sync.lastSyncedAt,
					pending: true,
				},
			});
			const pendingPush = await pushToDrive(pending.value, {
				prevLocation: cached.location,
			});

			// 3. Extract → analyze → apply the resulting AI status. The active tab's
			//    `tabId` targets injection at exactly the user-chosen tab, so the
			//    save path never hits the re-analyze activeTab precondition.
			onProgress?.("extracting");
			const extraction = await deps.extractor.extract({
				url: tab.url,
				title: tab.title,
				tabId: tab.id,
			});
			return finishAnalysis(
				pendingPush.state,
				canonicalUrl,
				{ url: tab.url, title: tab.title },
				extraction,
				onProgress,
			);
		},

		async deleteBookmark(
			canonicalUrl: CanonicalUrl,
		): Promise<Result<CacheState, AppError>> {
			const cached = await deps.cache.load();
			// Domain delete leaves a tombstone stamped `now` (idempotent), not a
			// UI-side array mutation. The tombstone propagates through the repository
			// merge so the deletion is durable across syncs and devices.
			const reduced = cached.bookmarks.delete(canonicalUrl, deps.clock.now());
			const push = await pushToDrive(reduced, {
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

			onProgress?.("saving");
			// Re-analyze can only re-extract a page through `activeTab` + `scripting`,
			// i.e. when the page is the active tab in the current window. Probe the
			// extraction *before* any mutation: when the page is not the active tab the
			// runtime extractor returns a typed `tab` error (it never reaches for an
			// arbitrary tab), which we surface as a safe action error and leave the
			// existing bookmark untouched — no `pending` flip, no Drive write
			// (docs/design.md "Options page: Research Ledger"; docs/smoke-checklist.md).
			// A real extraction failure after a valid target is *not* caught here: it
			// falls through and is recorded as a recoverable `failed` status below.
			onProgress?.("extracting");
			const extraction = await deps.extractor.extract({
				url: record.url,
				title: record.title,
			});
			if (!extraction.ok && extraction.error.field === "tab") {
				return err(fromExtractionError(extraction.error));
			}

			const now = deps.clock.now();
			// Move the record back to pending through the domain before re-running AI.
			const pending = cached.bookmarks.markAiPending(canonicalUrl, now);
			if (!pending.ok) {
				return err(fromCollectionError(pending.error));
			}
			await deps.cache.save({
				bookmarks: pending.value,
				location: cached.location,
				// Re-analyze moves the record back to pending in the cache before the
				// Drive write; mark it pending so the transition is preserved if a sync
				// races a closed popup (MIK-014).
				sync: {
					status: "syncing",
					lastSyncedAt: cached.sync.lastSyncedAt,
					pending: true,
				},
			});
			const pendingPush = await pushToDrive(pending.value, {
				prevLocation: cached.location,
			});

			return finishAnalysis(
				pendingPush.state,
				canonicalUrl,
				{ url: record.url, title: record.title },
				extraction,
				onProgress,
			);
		},
	};
}
