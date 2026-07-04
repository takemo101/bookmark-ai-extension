/**
 * The options controller: a framework-agnostic state machine that turns the
 * {@link OptionsUseCases} boundary into an immutable {@link OptionsView} the
 * React "Research Ledger" component renders. It owns every decision the ledger
 * makes — which rows pass the current filters, which facets exist, which record
 * is selected, how to phrase a safe action error — so the React layer stays a
 * pure projection of `getView()` and imports no Drive/AI/JSONL/merge internals
 * (docs/implementation-principles.md "Tell, don't ask"; AGENTS.md "Architecture
 * boundaries").
 *
 * Search/filter/sort are delegated to the first-class {@link Bookmarks}
 * collection (`filter`, `genres`, `tags`), never re-implemented as ad-hoc array
 * loops here or in the component (docs/implementation-principles.md "First-class
 * bookmark collection").
 *
 * The controller is observable via {@link OptionsController.subscribe} /
 * {@link OptionsController.getView} so React can bind it with
 * `useSyncExternalStore`. It is fully testable on its own: drive it with a fake
 * `OptionsUseCases` and read `getView()` across states — no DOM, Chrome, Drive,
 * or Prompt API required.
 */
import type { CacheState, CanonicalUrl, OptionsUseCases } from "./use-cases";
import type { AiStatus, BookmarkRecord, SyncStatus } from "./view-types";

/** AI-status filter options offered in the left rail, in lifecycle order. */
const STATUS_OPTIONS: readonly AiStatus[] = [
	"ready",
	"pending",
	"unavailable",
	"failed",
];

/** The active filter selections, all plain display strings. */
export type FiltersView = {
	readonly query: string;
	readonly genre?: string;
	readonly tag?: string;
	readonly aiStatus?: AiStatus;
	/** Host filter derived from canonical URLs (MIK-028), e.g. `github.com`. */
	readonly domain?: string;
};

/** The available filter facets derived from the full collection. */
export type FacetsView = {
	readonly genres: readonly string[];
	readonly tags: readonly string[];
	readonly statuses: readonly AiStatus[];
	/** Distinct bookmark domains, sorted, derived on demand (MIK-028). */
	readonly domains: readonly string[];
};

/** A single dense bookmark row in the center ledger. */
export type RowView = {
	readonly canonicalUrl: string;
	/**
	 * Original visited URL, used for favicon lookup (MIK-034): Chrome's
	 * `_favicon` endpoint resolves against visited URLs, so the normalized
	 * canonical form (no `www.`, stripped params) can miss where this hits.
	 */
	readonly url: string;
	readonly title: string;
	/** Short AI summary, falling back to the URL when there is no description. */
	readonly summary: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly aiStatus: AiStatus;
	readonly updatedAt: string;
	readonly selected: boolean;
	/** Whether a "Re-analyze" affordance should show (status is not `ready`). */
	readonly canReAnalyze: boolean;
	/** ID of the analysis profile shown as compact row metadata (MIK-022). */
	readonly analysisProfileId?: string;
};

/** The detail side sheet for the selected (open) bookmark (MIK-022). */
export type DetailView = {
	readonly canonicalUrl: string;
	readonly title: string;
	readonly url: string;
	readonly description?: string;
	readonly genre?: string;
	readonly tags: readonly string[];
	readonly aiStatus: AiStatus;
	readonly aiError?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly lastAnalyzedAt?: string;
	readonly canReAnalyze: boolean;
	/** Long-form generated Markdown analysis, rendered safely (docs/design.md "Options page"). */
	readonly analysisMarkdown?: string;
	/** ID of the built-in analysis profile that generated the current analysis. */
	readonly analysisProfileId?: string;
};

export type SyncView = {
	readonly status: SyncStatus;
	readonly lastSyncedAt?: string;
	readonly error?: string;
	/**
	 * Whether the cache holds local changes not yet confirmed on Drive (a failed
	 * or in-flight save/update/delete). A token-free boolean the sync panel
	 * surfaces so the user knows a retry is still owed (MIK-014).
	 */
	readonly pendingLocalChanges: boolean;
	/** A Drive pull/merge refresh is in flight (MIK-026). */
	readonly syncing: boolean;
	/** A delete/re-analyze Drive write is in flight (MIK-026). */
	readonly writing: boolean;
};

