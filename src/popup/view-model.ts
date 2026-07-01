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
import type {
	CacheState,
	CanonicalUrl,
	PopupEnvironment,
	PopupUseCases,
	ProgressObserver,
	SaveOutcome,
	SaveStage,
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
};

export function createPopupController(
	useCases: PopupUseCases,
): PopupController {
	let view: PopupView = INITIAL_VIEW;
	const listeners = new Set<() => void>();
	// Display canonical URLs map back to their branded value so re-analyze never
	// re-parses or casts a raw string (parse, don't validate).
	let canonicalByDisplay = new Map<string, CanonicalUrl>();

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
		});

		const onProgress: ProgressObserver = ({ stage }) => {
			// Only advance while the flow is still running.
			if (view.flow.kind === "running") {
				setView({ flow: { kind: "running", trail: runningTrail(stage) } });
			}
		};

		const result = await invoke(onProgress);
		setView({ flow: finalizeFlow(result), canSave: true });

		// Refresh recents/sync from cache so the saved bookmark is visible even when
		// AI was unavailable/failed or Drive did not accept the write.
		const state = await useCases.loadCachedState();
		setView({ recent: mapRecent(state), sync: mapSync(state) });
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
			setView({
				loading: false,
				tab: tab.ok
					? { title: tab.value.title, url: tab.value.url }
					: undefined,
				connection: environment.connection,
				promptApi: environment.promptApi,
				recent: mapRecent(state),
				sync: mapSync(state),
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
		async refresh() {
			const result = await useCases.syncFromDrive();
			if (result.ok) {
				setView({
					recent: mapRecent(result.value),
					sync: mapSync(result.value),
				});
				return;
			}
			// Keep recents; surface the safe sync error message.
			const state = await useCases.loadCachedState();
			setView({ recent: mapRecent(state), sync: mapSync(state) });
		},
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
