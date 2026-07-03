/**
 * The popup controller: a small, framework-agnostic state machine that turns the
 * {@link PopupUseCases} boundary into an immutable {@link PopupView} the React
 * component renders. It owns every decision the "Bookmark Receipt" popup makes —
 * which trail step is active, when a bookmark counts as saved, how to phrase a
 * safe error — so the React layer stays a pure projection of `getView()` and
 * imports no Drive/AI/JSONL/merge internals (docs/implementation-principles.md
 * "Tell, don't ask"; AGENTS.md "Architecture boundaries").
 *
 * The controller is observable via {@link PopupController.subscribe} /
 * {@link PopupController.getView} so React can bind it with `useSyncExternalStore`.
 * It is fully testable on its own: drive it with a fake `PopupUseCases` and read
 * `getView()` across states — no DOM, Chrome, Drive, or Prompt API required.
 */
import {
	type CacheState,
	type CanonicalUrl,
	canonicalizeUrl,
	type PopupEnvironment,
	type PopupUseCases,
	type ProgressObserver,
	resolveAnalysisProfileDisplay,
	type SaveOutcome,
	type SaveStage,
} from "./use-cases";
import type { AiStatus, BookmarkRecord, SyncStatus } from "./view-types";

export type {
	ConnectionStatus,
	PromptApiStatus,
} from "./use-cases";

/** The ordered stages of the receipt trail (documented Save Flow). */
const STAGE_ORDER: readonly SaveStage[] = [
	"saving",
	"extracting",
	"analyzing",
	"syncing",
];

const STAGE_LABEL: Record<SaveStage, string> = {
	saving: "Pending bookmark saved",
	extracting: "Page excerpt extracted",
	analyzing: "AI analyzing",
	syncing: "Synced to Drive",
};

export type TrailStageStatus =
	| "pending"
	| "active"
	| "done"
	| "failed"
	| "skipped";

export type TrailStage = {
	readonly key: SaveStage;
	readonly label: string;
	readonly status: TrailStageStatus;
};

/** A single recent bookmark row, mapped to safe display primitives. */
export type RecentItemView = {
	readonly canonicalUrl: string;
	readonly title: string;
	readonly url: string;
	readonly description?: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly aiStatus: AiStatus;
	readonly updatedAt: string;
	/** Whether a "Re-analyze" affordance should show (status is not `ready`). */
	readonly canReAnalyze: boolean;
};

/**
 * The compact detail view a Recent row opens (MIK-028): display-safe fields
 * from the cached record, including the long-form `analysisMarkdown` rendered
 * through the safe Markdown component. A reading surface only — the full
 * ledger, delete, and filters stay in Options.
 */
export type PopupDetailView = {
	readonly canonicalUrl: string;
	readonly title: string;
	readonly url: string;
	readonly description?: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly aiStatus: AiStatus;
	/** Safe, token-free message when the last analysis failed. */
	readonly aiError?: string;
	readonly updatedAt: string;
	readonly analysisMarkdown?: string;
	readonly analysisProfileId?: string;
	/**
	 * Readable name for `analysisProfileId` (MIK-031): built-in profile names
	 * resolve in the popup; custom/unknown ids fall back to the raw id — the
	 * popup has no settings data at this boundary and stays a reading surface
	 * (custom-name resolution and edit navigation live in Options).
	 */
	readonly analysisProfileName?: string;
};

/** The Japanese AI preview shown on a `ready` receipt. */
export type AiPreview = {
	readonly description?: string;
	readonly genre?: string;
	readonly tags: readonly string[];
};

/** The saved record, as the receipt body renders it after a flow resolves. */
export type SaveReceiptView = {
	readonly title: string;
	readonly url: string;
	readonly canonicalUrl: string;
	readonly aiStatus: AiStatus;
	readonly preview: AiPreview;
	readonly aiError?: string;
	readonly driveSynced: boolean;
	/** Present when the AI ran but the Drive write failed; safe, token-free. */
	readonly driveWarning?: string;
};

/** The flow region of the receipt: idle, running a trail, done, or errored. */
export type FlowView =
	| { readonly kind: "idle" }
	| { readonly kind: "running"; readonly trail: readonly TrailStage[] }
	| {
			readonly kind: "done";
			readonly trail: readonly TrailStage[];
			readonly receipt: SaveReceiptView;
	  }
	| {
			readonly kind: "error";
			readonly trail: readonly TrailStage[];
			readonly message: string;
	  };

/**
 * The current page's bookmark, when the active tab's canonical URL already
 * exists in the cached collection. Display-safe fields only — the same dedup
 * key as save/upsert, so "already bookmarked" always matches what a duplicate
 * save would update (docs/design.md "Duplicate Behavior").
 */
