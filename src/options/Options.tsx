/**
 * Research Ledger options page (docs/design.md "Options page: Research Ledger").
 *
 * A pure projection of {@link OptionsController.getView} with two top-level
 * screens behind a small nav (MIK-025): the Library — the two-zone ledger
 * (left rail with search and genre/tag/status filters; center bookmark rows
 * with per-row quick delete) plus a detail drawer overlay (MIK-022,
 * MIK-024) — and the Analysis skills settings screen, whose content centers
 * in a no-rail column and opens the custom skill create/edit form in the
 * same right-drawer foundation as the bookmark detail (MIK-053). All three
 * screens render through the shared Options-local components under
 * `components/` (MIK-053): {@link ScreenFrame} owns the per-screen layout
 * variant and header/content column alignment, every screen carries
 * title-adjacent `?` help through its fixed popover, and Library rows and
 * Ask AI recommendation cards share the {@link BookmarkSummaryItem} body.
 * Bookmark Drive sync and analysis settings sync status/actions live in one
 * shared app-header sync hub (MIK-051) instead of per-screen rail panels and
 * floating buttons. It dispatches user intent back through the
 * controllers and imports only the controllers, view types, style tokens, and
 * the pure profile-display resolver (MIK-031); no Drive client, Prompt API
 * client, JSONL parser, or merge internals appear here (AGENTS.md
 * "Architecture boundaries"). All wiring is injected via the
 * `controller`/`skillsController` props, so the component is trivially
 * renderable with fakes in tests.
 */
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
	type AnalysisProfileDisplay,
	resolveAnalysisProfileDisplay,
} from "../lib/ai/index";
import { type SupportedLanguage, detectUiLanguage } from "../lib/i18n/index";
import {
	type AskAiCardView,
	type AskAiController,
	type AskAiResultView,
	type AskAiView,
	isAskAiComposerSubmitKey,
} from "./ask-ai-view-model";
import {
	BookmarkSummaryItem,
	StatusPill,
} from "./components/BookmarkSummaryItem";
import { Drawer } from "./components/Drawer";
import {
	ScreenFrame,
	type ScreenFrameVariant,
	screenFramePageStyle,
} from "./components/ScreenFrame";
import { Favicon } from "./favicon";
import { type FacetUnit, type OptionsMessages, optionsMessages } from "./i18n";
import { AnalysisMarkdown } from "./markdown";
import type {
	BuiltInSkillView,
	CustomSkillRowView,
	SkillFormValues,
	SkillsController,
	SkillsView,
} from "./skills-view-model";
import type {
	DetailView,
	FacetsView,
	FiltersView,
	OptionsController,
	OptionsView,
	RowView,
	SyncView,
} from "./view-model";
import {
	appHeader,
	appHeaderActions,
	askAiAssistantTurn,
	askAiChatContext,
	askAiChatShell,
	askAiComposer,
	askAiLatestButton,
	askAiTurnLabel,
	askAiUserBubble,
	askAiUserTurn,
	askAiViewport,
	askAiViewportShell,
	askAiWelcome,
	brandTitle,
	chip,
	chipActive,
	dangerButton,
	disabledButton,
	drawerTips,
	drawerTipsSummary,
	facetActiveSummary,
	facetCollapsedCount,
	facetHeaderButton,
	facetHeaderLabel,
	navTab,
	navTabActive,
	palette,
	panel,
	primaryButton,
	profileEditButton,
	rail,
	railLabel,
	rowDeleteButton,
	searchInput,
	statusColor,
	subtleButton,
	syncHub,
	syncHubPanel,
	syncHubSummary,
	syncTone,
	tagListExpanded,
} from "./styles";

/**
 * The top-level options screens (MIK-025, MIK-045). Presentation-only UI
 * state: switching screens never touches Drive/cache semantics.
 */
export type OptionsScreen = "library" | "analysis-skills" | "ask-ai";

// Stable no-op store bindings so the optional skills-view subscription can be
// called unconditionally (hooks may not be conditional) when no skills
// controller is provided.
const noSkillsSubscribe = () => () => {};
const noSkillsView = () => undefined;

export function Options({
	controller,
	skillsController,
	askAiController,
	initialScreen = "library",
	language,
}: {
	controller: OptionsController;
	/** Optional so existing tests/embeds can render without the skills screen. */
	skillsController?: SkillsController;
	/** Optional so existing tests/embeds can render without the Ask AI screen. */
	askAiController?: AskAiController;
	/** Test/embed hook: which screen renders first. Runtime starts on Library. */
	initialScreen?: OptionsScreen;
	/**
	 * UI language override (MIK-029). Tests/embeds inject it for determinism;
	 * the runtime omits it and the browser UI language decides (Japanese
	 * fallback).
	 */
	language?: SupportedLanguage;
}) {
	const view = useSyncExternalStore(
		controller.subscribe,
		controller.getView,
		controller.getView,
	);
	// Subscribed at the top level (not only inside the skills screen) because
	// the library detail sheet resolves custom profile names from the skills
	// view (MIK-031). `undefined` when no skills controller is provided.
	const skillsView = useSyncExternalStore(
		skillsController?.subscribe ?? noSkillsSubscribe,
		skillsController?.getView ?? noSkillsView,
		skillsController?.getView ?? noSkillsView,
	);
	const [screen, setScreen] = useState<OptionsScreen>(initialScreen);
	const m = optionsMessages(language ?? detectUiLanguage());

	useEffect(() => {
		void controller.init();
	}, [controller]);

	useEffect(() => {
		// Settings load on mount rather than on the first skills-screen visit:
		// the detail sheet needs custom skill names for profile labels (MIK-031),
		// and screen switches no longer re-trigger a settings Drive pull.
		void skillsController?.init();
	}, [skillsController]);

	useLockBodyScroll(view.selected !== undefined);

	function switchScreen(next: OptionsScreen): void {
		if (next === screen) {
			return;
		}
		// Leaving the library closes the detail sheet so its selection highlight
		// and scroll lock never linger behind the settings screen. Filters and
		// the skill form draft are preserved.
		controller.clearSelection();
		setScreen(next);
	}

	/**
	 * A custom profile label in the detail sheet opens Analysis skills with
	 * that skill's edit modal (MIK-031). If the skill vanished meanwhile
	 * (deleted on another device), `startEdit` no-ops and the user still lands
	 * on the Analysis skills screen.
	 */
	function openCustomProfileEdit(id: string): void {
		if (!skillsController) {
			return;
		}
		skillsController.startEdit(id);
		switchScreen("analysis-skills");
	}

	// A screen whose controller was not injected falls back to the Library so a
	// stale `initialScreen` can never render an empty page.
	const activeScreen: OptionsScreen =
		(screen === "analysis-skills" && !skillsController) ||
		(screen === "ask-ai" && !askAiController)
			? "library"
			: screen;
	const showLibrary = activeScreen === "library";
	// The ScreenFrame variant of the active screen (MIK-053); the `chat`
	// variant also locks the outer page scroll through the page style.
	const frameVariant: ScreenFrameVariant =
		activeScreen === "ask-ai"
			? "chat"
			: activeScreen === "analysis-skills"
				? "noRail"
				: "library";

	return (
		<main style={screenFramePageStyle(frameVariant)}>
			{/* Shared app header (MIK-036): the product brand lives here on every
			    screen; the sync hub (MIK-051) travels with it, and the nav renders
			    only when another screen exists. */}
			<header style={appHeader}>
				<h1 style={brandTitle}>Bookmark AI</h1>
				<div style={appHeaderActions}>
					<SyncHub
						sync={view.sync}
						loading={view.loading}
						skillsSync={skillsView?.sync}
						skillsLoading={skillsView?.loading === true}
						m={m}
						onRefresh={() => void controller.refresh()}
						onRefreshSettings={
							skillsController
								? () => void skillsController.refresh()
								: undefined
						}
					/>
					{skillsController || askAiController ? (
						<nav aria-label={m.navAria} style={{ display: "flex", gap: 8 }}>
							<NavTab
								label={m.library}
								active={showLibrary}
								onClick={() => switchScreen("library")}
							/>
							{skillsController ? (
								<NavTab
									label={m.analysisSkills}
									active={activeScreen === "analysis-skills"}
									onClick={() => switchScreen("analysis-skills")}
								/>
							) : null}
							{askAiController ? (
								<NavTab
									label={m.askAi}
									active={activeScreen === "ask-ai"}
									onClick={() => switchScreen("ask-ai")}
								/>
							) : null}
						</nav>
					) : null}
				</div>
			</header>
			{showLibrary ? (
				<ScreenFrame
					variant="library"
					title={m.library}
					subtitle={m.researchLedger}
					helpLabel={m.libraryHelpAria}
					help={<LibraryHelp m={m} />}
					rail={<LeftRail view={view} m={m} controller={controller} />}
				>
					<CenterList view={view} m={m} controller={controller} />
				</ScreenFrame>
			) : activeScreen === "analysis-skills" && skillsController ? (
				<SkillsScreen skillsController={skillsController} m={m} />
			) : askAiController ? (
				<AskAiScreen
					controller={askAiController}
					m={m}
					onOpenBookmark={(canonicalUrl) => controller.select(canonicalUrl)}
				/>
			) : null}
			{/* The detail drawer overlays whichever screen selected it: Library rows
			    and Ask AI recommendation cards both route through
			    `controller.select` (MIK-046), and switching screens clears the
			    selection, so it can never linger behind another screen. */}
			{view.selected ? (
				<BookmarkDetailDrawer
					detail={view.selected}
					profile={
						view.selected.analysisProfileId
							? resolveAnalysisProfileDisplay(
									view.selected.analysisProfileId,
									skillsView?.custom ?? [],
								)
							: undefined
					}
					busy={view.busy}
					m={m}
					controller={controller}
					onEditCustomProfile={
						skillsController ? openCustomProfileEdit : undefined
					}
				/>
			) : null}
		</main>
	);
}