/** The complete immutable snapshot the React component renders. */
export type OptionsView = {
	readonly loading: boolean;
	readonly sync: SyncView;
	readonly filters: FiltersView;
	readonly facets: FacetsView;
	readonly rows: readonly RowView[];
	readonly totalCount: number;
	readonly filteredCount: number;
	/** No bookmarks exist at all. */
	readonly empty: boolean;
	/** Bookmarks exist but the current filters exclude all of them. */
	readonly noMatches: boolean;
	readonly selected?: DetailView;
	/** A delete/re-analyze action is in flight. */
	readonly busy: boolean;
	/** A safe, token-free message from a failed action. */
	readonly actionError?: string;
	/** A safe note from a partially-successful action (e.g. saved locally only). */
	readonly actionNotice?: string;
};

export interface OptionsController {
	getView(): OptionsView;
	subscribe(listener: () => void): () => void;
	/** Load the cached list, then best-effort pull the authoritative store. */
	init(): Promise<void>;
	/**
	 * Pull the authoritative store from Drive and refresh list + sync badge.
	 * Calls while a sync or write is already in flight are dropped, not queued,
	 * so the floating button and Manage-triggered requests never stack Drive
	 * pulls (MIK-026).
	 */
	refresh(): Promise<void>;
	setQuery(query: string): void;
	setGenre(genre: string | undefined): void;
	setTag(tag: string | undefined): void;
	setStatus(status: AiStatus | undefined): void;
	setDomain(domain: string | undefined): void;
	clearFilters(): void;
	select(canonicalUrl: string): void;
	clearSelection(): void;
	/** Delete a bookmark (by display canonical URL) through the domain delete. */
	deleteBookmark(canonicalUrl: string): Promise<void>;
	/** Re-run AI analysis for a pending/unavailable/failed bookmark. */
	reAnalyze(canonicalUrl: string): Promise<void>;
}

const INITIAL_SYNC: Omit<SyncView, "syncing" | "writing"> = {
	status: "idle",
	pendingLocalChanges: false,
};