export type CurrentBookmarkView = {
	readonly canonicalUrl: string;
	readonly title: string;
	readonly url: string;
	readonly description?: string;
	readonly aiStatus: AiStatus;
	readonly updatedAt: string;
};

export type SyncView = {
	readonly status: SyncStatus;
	readonly lastSyncedAt?: string;
	readonly error?: string;
	/**
	 * Whether the cache holds local changes not yet confirmed on Drive (a failed
	 * or in-flight save/update/delete). A token-free boolean the receipt surfaces
	 * so the user knows a retry is still owed (MIK-014).
	 */
	readonly pendingLocalChanges: boolean;
};

/** The complete immutable snapshot the React component renders. */
export type PopupView = {
	readonly loading: boolean;
	readonly tab?: TabInfoView;
	readonly connection: PopupEnvironment["connection"];
	readonly promptApi: PopupEnvironment["promptApi"];
	readonly sync: SyncView;
	readonly flow: FlowView;
	readonly recent: readonly RecentItemView[];
	readonly canSave: boolean;
	/** Present when the active tab is already bookmarked (canonical-URL match). */
	readonly currentBookmark?: CurrentBookmarkView;
	/** Present while a Recent bookmark's compact detail is open (MIK-028). */
	readonly selectedRecent?: PopupDetailView;
	/** Whether a delete of the current page's bookmark is in flight. */
	readonly deleting: boolean;
	/** Safe, token-free message when the last delete failed. */
	readonly deleteError?: string;
};

export type TabInfoView = { readonly title: string; readonly url: string };

export interface PopupController {
	getView(): PopupView;
	subscribe(listener: () => void): () => void;
	/** Load environment, current tab, and cached recents. Safe to call once on mount. */
	init(): Promise<void>;
	/** Save the current tab and walk the trail to a receipt. */
	save(): Promise<void>;
	/** Re-analyze a recent bookmark by its (display) canonical URL. */
	reAnalyze(canonicalUrl: string): Promise<void>;
	/** Open the compact detail for a recent bookmark (no-op for unknown URLs). */
	selectRecent(canonicalUrl: string): void;
	/** Close the recent detail view, returning to the receipt. */
	clearRecentSelection(): void;
	/** Delete the current page's bookmark (no-op unless one exists and no flow runs). */
	deleteCurrentBookmark(): Promise<void>;
	/** Pull the authoritative store from Drive and refresh recents/sync badge. */
	refresh(): Promise<void>;
}

const MAX_RECENT = 6;

const INITIAL_VIEW: PopupView = {
	loading: true,
	connection: "unknown",
	promptApi: "unknown",
	sync: { status: "idle", pendingLocalChanges: false },
	flow: { kind: "idle" },
	recent: [],
	canSave: false,
	deleting: false,
};