/**
 * Library header-help guidance (MIK-053): what search/filters cover, how the
 * detail drawer opens, and where sync actions live — disclosed by the
 * title-adjacent `?` so the rail stays reserved for active controls.
 */
function LibraryHelp({ m }: { m: OptionsMessages }) {
	return (
		<>
			<p style={railLabel}>{m.libraryAbout}</p>
			<p style={{ margin: 0 }}>{m.libraryHelpSearch}</p>
			<p style={{ margin: "6px 0 0" }}>{m.libraryHelpDetail}</p>
			<p style={{ margin: "6px 0 0" }}>{m.libraryHelpSync}</p>
		</>
	);
}

function NavTab({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			style={active ? navTabActive : navTab}
			aria-current={active ? "page" : undefined}
			onClick={onClick}
		>
			{label}
		</button>
	);
}

/** The minimal element shape {@link lockScroll} needs; lets tests use a fake. */
type ScrollLockTarget = { style: { overflow: string } };

/**
 * Hide a scroll container's overflow and return a restore function. Exported
 * only so the scroll-lock behavior stays unit-testable without a DOM
 * (tests run in node, not jsdom).
 */
export function lockScroll(target: ScrollLockTarget): () => void {
	const previous = target.style.overflow;
	target.style.overflow = "hidden";
	return () => {
		target.style.overflow = previous;
	};
}

/**
 * Lock the underlying page scroll while the detail sheet is open (MIK-024) so
 * scrolling the sheet body never scrolls the ledger behind it. Restores the
 * previous body overflow on close/unmount.
 */
function useLockBodyScroll(locked: boolean): void {
	useEffect(() => {
		if (!locked) {
			return;
		}
		return lockScroll(document.body);
	}, [locked]);
}

function LeftRail({
	view,
	m,
	controller,
}: {
	view: OptionsView;
	m: OptionsMessages;
	controller: OptionsController;
}) {
	const hasFilters =
		view.filters.query.length > 0 ||
		view.filters.genre !== undefined ||
		view.filters.tag !== undefined ||
		view.filters.aiStatus !== undefined ||
		view.filters.domain !== undefined;

	return (
		<aside style={rail}>
			<section style={panel}>
				<p style={railLabel}>{m.search}</p>
				<input
					type="search"
					value={view.filters.query}
					placeholder={m.searchPlaceholder}
					onChange={(e) => controller.setQuery(e.target.value)}
					style={searchInput}
					aria-label={m.searchAria}
				/>
				<p style={{ fontSize: 11, color: palette.inkFaint, margin: "8px 0 0" }}>
					{m.shownOf(view.filteredCount, view.totalCount)}
				</p>
				{hasFilters ? (
					<button
						type="button"
						style={{ ...subtleButton, marginTop: 8 }}
						onClick={() => controller.clearFilters()}
					>
						{m.clearFilters}
					</button>
				) : null}
			</section>

			<FilterFacets
				facets={view.facets}
				filters={view.filters}
				m={m}
				controller={controller}
			/>
		</aside>
	);
}

/**
 * The one line of in-flight progress copy, or `undefined` when idle (MIK-026).
 * Cached loading, a Drive pull, and a Drive write read differently so the user
 * knows which slow thing is happening. Exported for tests only — pure view
 * logic, no controller state.
 */
export function syncProgressText(
	sync: Pick<SyncView, "syncing" | "writing">,
	loading: boolean,
	m: Pick<OptionsMessages, "loadingCached" | "syncingDrive" | "writingDrive">,
): string | undefined {
	if (loading) {
		return m.loadingCached;
	}
	if (sync.syncing) {
		return m.syncingDrive;
	}
	if (sync.writing) {
		return m.writingDrive;
	}
	return undefined;
}

function settingsSyncProgressText(
	sync: Pick<SkillsView["sync"], "syncing" | "writing">,
	loading: boolean,
	m: Pick<
		OptionsMessages,
		"loadingSkills" | "settingsSyncingDrive" | "settingsWritingDrive"
	>,
): string | undefined {
	if (loading) {
		return m.loadingSkills;
	}
	if (sync.syncing) {
		return m.settingsSyncingDrive;
	}
	if (sync.writing) {
		return m.settingsWritingDrive;
	}
	return undefined;
}

/**
 * The small tone-colored status dot every sync readout opens with (MIK-038):
 * one shape for the Library Drive sync and the Analysis skills settings sync
 * inside the shared sync hub (MIK-051).
 */
function SyncStatusDot({ status }: { status: string }) {
	return (
		<span
			aria-hidden
			style={{
				width: 8,
				height: 8,
				borderRadius: 999,
				background: statusColor(syncTone(status)),
			}}
		/>
	);
}

/**
 * The per-sync-source inputs the hub summary pill weighs (MIK-051). Exported
 * for tests only — pure view logic, no controller state.
 */
export type SyncHubSectionState = {
	readonly status: string;
	readonly pendingLocalChanges: boolean;
	readonly syncing: boolean;
	readonly writing: boolean;
	readonly loading: boolean;
};

export type SyncHubSummary = "error" | "syncing" | "pending" | "synced";

/**
 * The glance state of the sync hub pill (MIK-051): the worst state across all
 * sync sources wins — an error outranks in-flight progress, which outranks
 * pending local changes, which outranks the everything-synced resting state.
 * Exported for tests only.
 */
export function syncHubSummaryKind(
	sections: readonly SyncHubSectionState[],
): SyncHubSummary {
	if (sections.some((s) => syncTone(s.status) === "danger")) {
		return "error";
	}
	if (sections.some((s) => s.loading || s.syncing || s.writing)) {
		return "syncing";
	}
	if (sections.some((s) => s.pendingLocalChanges)) {
		return "pending";
	}
	return "synced";
}

/** The dot tone of each hub summary state (MIK-051). */
const SYNC_HUB_SUMMARY_TONE: Readonly<
	Record<SyncHubSummary, "ok" | "warn" | "danger">
