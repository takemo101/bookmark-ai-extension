/**
 * The options page view-model boundary: the single port the options controller
 * depends on, plus the adapter that satisfies it from the `app/*` use cases.
 *
 * This is the seam the issue asks for. The React component and the controller
 * (`./view-model`) talk only to {@link OptionsUseCases}; they never import a
 * Drive client, the Prompt API client, the JSONL parser, or merge internals.
 * Tests pass a fake {@link OptionsUseCases}; the real runtime passes the adapter
 * built by {@link createOptionsUseCases} (wired in `./runtime`).
 *
 * Every method maps 1:1 to a {@link BookmarkApp} use case. Search/filter/sort are
 * deliberately *not* methods here — they are pure, synchronous reads over the
 * already-loaded {@link Bookmarks} collection, so the controller delegates to the
 * collection's own operations (First-class bookmark collection) rather than
 * round-tripping through an async port.
 */
import type { BookmarkApp, SaveOutcome } from "../lib/app/index";
import type { AppError, Result } from "../lib/app/index";
import type { CacheState } from "../lib/storage/index";
import type { CanonicalUrl } from "../lib/bookmarks/index";

export type { SaveOutcome } from "../lib/app/index";
export type { AppError, Result } from "../lib/app/index";
export type { CacheState } from "../lib/storage/index";
export type { CanonicalUrl } from "../lib/bookmarks/index";

/**
 * The only surface the options controller is allowed to touch. None of these
 * methods leak a Drive, Prompt API, JSONL, or merge type. A fake implementing
 * this interface is all a controller test needs.
 */
export interface OptionsUseCases {
	/** Render-fast read of the last cached state (full list + sync badge). */
	loadCachedState(): Promise<CacheState>;
	/** Pull the authoritative store from Drive and refresh the cache. */
	syncFromDrive(): Promise<Result<CacheState, AppError>>;
	/** Delete a bookmark by canonical URL through the domain delete operation. */
	deleteBookmark(
		canonicalUrl: CanonicalUrl,
	): Promise<Result<CacheState, AppError>>;
	/** Re-run AI analysis for an existing bookmark by canonical URL. */
	reAnalyzeBookmark(
		canonicalUrl: CanonicalUrl,
	): Promise<Result<SaveOutcome, AppError>>;
}

/**
 * Adapt the `app/*` {@link BookmarkApp} into the {@link OptionsUseCases} the
 * controller consumes. A direct, type-narrowing pass-through: the options layer
 * needs exactly the load/sync/delete/re-analyze use cases the app already
 * exposes, nothing more.
 */
export function createOptionsUseCases(app: BookmarkApp): OptionsUseCases {
	return {
		loadCachedState() {
			return app.loadCachedState();
		},
		syncFromDrive() {
			return app.syncFromDrive();
		},
		deleteBookmark(canonicalUrl) {
			return app.deleteBookmark(canonicalUrl);
		},
		reAnalyzeBookmark(canonicalUrl) {
			return app.reAnalyzeBookmark(canonicalUrl);
		},
	};
}