export function createOptionsController(
	useCases: OptionsUseCases,
): OptionsController {
	let state: CacheState | undefined;
	let loading = true;
	let busy = false;
	// Distinct in-flight flags so the UI can phrase what is slow: a Drive
	// pull/merge (`syncing`) vs a delete/re-analyze write (`writing`) (MIK-026).
	let syncing = false;
	let writing = false;
	let filters: FiltersView = { query: "" };
	let selectedDisplay: string | undefined;
	let actionError: string | undefined;
	let actionNotice: string | undefined;

	const listeners = new Set<() => void>();
	// Display canonical URLs map back to their branded value so delete/re-analyze
	// never re-parse or cast a raw string (parse, don't validate).
	let canonicalByDisplay = new Map<string, CanonicalUrl>();

	let view: OptionsView = render();

	function notify(): void {
		view = render();
		for (const listener of listeners) {
			listener();
		}
	}

	function indexCanonicals(snapshot: CacheState): void {
		const next = new Map<string, CanonicalUrl>();
		for (const record of snapshot.bookmarks.toArray()) {
			next.set(record.canonicalUrl, record.canonicalUrl);
		}
		canonicalByDisplay = next;
	}

	function setState(snapshot: CacheState): void {
		state = snapshot;
		indexCanonicals(snapshot);
		// Drop a selection that no longer resolves (e.g. it was just deleted).
		if (
			selectedDisplay !== undefined &&
			!canonicalByDisplay.has(selectedDisplay)
		) {
			selectedDisplay = undefined;
		}
	}

	function syncView(snapshot: CacheState | undefined): SyncView {
		if (!snapshot) {
			return { ...INITIAL_SYNC, syncing, writing };
		}
		return {
			status: snapshot.sync.status,
			lastSyncedAt: snapshot.sync.lastSyncedAt,
			error: snapshot.sync.error?.message,
			pendingLocalChanges: snapshot.sync.pending === true,
			syncing,
			writing,
		};
	}

	function render(): OptionsView {
		const bookmarks = state?.bookmarks;
		const totalCount = bookmarks?.size ?? 0;

		const matches = bookmarks
			? bookmarks.filter({
					query: filters.query,
					genre: filters.genre,
					tag: filters.tag,
					aiStatus: filters.aiStatus,
					domain: filters.domain,
				})
			: [];

		const rows = matches.map((record) =>
			toRow(record, record.canonicalUrl === selectedDisplay),
		);

		const selectedBranded =
			selectedDisplay !== undefined
				? canonicalByDisplay.get(selectedDisplay)
				: undefined;
		const selectedRecord =
			selectedBranded && bookmarks ? bookmarks.get(selectedBranded) : undefined;

		return {
			loading,
			sync: syncView(state),
			filters,
			facets: {
				genres: bookmarks?.genres() ?? [],
				tags: bookmarks?.tags() ?? [],
				statuses: STATUS_OPTIONS,
				domains: bookmarks?.domains() ?? [],
			},
			rows,
			totalCount,
			filteredCount: rows.length,
			empty: totalCount === 0,
			noMatches: totalCount > 0 && rows.length === 0,
			selected: selectedRecord ? toDetail(selectedRecord) : undefined,
			busy,
			actionError,
			actionNotice,
		};
	}

	async function runAction(
		canonicalUrl: string,
		op: (branded: CanonicalUrl) => Promise<void>,
	): Promise<void> {
		if (busy) {
			return;
		}
		const branded = canonicalByDisplay.get(canonicalUrl);
		if (!branded) {
			return;
		}
		busy = true;
		writing = true;
		actionError = undefined;
		actionNotice = undefined;
		notify();
		try {
			await op(branded);
		} finally {
			busy = false;
			writing = false;
			notify();
		}
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
			loading = true;
			notify();
			setState(await useCases.loadCachedState());
			loading = false;
			notify();
			await this.refresh();
		},

		async refresh() {
			// One Drive operation at a time: duplicate sync clicks and Manage-
			// triggered requests are dropped while a pull or write is in flight.
			if (syncing || busy) {
				return;
			}
			syncing = true;
			notify();
			try {
				const result = await useCases.syncFromDrive();
				if (result.ok) {
					setState(result.value);
					return;
				}
				// Keep the list; surface the safe sync error from the refreshed cache.
				setState(await useCases.loadCachedState());
			} finally {
				syncing = false;
				notify();
			}
		},

		setQuery(query) {
			filters = { ...filters, query };
			notify();
		},
		setGenre(genre) {
			filters = { ...filters, genre: genre || undefined };
			notify();
		},
		setTag(tag) {
			filters = { ...filters, tag: tag || undefined };
			notify();
		},
		setStatus(status) {
			filters = { ...filters, aiStatus: status };
			notify();
		},
		setDomain(domain) {
			filters = { ...filters, domain: domain || undefined };
			notify();
		},
		clearFilters() {
			filters = { query: "" };
			notify();
		},

		select(canonicalUrl) {
			if (!canonicalByDisplay.has(canonicalUrl)) {
				return;
			}
			selectedDisplay = canonicalUrl;
			notify();
		},
		clearSelection() {
			selectedDisplay = undefined;
			notify();
		},

		async deleteBookmark(canonicalUrl) {
			await runAction(canonicalUrl, async (branded) => {
				const result = await useCases.deleteBookmark(branded);
				if (result.ok) {
					setState(result.value);
					return;
				}
				actionError = safeMessage(result.error.message);
			});
		},

		async reAnalyze(canonicalUrl) {
			await runAction(canonicalUrl, async (branded) => {
				const result = await useCases.reAnalyzeBookmark(branded);
				// Re-analyze updates the cache regardless of outcome; reload the full
				// list so the row reflects its new status either way.
				setState(await useCases.loadCachedState());
				if (!result.ok) {
					actionError = safeMessage(result.error.message);
					return;
				}
				if (!result.value.driveSynced) {
					actionNotice = safeMessage(
						`Re-analyzed, saved locally — Drive sync pending: ${
							result.value.driveError?.message ?? "Drive sync failed"
						}`,
					);
				}
			});
		},
	};
}

function toRow(record: BookmarkRecord, selected: boolean): RowView {
	return {
		canonicalUrl: record.canonicalUrl,
		url: record.url,
		title: record.title,
		summary: record.description ?? record.url,
		genre: record.genre,
		tags: [...record.tags],
		aiStatus: record.aiStatus,
		updatedAt: record.updatedAt,
		selected,
		canReAnalyze: record.aiStatus !== "ready",
		analysisProfileId: record.analysisProfileId,
	};
}

function toDetail(record: BookmarkRecord): DetailView {
	return {
		canonicalUrl: record.canonicalUrl,
		title: record.title,
		url: record.url,
		description: record.description,
		genre: record.genre,
		tags: [...record.tags],
		aiStatus: record.aiStatus,
		aiError: record.aiError ? safeMessage(record.aiError) : undefined,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		lastAnalyzedAt: record.lastAnalyzedAt,
		canReAnalyze: record.aiStatus !== "ready",
		analysisMarkdown: record.analysisMarkdown,
		analysisProfileId: record.analysisProfileId,
	};
}

/**
 * Final guard for user-facing copy. The `app/*` error / `aiError` messages are
 * already designed to be token- and excerpt-free; this only collapses
 * whitespace and caps length so no stray multi-line stack-like text reaches the
 * UI (AGENTS.md "Redact tokens and sensitive values").
 */
function safeMessage(message: string): string {
	const collapsed = message.replace(/\s+/g, " ").trim();
	return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed;
}