> = {
	synced: "ok",
	syncing: "warn",
	pending: "warn",
	error: "danger",
};

/**
 * Shared app-header sync hub (MIK-051): the one place for bookmark Drive sync
 * and analysis settings sync. A native `<details>` disclosure — no dependency,
 * no custom open/close state — whose summary pill reads the combined state at
 * a glance and whose panel holds the full readouts and the manual actions the
 * old rail panels and floating buttons offered. Actions dispatch the existing
 * {@link OptionsController.refresh} / {@link SkillsController.refresh} paths
 * unchanged; in-flight sections disable their action so a slow sync can never
 * be double-clicked into a second one (MIK-026; the controllers drop
 * duplicates too).
 */
function SyncHub({
	sync,
	loading,
	skillsSync,
	skillsLoading,
	m,
	onRefresh,
	onRefreshSettings,
}: {
	sync: SyncView;
	loading: boolean;
	/** Present only when a skills controller is injected. */
	skillsSync?: SkillsView["sync"];
	skillsLoading: boolean;
	m: OptionsMessages;
	onRefresh: () => void;
	onRefreshSettings?: () => void;
}) {
	const sections: SyncHubSectionState[] = [
		{
			status: sync.status,
			pendingLocalChanges: sync.pendingLocalChanges,
			syncing: sync.syncing,
			writing: sync.writing,
			loading,
		},
	];
	if (skillsSync) {
		sections.push({
			status: skillsSync.status,
			pendingLocalChanges: skillsSync.pendingLocalChanges,
			syncing: skillsSync.syncing,
			writing: skillsSync.writing,
			loading: skillsLoading,
		});
	}
	const kind = syncHubSummaryKind(sections);
	const summaryLabel: Readonly<Record<SyncHubSummary, string>> = {
		synced: m.syncHubSynced,
		syncing: m.syncHubSyncing,
		pending: m.syncHubPending,
		error: m.syncHubError,
	};

	return (
		<details style={syncHub} aria-label={m.syncHubAria}>
			<summary style={syncHubSummary}>
				<span
					aria-hidden
					style={{
						width: 8,
						height: 8,
						borderRadius: 999,
						background: statusColor(SYNC_HUB_SUMMARY_TONE[kind]),
					}}
				/>
				<span>{summaryLabel[kind]}</span>
			</summary>
			<div style={syncHubPanel}>
				<SyncHubSection
					label={m.driveSync}
					status={sync.status}
					progress={syncProgressText(sync, loading, m)}
					pending={sync.pendingLocalChanges}
					lastSyncedAt={sync.lastSyncedAt}
					error={sync.error}
					actionLabel={m.syncButton}
					actionAria={m.syncAria}
					inFlight={loading || sync.syncing || sync.writing}
					onAction={onRefresh}
					m={m}
				/>
				{skillsSync && onRefreshSettings ? (
					<SyncHubSection
						label={m.settingsSync}
						status={skillsSync.status}
						progress={settingsSyncProgressText(skillsSync, skillsLoading, m)}
						pending={skillsSync.pendingLocalChanges}
						lastSyncedAt={skillsSync.lastSyncedAt}
						actionLabel={m.syncSettingsButton}
						actionAria={m.settingsSyncAria}
						inFlight={skillsLoading || skillsSync.syncing || skillsSync.writing}
						onAction={onRefreshSettings}
						m={m}
					/>
				) : null}
			</div>
		</details>
	);
}

/**
 * One sync source inside the hub panel (MIK-051): the status readout the old
 * rail panels carried — status dot, in-flight progress (MIK-026), pending
 * local changes, last synced time, safe errors — plus its manual sync action.
 */
function SyncHubSection({
	label,
	status,
	progress,
	pending,
	lastSyncedAt,
	error,
	actionLabel,
	actionAria,
	inFlight,
	onAction,
	m,
}: {
	label: string;
	status: string;
	progress?: string;
	pending: boolean;
	lastSyncedAt?: string;
	error?: string;
	actionLabel: string;
	actionAria: string;
	inFlight: boolean;
	onAction: () => void;
	m: OptionsMessages;
}) {
	return (
		<section>
			<p style={railLabel}>{label}</p>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<SyncStatusDot status={status} />
				<span style={{ fontSize: 13 }}>{status}</span>
			</div>
			{progress ? (
				<p
					role="status"
					style={{ fontSize: 12, color: palette.inkSoft, margin: "6px 0 0" }}
				>
					{progress}
				</p>
			) : null}
			{pending ? (
				<p style={{ fontSize: 12, color: palette.warn, margin: "6px 0 0" }}>
					{m.pendingLocal}
				</p>
			) : null}
			{lastSyncedAt ? (
				<p style={{ fontSize: 11, color: palette.inkFaint, margin: "4px 0 0" }}>
					{m.lastSynced(formatTime(lastSyncedAt))}
				</p>
			) : null}
			{error ? (
				<p style={{ fontSize: 12, color: palette.danger, margin: "6px 0 0" }}>
					{error}
				</p>
			) : null}
			<button
				type="button"
				style={
					inFlight
						? { ...subtleButton, ...disabledButton, marginTop: 8 }
						: { ...subtleButton, marginTop: 8 }
				}
				disabled={inFlight}
				aria-busy={inFlight || undefined}
				aria-label={actionAria}
				onClick={onAction}
			>
				{actionLabel}
			</button>
		</section>
	);
}

/** How many chips a growable facet shows before collapsing behind "Show all". */
const FACET_CAP = 12;

/**
 * The facet values to render given the expansion state (MIK-024): collapsed
 * shows the first {@link FACET_CAP} chips, but the active filter value always
 * stays visible so a filter picked while expanded never disappears on
 * collapse. Shared by the Tags and Domain facets (MIK-028). Exported for
 * tests only — view logic, no controller state.
 */
export function visibleFacetValues<T extends string>(
	values: readonly T[],
	active: T | undefined,
	expanded: boolean,
): readonly T[] {
	if (expanded || values.length <= FACET_CAP) {
		return values;
	}
	const capped = values.slice(0, FACET_CAP);
	if (active !== undefined && !capped.includes(active)) {
		capped.push(active);
	}
	return capped;
}

/**
 * One collapsible chip group inside the Filters panel (MIK-028, MIK-035): the
 * group header is a toggle button (`aria-expanded`) so long facets stop
 * stretching the rail, and — for growable facets — the expanded body keeps the
 * capped list behind a `Show all N` toggle. While collapsed the header shows
 * the active filter value as a summary chip (so a selection never becomes
 * invisible) or a faint option count when nothing is active. Grouping every
 * facet through this one shape is what keeps the rail structured instead of
 * scattered.
 */
function FacetGroup<T extends string>({
	label,
	values,
	active,
	m,
	onToggle,
	format = (value) => value,
	unit = "tags",
	cappable = false,
	defaultOpen = false,
}: {
	label: string;
	values: readonly T[];
	active: T | undefined;
	m: OptionsMessages;
	onToggle: (value: T | undefined) => void;
	format?: (value: T) => string;
	/** Which plural noun the Show all/fewer copy of a cappable facet uses. */
	unit?: FacetUnit;
	cappable?: boolean;
	/** Whether the group renders expanded on first mount (MIK-035). */
	defaultOpen?: boolean;
}) {
	// Open/expanded are view-only UI state; they never touch the controller.
	const [open, setOpen] = useState(defaultOpen);
	const [expanded, setExpanded] = useState(false);
	if (values.length === 0) {
		return null;
	}
	const visible = cappable
		? visibleFacetValues(values, active, expanded)
		: values;
	const overflow = cappable && values.length > FACET_CAP;

	return (
		<div>
			<button
				type="button"
				style={facetHeaderButton}
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
			>
				<span aria-hidden style={{ fontSize: 9, color: palette.inkFaint }}>
					{open ? "▾" : "▸"}
				</span>
				<span style={facetHeaderLabel}>{label}</span>
				{!open ? (
					active !== undefined ? (
						<span style={facetActiveSummary}>{format(active)}</span>
					) : (
						<span style={facetCollapsedCount}>
							{m.facetCount(values.length)}
						</span>
					)
				) : null}
			</button>
			{open ? (
				<>
					<div
						style={
							expanded
								? {
										display: "flex",
										flexWrap: "wrap",
										gap: 6,
										...tagListExpanded,
									}
								: { display: "flex", flexWrap: "wrap", gap: 6 }
						}
					>
						{visible.map((value) => (
							<button
								key={value}
								type="button"
								style={active === value ? chipActive : chip}
								onClick={() => onToggle(active === value ? undefined : value)}
							>
								{format(value)}
							</button>
						))}
					</div>
					{overflow ? (
						<button
							type="button"
							style={{ ...subtleButton, marginTop: 8 }}
							onClick={() => setExpanded((current) => !current)}
						>
							{expanded ? m.showFewer(unit) : m.showAll(values.length, unit)}
						</button>
					) : null}
				</>
			) : null}
		</div>
	);
}