export function createPopupController(
	useCases: PopupUseCases,
): PopupController {
	let view: PopupView = INITIAL_VIEW;
	const listeners = new Set<() => void>();
	// Display canonical URLs map back to their branded value so re-analyze never
	// re-parses or casts a raw string (parse, don't validate).
	let canonicalByDisplay = new Map<string, CanonicalUrl>();
	// The active tab's canonical URL — the same dedup key save/upsert uses — so
	// "already bookmarked" and delete target exactly what a duplicate save would
	// update. Undefined when the tab is missing or its URL is not bookmarkable.
	let tabCanonical: CanonicalUrl | undefined;
	// The last cache snapshot, kept so selectRecent can read the full record
	// without another async load (MIK-028).
	let lastState: CacheState | undefined;
	// The open recent detail's display canonical URL; re-resolved against every
	// cache refresh so the detail updates in place or closes when the record is
	// gone (deleted, or pushed out of the recent slice).
	let selectedRecentDisplay: string | undefined;

	function setView(next: Partial<PopupView>): void {
		view = { ...view, ...next };
		for (const listener of listeners) {
			listener();
		}
	}

	function mapRecent(state: CacheState): RecentItemView[] {
		const next = new Map<string, CanonicalUrl>();
		const items = state.bookmarks
			.toArray()
			.slice(0, MAX_RECENT)
			.map((record): RecentItemView => {
				next.set(record.canonicalUrl, record.canonicalUrl);
				return toRecentItem(record);
			});
		canonicalByDisplay = next;
		return items;
	}

	function mapCurrentBookmark(
		state: CacheState,
	): CurrentBookmarkView | undefined {
		if (!tabCanonical) {
			return undefined;
		}
		const record = state.bookmarks.get(tabCanonical);
		if (!record) {
			return undefined;
		}
		return {
			canonicalUrl: record.canonicalUrl,
			title: record.title,
			url: record.url,
			description: record.description,
			aiStatus: record.aiStatus,
			updatedAt: record.updatedAt,
		};
	}

	function mapSelectedRecent(state: CacheState): PopupDetailView | undefined {
		if (selectedRecentDisplay === undefined) {
			return undefined;
		}
		// `canonicalByDisplay` was just rebuilt by mapRecent, so a record that was
		// deleted or fell out of the recent slice no longer resolves and the
		// detail closes instead of showing stale data.
		const branded = canonicalByDisplay.get(selectedRecentDisplay);
		const record = branded ? state.bookmarks.get(branded) : undefined;
		if (!record) {
			selectedRecentDisplay = undefined;
			return undefined;
		}
		return toRecentDetail(record);
	}

	/** The recent/sync/current-page projections that any cache refresh updates together. */
	function mapState(state: CacheState): Partial<PopupView> {
		lastState = state;
		// Order matters: mapRecent rebuilds canonicalByDisplay, which
		// mapSelectedRecent then resolves the open detail against.
		const recent = mapRecent(state);
		return {
			recent,
			sync: mapSync(state),
			currentBookmark: mapCurrentBookmark(state),
			selectedRecent: mapSelectedRecent(state),
		};
	}

	function mapSync(state: CacheState): SyncView {
		return {
			status: state.sync.status,
			lastSyncedAt: state.sync.lastSyncedAt,
			error: state.sync.error?.message,
			pendingLocalChanges: state.sync.pending === true,
		};
	}

	function runningTrail(active: SaveStage): TrailStage[] {
		const activeIndex = STAGE_ORDER.indexOf(active);
		return STAGE_ORDER.map((key, index) => ({
			key,
			label: STAGE_LABEL[key],
			status:
				index < activeIndex
					? "done"
					: index === activeIndex
						? "active"
						: "pending",
		}));
	}

	async function runFlow(
		invoke: (
			onProgress: ProgressObserver,
		) => Promise<Awaited<ReturnType<PopupUseCases["saveCurrentTab"]>>>,
	): Promise<void> {
		setView({
			flow: { kind: "running", trail: runningTrail("saving") },
			canSave: false,
			deleteError: undefined,
		});

		const onProgress: ProgressObserver = ({ stage }) => {
			// Only advance while the flow is still running.
			if (view.flow.kind === "running") {
				setView({ flow: { kind: "running", trail: runningTrail(stage) } });
			}
		};

		const result = await invoke(onProgress);
		setView({ flow: finalizeFlow(result), canSave: true });

		// Refresh recents/sync/current-page from cache so the saved bookmark is
		// visible even when AI was unavailable/failed or Drive did not accept the
		// write — and the "Already bookmarked" state appears right after a save.
		const state = await useCases.loadCachedState();
		setView(mapState(state));
	}

	return {
		getView() {
			return view;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async init() {
			const [tab, environment, state] = await Promise.all([
				useCases.currentTab(),
				useCases.environment(),
				useCases.loadCachedState(),
			]);
			// A missing tab or a non-http(s) URL simply yields no canonical key, so
			// `currentBookmark` stays undefined and save behavior is unchanged.
			if (tab.ok) {
				const canonical = canonicalizeUrl(tab.value.url);
				tabCanonical = canonical.ok ? canonical.value : undefined;
			} else {
				tabCanonical = undefined;
			}
			setView({
				loading: false,
				tab: tab.ok
					? { title: tab.value.title, url: tab.value.url }
					: undefined,
				connection: environment.connection,
				promptApi: environment.promptApi,
				...mapState(state),
				canSave: view.flow.kind !== "running",
			});
		},
		async save() {
			if (view.flow.kind === "running") {
				return;
			}
			await runFlow((onProgress) => useCases.saveCurrentTab(onProgress));
		},
		async reAnalyze(canonicalUrl) {
			if (view.flow.kind === "running") {
				return;
			}
			const branded = canonicalByDisplay.get(canonicalUrl);
			if (!branded) {
				return;
			}
			await runFlow((onProgress) =>
				useCases.reAnalyzeBookmark(branded, onProgress),
			);
		},
		selectRecent(canonicalUrl) {
			const branded = canonicalByDisplay.get(canonicalUrl);
			const record = branded ? lastState?.bookmarks.get(branded) : undefined;
			if (!record) {
				return;
			}
			selectedRecentDisplay = canonicalUrl;
			setView({ selectedRecent: toRecentDetail(record) });
		},
		clearRecentSelection() {
			if (selectedRecentDisplay === undefined) {
				return;
			}
			selectedRecentDisplay = undefined;
			setView({ selectedRecent: undefined });
		},
		async deleteCurrentBookmark() {
			// Guard: nothing to delete, or a save/re-analyze/delete already runs —
			// deleting mid-flow could race the flow's own cache writes.
			if (
				view.flow.kind === "running" ||
				view.deleting ||
				!view.currentBookmark ||
				!tabCanonical
			) {
				return;
			}
			setView({ deleting: true, deleteError: undefined });
			const result = await useCases.deleteBookmark(tabCanonical);
			if (result.ok) {
				// The domain tombstone delete already reconciled the cache; a Drive
				// write failure surfaces through the sync badge (`pending`), not here.
				setView({ deleting: false, ...mapState(result.value) });
				return;
			}
			const state = await useCases.loadCachedState();
			setView({
				deleting: false,
				deleteError: safeMessage(result.error.message),
				...mapState(state),
			});
		},
		async refresh() {
			const result = await useCases.syncFromDrive();
			if (result.ok) {
				setView(mapState(result.value));
				return;
			}
			// Keep recents; surface the safe sync error message.
			const state = await useCases.loadCachedState();
			setView(mapState(state));
		},
	};
}

function toRecentDetail(record: BookmarkRecord): PopupDetailView {
	return {
		canonicalUrl: record.canonicalUrl,
		title: record.title,
		url: record.url,
		description: record.description,
		genre: record.genre,
		tags: [...record.tags],
		aiStatus: record.aiStatus,
		aiError: record.aiError ? safeMessage(record.aiError) : undefined,
		updatedAt: record.updatedAt,
		analysisMarkdown: record.analysisMarkdown,
		analysisProfileId: record.analysisProfileId,
		analysisProfileName: record.analysisProfileId
			? resolveAnalysisProfileDisplay(record.analysisProfileId).name
			: undefined,
	};
}

function toRecentItem(record: BookmarkRecord): RecentItemView {
	return {
		canonicalUrl: record.canonicalUrl,
		title: record.title,
		url: record.url,
		description: record.description,
		genre: record.genre,
		tags: [...record.tags],
		aiStatus: record.aiStatus,
		updatedAt: record.updatedAt,
		canReAnalyze: record.aiStatus !== "ready",
	};
}

/** Build a terminal trail keyed by each stage's final status. */
function trailFrom(
	statuses: Record<SaveStage, TrailStageStatus>,
): TrailStage[] {
	return STAGE_ORDER.map((key) => ({
		key,
		label: STAGE_LABEL[key],
		status: statuses[key],
	}));
}

function finalizeFlow(
	result: Awaited<ReturnType<PopupUseCases["saveCurrentTab"]>>,
): FlowView {
	if (!result.ok) {
		// The flow failed before a bookmark could be saved (no tab, bad URL, cache).
		return {
			kind: "error",
			trail: trailFrom({
				saving: "failed",
				extracting: "skipped",
				analyzing: "skipped",
				syncing: "skipped",
			}),
			message: safeMessage(result.error.message),
		};
	}
	return doneFlow(result.value);
}

function doneFlow(outcome: SaveOutcome): FlowView {
	const { record, driveSynced } = outcome;
	const syncing: TrailStageStatus = driveSynced ? "done" : "failed";
	const receiptBase: Omit<SaveReceiptView, "preview"> = {
		title: record.title,
		url: record.url,
		canonicalUrl: record.canonicalUrl,
		aiStatus: record.aiStatus,
		aiError: record.aiError ? safeMessage(record.aiError) : undefined,
		driveSynced,
		driveWarning: driveSynced
			? undefined
			: safeMessage(outcome.driveError?.message ?? "Drive sync failed"),
	};
	const preview: AiPreview = {
		description: record.description,
		genre: record.genre,
		tags: [...record.tags],
	};

	if (record.aiStatus === "ready") {
		return {
			kind: "done",
			trail: trailFrom({
				saving: "done",
				extracting: "done",
				analyzing: "done",
				syncing,
			}),
			receipt: { ...receiptBase, preview },
		};
	}

	if (record.aiStatus === "unavailable") {
		return {
			kind: "done",
			trail: trailFrom({
				saving: "done",
				extracting: "done",
				analyzing: "skipped",
				syncing,
			}),
			receipt: { ...receiptBase, preview },
		};
	}

	// `failed` (or any non-ready terminal): distinguish an extraction failure so
	// the trail points at the stage that actually broke.
	const extractionFailed =
		record.aiError?.startsWith("extraction failed") ?? false;
	return {
		kind: "done",
		trail: trailFrom({
			saving: "done",
			extracting: extractionFailed ? "failed" : "done",
			analyzing: extractionFailed ? "skipped" : "failed",
			syncing,
		}),
		receipt: { ...receiptBase, preview },
	};
}

/**
 * Final guard for user-facing copy. The `app/*` error/`aiError` messages are
 * already designed to be token- and excerpt-free; this only collapses
 * whitespace and caps length so no stray multi-line stack-like text reaches the
 * UI (AGENTS.md "Redact tokens and sensitive values").
 */
function safeMessage(message: string): string {
	const collapsed = message.replace(/\s+/g, " ").trim();
	return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed;
}
