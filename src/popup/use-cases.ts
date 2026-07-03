/**
 * The popup's view-model boundary: the single port the popup controller depends
 * on, plus the adapter that satisfies it from the `app/*` use cases.
 *
 * This is the seam the issue asks for. The React component and the controller
 * (`./view-model`) talk only to {@link PopupUseCases}; they never import a Drive
 * client, the Prompt API client, the JSONL parser, or merge internals. Tests
 * pass a fake {@link PopupUseCases}; the real runtime passes the adapter built by
 * {@link createPopupUseCases} (wired in `./runtime`).
 *
 * Two concerns the bare `BookmarkApp` does not yet expose are added here as small
 * extra ports so the popup can render the receipt before/while saving:
 *   - the current tab title/URL to show as the receipt header;
 *   - the Google connection state and Prompt API availability badges;
 *   - a coarse {@link SaveProgress} stream so the progress trail can advance.
 * The genuinely Chrome-bound side of these (active-tab/identity/availability
 * probing) is provided by an injected {@link PopupEnvironmentProvider}; real
 * granular per-stage save events arrive with the runtime wiring in MIK-009.
 */
import type {
	AppError,
	BookmarkApp,
	Result,
	SaveOutcome,
} from "../lib/app/index";
import type { CanonicalUrl } from "../lib/bookmarks/index";
import type { CacheState } from "../lib/storage/index";

export type { AppError, Result, SaveOutcome } from "../lib/app/index";
export type { CanonicalUrl } from "../lib/bookmarks/index";
// The controller canonicalizes the active tab's URL to detect an
// already-bookmarked page with the exact same dedup key save/upsert uses
// (docs/design.md "Duplicate Behavior"). Re-exported here so `view-model`
// keeps importing only from this boundary module.
export { canonicalizeUrl } from "../lib/bookmarks/index";
export type { CacheState } from "../lib/storage/index";

/** The current tab shown at the top of the receipt. */
export type TabInfo = {
	readonly title: string;
	readonly url: string;
};

/** Google connection state shown as a badge. `unknown` until probed/wired. */
export type ConnectionStatus = "connected" | "disconnected" | "unknown";

/** Prompt API availability, mirrored from the `ai/*` normalized availability. */
export type PromptApiStatus =
	| "available"
	| "downloadable"
	| "downloading"
	| "unavailable"
	| "unknown";

/** The non-save environment the popup renders: connection + Prompt API badges. */
export type PopupEnvironment = {
	readonly connection: ConnectionStatus;
	readonly promptApi: PromptApiStatus;
};

/**
 * One step of the documented Save Flow (docs/design.md "Save Flow"):
 *   - `saving`     → the pending record was written to Drive/cache;
 *   - `extracting` → the page excerpt was extracted;
 *   - `analyzing`  → the Prompt API is analyzing;
 *   - `syncing`    → the final record is being synced to Drive.
 */
export type SaveStage = "saving" | "extracting" | "analyzing" | "syncing";

/** A coarse progress event emitted while a save/re-analyze flow runs. */
export type SaveProgress = { readonly stage: SaveStage };

/** Observer the controller passes so the trail can advance as stages start. */
export type ProgressObserver = (progress: SaveProgress) => void;

/**
 * The only surface the popup controller is allowed to touch. Every method maps
 * to an `app/*` use case (or a small popup-specific probe); none of them leak a
 * Drive, Prompt API, JSONL, or merge type. A fake implementing this interface is
 * all a controller test needs.
 */
export interface PopupUseCases {
	/** The active tab to show in the receipt header. */
	currentTab(): Promise<Result<TabInfo, AppError>>;
	/** Connection + Prompt API badges. Never throws; returns `unknown` when unsure. */
	environment(): Promise<PopupEnvironment>;
	/** Render-fast read of the last cached state (recent bookmarks, sync badge). */
	loadCachedState(): Promise<CacheState>;
	/** Pull the authoritative store from Drive and refresh the cache. */
	syncFromDrive(): Promise<Result<CacheState, AppError>>;
	/** Save the active tab; `onProgress` advances the trail as stages start. */
	saveCurrentTab(
		onProgress?: ProgressObserver,
	): Promise<Result<SaveOutcome, AppError>>;
	/** Re-run AI analysis for an existing bookmark by canonical URL. */
	reAnalyzeBookmark(
		canonicalUrl: CanonicalUrl,
		onProgress?: ProgressObserver,
	): Promise<Result<SaveOutcome, AppError>>;
	/** Delete a bookmark (the current page's) by canonical URL via the domain tombstone delete. */
	deleteBookmark(
		canonicalUrl: CanonicalUrl,
	): Promise<Result<CacheState, AppError>>;
}

/**
 * The Chrome-bound probes the adapter needs but `BookmarkApp` does not own:
 * resolving the active tab for display and reading the connection/availability
 * badges. Implemented for real in `./runtime`; a fake supplies them in tests.
 */
export interface PopupEnvironmentProvider {
	currentTab(): Promise<Result<TabInfo, AppError>>;
	environment(): Promise<PopupEnvironment>;
}

/**
 * Adapt the `app/*` {@link BookmarkApp} (plus a {@link PopupEnvironmentProvider})
 * into the {@link PopupUseCases} the controller consumes.
 *
 * The app's `saveCurrentTab` / `reAnalyzeBookmark` accept a progress reporter and
 * fire it as each stage genuinely begins (saving → extracting → analyzing →
 * syncing), so this adapter forwards those real events to the controller's
 * {@link ProgressObserver} rather than fabricating a coarse sequence. The app's
 * {@link SaveStage} string union is identical to the popup's, so the mapping is a
 * direct relay. The controller finalizes the trail from the returned
 * {@link SaveOutcome}.
 */
export function createPopupUseCases(
	app: BookmarkApp,
	env: PopupEnvironmentProvider,
): PopupUseCases {
	function relay(
		onProgress: ProgressObserver | undefined,
	): ((stage: SaveStage) => void) | undefined {
		if (!onProgress) {
			return undefined;
		}
		return (stage) => onProgress({ stage });
	}

	return {
		currentTab() {
			return env.currentTab();
		},
		environment() {
			return env.environment();
		},
		loadCachedState() {
			return app.loadCachedState();
		},
		syncFromDrive() {
			return app.syncFromDrive();
		},
		async saveCurrentTab(onProgress) {
			return app.saveCurrentTab(relay(onProgress));
		},
		async reAnalyzeBookmark(canonicalUrl, onProgress) {
			return app.reAnalyzeBookmark(canonicalUrl, relay(onProgress));
		},
		async deleteBookmark(canonicalUrl) {
			return app.deleteBookmark(canonicalUrl);
		},
	};
}