/**
 * The single Filters panel (MIK-028): Domain, Genre, Tags, and AI status as
 * uniform collapsible subsections in one card. Domain and Tags can grow
 * without bound, so their expanded bodies collapse behind the shared facet
 * cap. Domain and Genre start open as the common entry points; Tags and AI
 * status start collapsed to keep the rail short (MIK-035) — an active filter
 * stays visible through the collapsed header summary.
 */
function FilterFacets({
	facets,
	filters,
	m,
	controller,
}: {
	facets: FacetsView;
	filters: FiltersView;
	m: OptionsMessages;
	controller: OptionsController;
}) {
	return (
		<section
			style={{ ...panel, display: "flex", flexDirection: "column", gap: 14 }}
			aria-label={m.filtersAria}
		>
			<p style={{ ...railLabel, margin: 0 }}>{m.filters}</p>
			<FacetGroup
				label={m.domain}
				values={facets.domains}
				active={filters.domain}
				m={m}
				onToggle={(domain) => controller.setDomain(domain)}
				unit="domains"
				cappable
				defaultOpen
			/>
			<FacetGroup
				label={m.genre}
				values={facets.genres}
				active={filters.genre}
				m={m}
				onToggle={(genre) => controller.setGenre(genre)}
				defaultOpen
			/>
			<FacetGroup
				label={m.tags}
				values={facets.tags}
				active={filters.tag}
				m={m}
				onToggle={(tag) => controller.setTag(tag)}
				format={(tag) => `#${tag}`}
				unit="tags"
				cappable
			/>
			<FacetGroup
				label={m.aiStatus}
				values={facets.statuses}
				active={filters.aiStatus}
				m={m}
				onToggle={(status) => controller.setStatus(status)}
			/>
		</section>
	);
}

function CenterList({
	view,
	m,
	controller,
}: {
	view: OptionsView;
	m: OptionsMessages;
	controller: OptionsController;
}) {
	if (view.loading) {
		return (
			<section>
				<Notice text={m.loadingLibrary} />
			</section>
		);
	}
	if (view.empty) {
		return (
			<section>
				<Notice text={m.emptyLibrary} />
			</section>
		);
	}
	// Action banners must survive a filter that excludes every row after a delete
	// or re-analyze, so they render above the no-matches notice too — otherwise the
	// only feedback for "deleted the last matching row" would silently vanish.
	const banners = (
		<>
			{view.actionError ? (
				<Banner tone="danger" text={view.actionError} />
			) : null}
			{view.actionNotice ? (
				<Banner tone="warn" text={view.actionNotice} />
			) : null}
		</>
	);
	if (view.noMatches) {
		return (
			<section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				{banners}
				<Notice text={m.noMatches} />
			</section>
		);
	}
	return (
		<section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			{banners}
			<ul
				style={{
					listStyle: "none",
					margin: 0,
					padding: 0,
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{view.rows.map((item) => (
					<li key={item.canonicalUrl}>
						<LedgerRow
							row={item}
							busy={view.busy}
							m={m}
							onSelect={() => controller.select(item.canonicalUrl)}
							onDelete={() => void controller.deleteBookmark(item.canonicalUrl)}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * A richer (but still scannable) ledger row: clicking it opens the detail
 * drawer, and the selected highlight only reflects the currently open drawer
 * (MIK-022). Rendered through the shared {@link BookmarkSummaryItem}
 * (MIK-053) — the same summary body as the Ask AI recommendation cards —
 * with the Library-specific trailing column: updated time plus the quick
 * delete, which stops propagation so deleting never opens the drawer
 * (MIK-024).
 */
function LedgerRow({
	row,
	busy,
	m,
	onSelect,
	onDelete,
}: {
	row: RowView;
	busy: boolean;
	m: OptionsMessages;
	onSelect: () => void;
	onDelete: () => void;
}) {
	return (
		<BookmarkSummaryItem
			url={row.url}
			title={row.title}
			description={row.summary}
			genre={row.genre}
			tags={row.tags}
			metaSuffix={
				row.analysisProfileId ? `· ${row.analysisProfileId}` : undefined
			}
			aiStatus={row.aiStatus}
			selected={row.selected}
			expanded={row.selected}
			onOpen={onSelect}
			trailing={
				<>
					<span style={{ fontSize: 10, color: palette.inkFaint }}>
						{formatTime(row.updatedAt)}
					</span>
					<button
						type="button"
						style={
							busy ? { ...rowDeleteButton, ...disabledButton } : rowDeleteButton
						}
						disabled={busy}
						aria-label={m.deleteRowAria(row.title)}
						title={m.deleteRowTitle}
						onClick={(event) => {
							// Quick delete must never open the detail drawer behind it.
							event.stopPropagation();
							onDelete();
						}}
					>
						✕
					</button>
				</>
			}
		/>
	);
}

function BookmarkUrlLink({ url }: { url: string }) {
	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			style={{
				fontSize: 12,
				color: palette.accent,
				wordBreak: "break-all",
			}}
		>
			{url}
		</a>
	);
}

function OpenBookmarkLink({ url, label }: { url: string; label: string }) {
	return (
		<a href={url} target="_blank" rel="noreferrer" style={primaryButton}>
			{label}
		</a>
	);
}

/**
 * The row-click bookmark detail drawer (MIK-022; shared {@link Drawer}
 * foundation since MIK-053): the single reading surface for a bookmark's
 * full detail and its long-form `analysisMarkdown`. Closes via the Close
 * buttons, Escape, and a true backdrop click — closing only clears the
 * selection, never the filters. Actions are Open, Delete, and Close only;
 * the drawer is a reading/deletion surface and no longer offers Re-analyze
 * (MIK-024 — a later explicit flow owns re-analysis). While an action is busy
 * Delete is disabled but Open and Close stay available, and Delete closes the
 * drawer once the record disappears (the controller drops the selection).
 *
 * The profile label shows the resolved display name (MIK-031): a custom
 * profile renders as a button that opens its edit drawer via
 * `onEditCustomProfile`; built-in and unknown profiles render as read-only
 * text (unknown falls back to the raw id).
 */
function BookmarkDetailDrawer({
	detail,
	profile,
	busy,
	m,
	controller,
	onEditCustomProfile,
}: {
	detail: DetailView;
	profile?: AnalysisProfileDisplay;
	busy: boolean;
	m: OptionsMessages;
	controller: OptionsController;
	onEditCustomProfile?: (id: string) => void;
}) {
	return (
		<Drawer
			labelledBy="bookmark-detail-title"
			onClose={() => controller.clearSelection()}
			header={
				<>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 8,
						}}
					>
						<StatusPill status={detail.aiStatus} />
						<button
							type="button"
							style={subtleButton}
							onClick={() => controller.clearSelection()}
							aria-label={m.closeDetailsAria}
						>
							✕
						</button>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							margin: "6px 0 4px",
						}}
					>
						{/* Keyed by URL: the drawer swaps records in place, so a failed
						    favicon for one site must not stick to the next (MIK-032). */}
						<Favicon key={detail.canonicalUrl} pageUrl={detail.url} size={28} />
						<h2 id="bookmark-detail-title" style={{ fontSize: 17, margin: 0 }}>
							{detail.title}
						</h2>
					</div>
					<BookmarkUrlLink url={detail.url} />
				</>
			}
			footer={
				<>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
						<OpenBookmarkLink url={detail.url} label={m.open} />
						<button
							type="button"
							style={
								busy ? { ...dangerButton, ...disabledButton } : dangerButton
							}
							disabled={busy}
							onClick={() =>
								void controller.deleteBookmark(detail.canonicalUrl)
							}
						>
							{m.deleteAction}
						</button>
						<button
							type="button"
							style={subtleButton}
							onClick={() => controller.clearSelection()}
						>
							{m.close}
						</button>
					</div>
					{busy ? (
						<p
							style={{
								fontSize: 11,
								color: palette.inkFaint,
								margin: "8px 0 0",
							}}
						>
							{m.busyNotice}
						</p>
					) : null}
				</>
			}
		>
			{detail.description ? (
				<p style={{ fontSize: 13, color: palette.ink, margin: 0 }}>
					{detail.description}
				</p>
			) : (
				<p style={{ fontSize: 12, color: palette.inkSoft, margin: 0 }}>
					{detail.aiStatus === "pending"
						? m.detailPending
						: m.detailNoDescription}
				</p>
			)}

			{detail.genre ? (
				<DetailField label={m.genre} value={detail.genre} />
			) : null}

			{profile ? (
				profile.kind === "custom" && onEditCustomProfile ? (
					<div style={{ marginTop: 10 }}>
						<p style={railLabel}>{m.profileLabel}</p>
						<button
							type="button"
							style={profileEditButton}
							aria-label={m.editProfileAria(profile.name)}
							onClick={() => onEditCustomProfile(profile.id)}
						>
							{profile.name}
						</button>
					</div>
				) : (
					<DetailField label={m.profileLabel} value={profile.name} />
				)
			) : null}

			{detail.tags.length > 0 ? (
				<div style={{ marginTop: 10 }}>
					<p style={railLabel}>{m.tags}</p>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{detail.tags.map((t) => (
							<span key={t} style={{ fontSize: 12, color: palette.inkSoft }}>
								#{t}
							</span>
						))}
					</div>
				</div>
			) : null}

			{detail.analysisMarkdown ? (
				<div style={{ marginTop: 12 }}>
					<p style={railLabel}>{m.analysisLabel}</p>
					<AnalysisMarkdown markdown={detail.analysisMarkdown} />
				</div>
			) : null}

			{detail.aiError ? (
				<p
					style={{
						fontSize: 12,
						color: palette.danger,
						margin: "10px 0 0",
					}}
				>
					{detail.aiError}
				</p>
			) : null}

			<dl
				style={{
					margin: "14px 0 0",
					fontSize: 11,
					color: palette.inkFaint,
				}}
			>
				<TimeRow label={m.createdLabel} value={detail.createdAt} />
				<TimeRow label={m.updatedLabel} value={detail.updatedAt} />
				{detail.lastAnalyzedAt ? (
					<TimeRow label={m.analyzedLabel} value={detail.lastAnalyzedAt} />
				) : null}
			</dl>
		</Drawer>
	);
}

/**
 * "Analysis skills" settings screen (MIK-018, MIK-025,
 * docs/ai-analysis-v2.md "Settings file"): a pure projection of
 * {@link SkillsController.getView}, rendered as its own top-level screen
 * instead of a panel below the ledger. Since MIK-052 it has no left rail —
 * the settings-file guidance moved into the title-adjacent header help and
 * the main content (Drive-synced custom skills with full CRUD, then the
 * fixed built-in profiles read-only) is centered in the shared no-rail
 * frame column (MIK-053). Settings sync status and refresh live in the
 * shared app-header sync hub (MIK-051). The create/edit form opens in the
 * shared right drawer (MIK-053). Never computes matching/priority itself —
 * that stays inside `ai/profile.ts`'s `selectAnalysisProfile`.
 */
function SkillsScreen({
	skillsController,
	m,
}: {
	skillsController: SkillsController;
	m: OptionsMessages;
}) {
	const view = useSyncExternalStore(
		skillsController.subscribe,
		skillsController.getView,
		skillsController.getView,
	);

	// No init effect here: the Options root already initializes the skills
	// controller on mount (MIK-031), so screen switches never re-pull settings.

	useLockBodyScroll(view.formOpen);

	return (
		<>
			<ScreenFrame
				variant="noRail"
				title={m.analysisSkills}
				subtitle={m.skillsSubtitle}
				helpLabel={m.skillsHelpAria}
				help={<SkillsHelp m={m} />}
				ariaLabel={m.skillsScreenAria}
			>
				<SkillsMain view={view} m={m} skillsController={skillsController} />
			</ScreenFrame>
			{view.formOpen ? (
				<SkillFormDrawer
					view={view}
					skillsController={skillsController}
					m={m}
				/>
			) : null}
		</>
	);
}

/**
 * Analysis skills header-help guidance (MIK-052; formerly the MIK-038 rail):
 * the custom-skills explanation and the `bookmark-ai/settings.json` storage
 * location, disclosed by the title-adjacent `?` instead of occupying a
 * permanent explanation-only rail.
 */
function SkillsHelp({ m }: { m: OptionsMessages }) {
	return (
		<>
			<p style={railLabel}>{m.skillsAbout}</p>
			<p style={{ margin: 0 }}>
				{m.skillsIntro.before}
				<code>bookmark-ai/settings.json</code>
				{m.skillsIntro.after}
			</p>
		</>
	);
}

/**
 * Analysis skills main content (MIK-038): custom skills first (they are the
 * editable surface, with the `Add custom` action), built-in profiles below as
 * a read-only reference. Action errors keep rendering above the cards while
 * the form modal is closed, exactly as before the rail/main split.
 */
function SkillsMain({
	view,
	m,
	skillsController,
}: {
	view: SkillsView;
	m: OptionsMessages;
	skillsController: SkillsController;
}) {
	return (
		<section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			{!view.formOpen && view.actionError ? (
				<Banner tone="danger" text={view.actionError} />
			) : null}
			{view.loading ? (
				<Notice text={m.loadingSkills} />
			) : (
				<>
					<div style={panel}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: 8,
							}}
						>
							<p style={{ ...railLabel, margin: 0 }}>{m.custom}</p>
							<button
								type="button"
								style={subtleButton}
								onClick={() => skillsController.startCreate()}
							>
								{m.addCustom}
							</button>
						</div>
						{view.custom.length === 0 ? (
							<p style={{ fontSize: 12, color: palette.inkFaint }}>
								{m.noCustom}
							</p>
						) : (
							<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
								{view.custom.map((skill) => (
									<CustomSkillRow
										key={skill.id}
										skill={skill}
										busy={view.busy}
										m={m}
										onEdit={() => skillsController.startEdit(skill.id)}
										onDelete={() => void skillsController.remove(skill.id)}
										onToggle={(enabled) =>
											void skillsController.setEnabled(skill.id, enabled)
										}
									/>
								))}
							</ul>
						)}
					</div>
					<div style={panel}>
						<p style={railLabel}>{m.builtIn}</p>
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{view.builtIns.map((skill) => (
								<BuiltInSkillRow key={skill.id} skill={skill} m={m} />
							))}
						</ul>
					</div>
				</>
			)}
		</section>
	);
}

/**
 * "Ask AI" / "AIに聞く" screen shell (MIK-045; MIK-048 chat session; MIK-050
 * chat-only layout): the chat-style saved-bookmark recommendation surface.
 * This screen has no left rail and no shared workspace grid — the chat is
 * the primary content, and the shared `chat` frame variant (MIK-053) puts
 * the screen title/subtitle/help in the same centered chat column as the
 * chat body, with the outer page locked so the transcript viewport stays
 * the only scroller. The scope/privacy guidance is exposed through the
 * title-adjacent header help, while the compact {@link AskAiChatContext}
 * keeps the same critical copy at the top of the chat viewport. The
 * conversation state — transcript, Prompt API session, narrowed candidate
 * context — lives only inside the injected {@link AskAiController} and is
 * never persisted.
 */
function AskAiScreen({
	controller,
	m,
	onOpenBookmark,
}: {
	controller: AskAiController;
	m: OptionsMessages;
	/** Route a recommendation card into the existing detail-opening path. */
	onOpenBookmark: (canonicalUrl: string) => void;
}) {
	const view = useSyncExternalStore(
		controller.subscribe,
		controller.getView,
		controller.getView,
	);

	return (
		<ScreenFrame
			variant="chat"
			title={m.askAi}
			subtitle={m.askAiSubtitle}
			helpLabel={m.askAiHelpAria}
			help={<AskAiHelp m={m} />}
			ariaLabel={m.askAiScreenAria}
		>
			<AskAiMain
				view={view}
				m={m}
				controller={controller}
				onOpenBookmark={onOpenBookmark}
			/>
		</ScreenFrame>
	);
}

/**
 * Ask AI header-help guidance (MIK-052): the local-cache scope (never the
 * open web) and non-persistence/privacy notes, discoverable from the screen
 * title. The compact {@link AskAiChatContext} keeps the same critical copy
 * inside the chat viewport.
 */
function AskAiHelp({ m }: { m: OptionsMessages }) {
	return (
		<>
			<p style={railLabel}>{m.askAiAbout}</p>
			<p style={{ margin: 0 }}>{m.askAiScopeNote}</p>
			<p style={{ margin: "6px 0 0" }}>{m.askAiPrivacyNote}</p>
		</>
	);
}

/**
 * Compact Ask AI chat context (MIK-050, slimmed by MIK-051): the scope note
 * (all saved bookmarks from the local cache, never the open web) and the
 * privacy note (short saved-bookmark info only; the chat itself is never
 * saved) as one wrapping inline panel rendered as the first item inside the
 * chat's scrollable viewport, ahead of the welcome state or the transcript.
 * Informational only: cache freshness, the full sync readout, and the sync
 * action live in the shared app-header sync hub.
 */
function AskAiChatContext({ m }: { m: OptionsMessages }) {
	return (
		<section style={askAiChatContext} aria-label={m.askAiAbout}>
			<span>{m.askAiScopeNote}</span>
			<span>{m.askAiPrivacyNote}</span>
		</section>
	);
}

/** How close to the bottom (px) still counts as following the conversation. */
const ASK_AI_AUTO_FOLLOW_THRESHOLD = 16;
/** Scrolled further away than this shows the jump-to-latest button. */
const ASK_AI_SHOW_LATEST_THRESHOLD = 120;
/** Once visible, the button hides only after coming back within this. */
const ASK_AI_HIDE_LATEST_THRESHOLD = 40;

/** The scroll metrics the follow/latest decisions need; lets tests use plain objects. */
export type AskAiViewportMetrics = {
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
};

/** Pixels between the current scroll position and the transcript bottom. */
export function askAiDistanceFromBottom(metrics: AskAiViewportMetrics): number {
	return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

/**
 * Whether new messages should keep auto-scrolling the viewport (MIK-049,
 * sitesurf's ChatArea behavior): following stops as soon as the user is
 * meaningfully away from the bottom. Exported for tests only — pure view
 * logic, no DOM.
 */
export function askAiShouldAutoFollow(distanceFromBottom: number): boolean {
	return distanceFromBottom <= ASK_AI_AUTO_FOLLOW_THRESHOLD;
}

/**
 * Whether the jump-to-latest button is visible, with hysteresis (MIK-049):
 * a hidden button appears only past the higher show threshold, a visible one
 * survives until the user comes back within the lower hide threshold — so it
 * never flickers around one boundary. Exported for tests only.
 */
export function askAiLatestButtonVisible(
	distanceFromBottom: number,
	visible: boolean,
): boolean {
	return visible
		? distanceFromBottom > ASK_AI_HIDE_LATEST_THRESHOLD
		: distanceFromBottom > ASK_AI_SHOW_LATEST_THRESHOLD;
}

/**
 * Ask AI main area (MIK-045, MIK-046, MIK-048; MIK-049 chat layout): the
 * sitesurf-aligned chat surface. The shell is a fixed-height flex column —
 * only the transcript viewport scrolls while the composer stays pinned at the
 * bottom. The viewport opens with the compact {@link AskAiChatContext}
 * cache/scope/privacy cues (MIK-050), scrolling away with the conversation
 * like any other content. Before the first user message the viewport centers
 * the welcome
 * state with localized clickable example prompts; afterwards it renders the
 * full transcript — user turns as right-aligned labeled bubbles, assistant
 * turns through {@link AskAiResult} — plus a chat-like thinking indicator
 * while an answer is in flight. New messages auto-scroll the viewport while
 * the user is near the bottom; scrolling away stops the follow and floats a
 * jump-to-latest button that scrolls back down and resumes following.
 *
 * Chat state lives in the controller's memory and vanishes with the page;
 * scroll follow/latest state is view-only local state. Enter sends,
 * Shift+Enter inserts a newline, IME composition never sends; the composer is
 * disabled while an answer is in flight, with `aria-busy` on the form. The
 * clear-chat button stays inside the pinned composer and hard-resets the
 * conversation (transcript, input, Prompt API session, narrowed context)
 * through {@link AskAiController.clearSession}.
 */
function AskAiMain({
	view,
	m,
	controller,
	onOpenBookmark,
}: {
	view: AskAiView;
	m: OptionsMessages;
	controller: AskAiController;
	onOpenBookmark: (canonicalUrl: string) => void;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	// A ref, not state: follow changes on every scroll event and must never
	// re-render the transcript by itself.
	const autoFollowRef = useRef(true);
	const [showLatest, setShowLatest] = useState(false);

	function scrollToBottom(): void {
		const viewport = viewportRef.current;
		if (viewport) {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
		}
	}

	// New turns (and the thinking indicator) keep the bottom in view while the
	// user is following; a user who scrolled up is never yanked back down.
	// biome-ignore lint/correctness/useExhaustiveDependencies: view.messages/view.answering are the scroll triggers, not hook inputs.
	useEffect(() => {
		if (autoFollowRef.current) {
			scrollToBottom();
		}
	}, [view.messages, view.answering]);

	function handleScroll(): void {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}
		const distance = askAiDistanceFromBottom(viewport);
		autoFollowRef.current = askAiShouldAutoFollow(distance);
		setShowLatest((visible) => askAiLatestButtonVisible(distance, visible));
	}

	function handleLatestClick(): void {
		autoFollowRef.current = true;
		setShowLatest(false);
		scrollToBottom();
	}

	return (
		<section style={askAiChatShell}>
			<div style={askAiViewportShell}>
				<div ref={viewportRef} onScroll={handleScroll} style={askAiViewport}>
					<AskAiChatContext m={m} />
					{view.messages.length === 0 ? (
						<AskAiWelcome m={m} controller={controller} />
					) : (
						<div
							role="log"
							aria-label={m.askAiTranscriptAria}
							style={{ display: "flex", flexDirection: "column", gap: 12 }}
						>
							{view.messages.map((message) =>
								message.role === "user" ? (
									<div key={message.id} style={askAiUserTurn}>
										<p style={askAiTurnLabel}>{m.askAiUserTurnLabel}</p>
										<p style={askAiUserBubble}>{message.text}</p>
									</div>
								) : (
									<div key={message.id} style={askAiAssistantTurn}>
										<p style={askAiTurnLabel}>{m.askAiAssistantTurnLabel}</p>
										<AskAiResult
											result={message.result}
											m={m}
											onOpenBookmark={onOpenBookmark}
										/>
									</div>
								),
							)}
						</div>
					)}
					{view.answering ? <AskAiThinkingIndicator m={m} /> : null}
				</div>
				{showLatest ? (
					<button
						type="button"
						style={askAiLatestButton}
						aria-label={m.askAiLatestAria}
						onClick={handleLatestClick}
					>
						<span aria-hidden>↓</span>
						<span>{m.askAiLatest}</span>
					</button>
				) : null}
			</div>
			<AskAiComposer view={view} m={m} controller={controller} />
		</section>
	);
}

/**
 * Centered welcome/examples landing state before the first message (MIK-049,
 * sitesurf's WelcomeScreen shape): intro copy plus clickable example prompts,
 * vertically centered in the otherwise empty transcript viewport.
 */
function AskAiWelcome({
	m,
	controller,
}: {
	m: OptionsMessages;
	controller: AskAiController;
}) {
	return (
		<div style={askAiWelcome}>
			<p style={{ fontSize: 13, color: palette.inkSoft, margin: 0 }}>
				{m.askAiEmptyIntro}
			</p>
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					justifyContent: "center",
					gap: 6,
				}}
			>
				{m.askAiExamples.map((example) => (
					<button
						key={example}
						type="button"
						style={chip}
						onClick={() => controller.setQuestion(example)}
					>
						{example}
					</button>
				))}
			</div>
		</div>
	);
}

/**
 * Chat-like thinking indicator while an answer is in flight (MIK-049,
 * sitesurf's StreamingIndicator shape): three pulsing dots next to the
 * existing in-flight copy, rendered as an assistant-side row inside the
 * transcript viewport. The pulse keyframes ship inline with the indicator —
 * the project has no CSS tooling — and the dots are decorative; the
 * accessible signal stays the `role="status"` text.
 */
function AskAiThinkingIndicator({ m }: { m: OptionsMessages }) {
	return (
		<div
			role="status"
			style={{ display: "flex", alignItems: "center", gap: 8 }}
		>
			<style>
				{"@keyframes askai-thinking{0%,80%,100%{opacity:.25}40%{opacity:1}}"}
			</style>
			<span aria-hidden style={{ display: "inline-flex", gap: 4 }}>
				{[0, 1, 2].map((dot) => (
					<span
						key={dot}
						style={{
							width: 6,
							height: 6,
							borderRadius: 999,
							background: palette.inkFaint,
							animation: `askai-thinking 1.2s ease-in-out ${dot * 0.16}s infinite`,
						}}
					/>
				))}
			</span>
			<span style={{ fontSize: 12, color: palette.inkSoft }}>
				{m.askAiAnswering}
			</span>
		</div>
	);
}

/**
 * The composer pinned to the bottom of the Ask AI chat shell (MIK-049):
 * unchanged MIK-048 behavior — Enter sends, Shift+Enter newline, IME-safe,
 * disabled while answering with `aria-busy` on the form, and the clear-chat
 * hard reset kept right next to submit.
 */
function AskAiComposer({
	view,
	m,
	controller,
}: {
	view: AskAiView;
	m: OptionsMessages;
	controller: AskAiController;
}) {
	const submitDisabled = !view.canSubmit || view.answering;
	const clearDisabled = !view.canClear;
	return (
		<form
			style={askAiComposer}
			aria-busy={view.answering || undefined}
			onSubmit={(event) => {
				event.preventDefault();
				void controller.submit();
			}}
		>
			<textarea
				style={{ ...searchInput, minHeight: 72, resize: "vertical" }}
				value={view.question}
				placeholder={m.askAiPlaceholder}
				aria-label={m.askAiInputAria}
				disabled={view.answering}
				onChange={(e) => controller.setQuestion(e.target.value)}
				onKeyDown={(event) => {
					if (
						isAskAiComposerSubmitKey({
							key: event.key,
							shiftKey: event.shiftKey,
							isComposing: event.nativeEvent.isComposing,
						})
					) {
						event.preventDefault();
						if (view.canSubmit) {
							void controller.submit();
						}
					}
				}}
			/>
			<div style={{ display: "flex", gap: 8 }}>
				<button
					type="submit"
					style={
						submitDisabled
							? { ...primaryButton, ...disabledButton }
							: primaryButton
					}
					disabled={submitDisabled}
				>
					{m.askAiSubmit}
				</button>
				<button
					type="button"
					style={
						clearDisabled
							? { ...subtleButton, ...disabledButton }
							: subtleButton
					}
					disabled={clearDisabled}
					onClick={() => controller.clearSession()}
				>
					{m.askAiClear}
				</button>
			</div>
		</form>
	);
}

/**
 * The latest Ask AI answer (MIK-046): recommendation cards for an AI or
 * local-fallback answer, or the safe status copy for too-short questions, an
 * empty library, weak candidates, and unexpected errors. Pure projection of
 * the controller's `result` — the localization of status kinds happens here.
 */
function AskAiResult({
	result,
	m,
	onOpenBookmark,
}: {
	result: AskAiResultView;
	m: OptionsMessages;
	onOpenBookmark: (canonicalUrl: string) => void;
}) {
	switch (result.kind) {
		case "too-short-question":
			return <Notice text={m.askAiTooShort} />;
		case "empty-library":
			return <Notice text={m.askAiEmptyLibrary} />;
		case "weak-candidates":
			return <Notice text={m.askAiClarify} />;
		case "error":
			return <Banner tone="danger" text={m.askAiError} />;
		case "recommendations":
			return (
				<section style={panel} aria-label={m.askAiResultsAria}>
					{result.message && result.message.length > 0 ? (
						<p style={{ fontSize: 13, color: palette.ink, margin: 0 }}>
							{result.message}
						</p>
					) : null}
					{result.source === "local" ? (
						<p style={{ fontSize: 12, color: palette.warn, margin: "6px 0 0" }}>
							{m.askAiFallbackNotice}
						</p>
					) : null}
					<ul
						style={{
							listStyle: "none",
							margin: "10px 0 0",
							padding: 0,
							display: "flex",
							flexDirection: "column",
							gap: 8,
						}}
					>
						{result.cards.map((card) => (
							<li key={card.canonicalUrl}>
								<AskAiCard card={card} m={m} onOpen={onOpenBookmark} />
							</li>
						))}
					</ul>
				</section>
			);
	}
}

/**
 * One recommendation card (MIK-046): a single button — keyboard-reachable like
 * the ledger rows — that opens the existing bookmark detail drawer through
 * `controller.select`. Rendered through the shared {@link BookmarkSummaryItem}
 * (MIK-053) — the same summary body (favicon included) as the Library rows —
 * with the card-specific recommendation reason line and no delete action.
 * Shows app-owned bookmark data plus the model or local fallback reason;
 * never a full URL as text (the favicon lookup stays a local render-time
 * Chrome endpoint, MIK-034).
 */
function AskAiCard({
	card,
	m,
	onOpen,
}: {
	card: AskAiCardView;
	m: OptionsMessages;
	onOpen: (canonicalUrl: string) => void;
}) {
	return (
		<BookmarkSummaryItem
			url={card.url}
			title={card.title}
			description={card.description}
			domain={card.domain}
			genre={card.genre}
			tags={card.tags}
			reason={card.reason}
			aiStatus={card.aiStatus}
			openAriaLabel={m.askAiCardAria(card.title)}
			onOpen={() => onOpen(card.canonicalUrl)}
		/>
	);
}

/**
 * Right-drawer wrapper for the custom skill create/edit form (MIK-025;
 * shared {@link Drawer} foundation since MIK-053, replacing the centered
 * modal). Open/close state stays in the controller
 * ({@link SkillsController.startCreate} / `startEdit` open it, `cancelEdit`
 * and a successful `submit` close it); this component only renders the
 * drawer chrome and the collapsible instruction authoring tips under the
 * form.
 */
function SkillFormDrawer({
	view,
	skillsController,
	m,
}: {
	view: SkillsView;
	skillsController: SkillsController;
	m: OptionsMessages;
}) {
	return (
		<Drawer
			labelledBy="skill-form-title"
			onClose={() => skillsController.cancelEdit()}
			header={
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
					}}
				>
					<h3 id="skill-form-title" style={{ fontSize: 15, margin: 0 }}>
						{view.editingId ? m.editSkill : m.newSkill}
					</h3>
					<button
						type="button"
						style={subtleButton}
						onClick={() => skillsController.cancelEdit()}
						aria-label={m.closeSkillFormAria}
					>
						✕
					</button>
				</div>
			}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				{view.actionError ? (
					<Banner tone="danger" text={view.actionError} />
				) : null}
				<SkillForm view={view} skillsController={skillsController} m={m} />
				<InstructionGuidance m={m} />
			</div>
		</Drawer>
	);
}

/**
 * Authoring guidance for the skill `instruction` field (MIK-025): what it
 * changes, per-source examples, safety warnings, and a plain-language
 * explanation of domain/pattern/priority matching. Collapsible tips inside
 * the skill drawer (MIK-053): the guidance title is the always-visible
 * summary; the body discloses on demand so it never dominates the form.
 * Static content — mirrors the constraints in docs/ai-analysis-v2.md and
 * docs/privacy-policy.md.
 */
function InstructionGuidance({ m }: { m: OptionsMessages }) {
	return (
		<details style={drawerTips} aria-label={m.guidance.aria}>
			<summary style={drawerTipsSummary}>{m.guidance.title}</summary>
			<p style={{ margin: "6px 0 0" }}>{m.guidance.intro}</p>
			<p style={{ margin: "8px 0 0", fontWeight: 600, color: palette.ink }}>
				{m.guidance.examplesHeading}
			</p>
			<ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
				{m.guidance.examples.map((example) => (
					<li key={example}>{example}</li>
				))}
			</ul>
			<p style={{ margin: "8px 0 0", fontWeight: 600, color: palette.warn }}>
				{m.guidance.neverHeading}
			</p>
			<ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
				{m.guidance.never.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
			<p style={{ margin: "8px 0 0", fontWeight: 600, color: palette.ink }}>
				{m.guidance.matchingHeading}
			</p>
			<ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
				{m.guidance.matching.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		</details>
	);
}

function BuiltInSkillRow({
	skill,
	m,
}: {
	skill: BuiltInSkillView;
	m: OptionsMessages;
}) {
	return (
		<li
			style={{
				fontSize: 12,
				color: palette.inkSoft,
				padding: "6px 0",
				borderBottom: `1px solid ${palette.border}`,
			}}
		>
			<strong style={{ color: palette.ink }}>{skill.name}</strong>{" "}
			<span style={{ color: palette.inkFaint }}>
				{m.priority(skill.priority)} · {skill.urlPatterns.join(", ")}
			</span>
		</li>
	);
}

function CustomSkillRow({
	skill,
	busy,
	m,
	onEdit,
	onDelete,
	onToggle,
}: {
	skill: CustomSkillRowView;
	busy: boolean;
	m: OptionsMessages;
	onEdit: () => void;
	onDelete: () => void;
	onToggle: (enabled: boolean) => void;
}) {
	return (
		<li
			style={{
				fontSize: 12,
				padding: "6px 0",
				borderBottom: `1px solid ${palette.border}`,
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
				<span style={{ color: palette.ink }}>
					<strong>{skill.name}</strong>{" "}
					<span style={{ color: palette.inkFaint }}>
						{m.priority(skill.priority)}
					</span>
					{!skill.enabled ? (
						<span style={{ color: palette.warn }}> · {m.disabledMark}</span>
					) : null}
				</span>
				<span style={{ display: "flex", gap: 6 }}>
					<button
						type="button"
						style={busy ? { ...subtleButton, ...disabledButton } : subtleButton}
						disabled={busy}
						onClick={() => onToggle(!skill.enabled)}
					>
						{skill.enabled ? m.disable : m.enable}
					</button>
					<button
						type="button"
						style={busy ? { ...subtleButton, ...disabledButton } : subtleButton}
						disabled={busy}
						onClick={onEdit}
					>
						{m.edit}
					</button>
					<button
						type="button"
						style={busy ? { ...dangerButton, ...disabledButton } : dangerButton}
						disabled={busy}
						onClick={onDelete}
					>
						{m.deleteAction}
					</button>
				</span>
			</div>
			{skill.domains.length > 0 || skill.urlPatterns.length > 0 ? (
				<p style={{ margin: "2px 0 0", color: palette.inkFaint }}>
					{[...skill.domains, ...skill.urlPatterns].join(", ")}
				</p>
			) : null}
		</li>
	);
}

function SkillForm({
	view,
	skillsController,
	m,
}: {
	view: SkillsView;
	skillsController: SkillsController;
	m: OptionsMessages;
}) {
	function set<K extends keyof SkillFormValues>(field: K) {
		return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
			skillsController.setFormField(
				field,
				e.target.value as SkillFormValues[K],
			);
	}

	return (
		<form
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}
			onSubmit={(e) => {
				e.preventDefault();
				void skillsController.submit();
			}}
		>
			<label style={{ fontSize: 12 }}>
				{m.formName}
				<input
					style={searchInput}
					value={view.form.name}
					onChange={set("name")}
					required
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				{m.formPriority}
				<input
					style={searchInput}
					type="number"
					value={view.form.priority}
					onChange={set("priority")}
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				{m.formDomains}
				<input
					style={searchInput}
					value={view.form.domains}
					onChange={set("domains")}
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				{m.formUrlPatterns}
				<input
					style={searchInput}
					value={view.form.urlPatterns}
					onChange={set("urlPatterns")}
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				{m.formInstruction}
				<textarea
					style={{ ...searchInput, minHeight: 72, resize: "vertical" }}
					value={view.form.instruction}
					onChange={set("instruction")}
					required
				/>
			</label>
			<div style={{ display: "flex", gap: 8 }}>
				<button
					type="submit"
					style={
						view.busy ? { ...primaryButton, ...disabledButton } : primaryButton
					}
					disabled={view.busy}
				>
					{view.editingId ? m.saveChanges : m.createSkill}
				</button>
				<button
					type="button"
					style={subtleButton}
					onClick={() => skillsController.cancelEdit()}
				>
					{m.cancel}
				</button>
			</div>
		</form>
	);
}

function DetailField({ label, value }: { label: string; value: string }) {
	return (
		<div style={{ marginTop: 10 }}>
			<p style={railLabel}>{label}</p>
			<p style={{ fontSize: 13, margin: 0 }}>{value}</p>
		</div>
	);
}

function TimeRow({ label, value }: { label: string; value: string }) {
	return (
		<div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
			<dt>{label}</dt>
			<dd style={{ margin: 0 }}>{formatTime(value)}</dd>
		</div>
	);
}

function Notice({ text }: { text: string }) {
	return (
		<div
			style={{
				...panel,
				textAlign: "center",
				color: palette.inkSoft,
				fontSize: 13,
			}}
		>
			{text}
		</div>
	);
}

function Banner({ tone, text }: { tone: "danger" | "warn"; text: string }) {
	const color = tone === "danger" ? palette.danger : palette.warn;
	return (
		<div
			role="alert"
			style={{
				border: `1px solid ${color}`,
				borderRadius: 8,
				background: palette.paperRaised,
				color,
				fontSize: 12,
				padding: "8px 12px",
			}}
		>
			{text}
		</div>
	);
}

/**
 * Render an ISO timestamp as a short local date. Display-only formatting; the
 * stored value remains the canonical ISO string from the domain.
 */
function formatTime(iso: string): string {
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) {
		return iso;
	}
	return parsed.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
