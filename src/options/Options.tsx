/**
 * Research Ledger options page (docs/design.md "Options page: Research Ledger").
 *
 * A pure projection of {@link OptionsController.getView} with two top-level
 * screens behind a small nav (MIK-025): the Library — the two-zone ledger
 * (left rail with search, sync state, genre/tag/status filters; center
 * bookmark rows with per-row quick delete) plus a floating Drive sync action
 * and a detail side sheet overlay (MIK-022, MIK-024) — and the Analysis
 * skills settings screen, where the custom skill create/edit form opens as a
 * modal with authoring guidance. It dispatches user intent back through the
 * controllers and imports only the controllers, view types, style tokens, and
 * the pure profile-display resolver (MIK-031); no Drive client, Prompt API
 * client, JSONL parser, or merge internals appear here (AGENTS.md
 * "Architecture boundaries"). All wiring is injected via the
 * `controller`/`skillsController` props, so the component is trivially
 * renderable with fakes in tests.
 */
import type { ChangeEvent } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
	type AnalysisProfileDisplay,
	resolveAnalysisProfileDisplay,
} from "../lib/ai/index";
import { type SupportedLanguage, detectUiLanguage } from "../lib/i18n/index";
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
import type { AiStatus } from "./view-types";
import {
	aiStatusTone,
	appHeader,
	chip,
	chipActive,
	dangerButton,
	disabledButton,
	floatingSyncButton,
	guidanceBox,
	ledger,
	modalBackdrop,
	modalBody,
	modalCard,
	modalHeader,
	navTab,
	navTabActive,
	page,
	palette,
	panel,
	primaryButton,
	profileEditButton,
	rail,
	railLabel,
	row as rowStyle,
	rowDeleteButton,
	rowOpenButton,
	rowSelected,
	searchInput,
	settingsScreen,
	sheet,
	sheetBackdrop,
	sheetBody,
	sheetFooter,
	sheetFullscreen,
	sheetHeader,
	statusColor,
	subtleButton,
	summaryClamp,
	syncTone,
	tagListExpanded,
	truncate,
} from "./styles";

/**
 * The two top-level options screens (MIK-025). Presentation-only UI state:
 * switching screens never touches Drive/cache semantics.
 */
export type OptionsScreen = "library" | "analysis-skills";

// Stable no-op store bindings so the optional skills-view subscription can be
// called unconditionally (hooks may not be conditional) when no skills
// controller is provided.
const noSkillsSubscribe = () => () => {};
const noSkillsView = () => undefined;

export function Options({
	controller,
	skillsController,
	initialScreen = "library",
	language,
}: {
	controller: OptionsController;
	/** Optional so existing tests/embeds can render without the skills screen. */
	skillsController?: SkillsController;
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

	const showLibrary = screen === "library" || !skillsController;

	return (
		<main style={page}>
			{skillsController ? (
				<header style={appHeader}>
					<nav aria-label={m.navAria} style={{ display: "flex", gap: 8 }}>
						<NavTab
							label={m.library}
							active={showLibrary}
							onClick={() => switchScreen("library")}
						/>
						<NavTab
							label={m.analysisSkills}
							active={!showLibrary}
							onClick={() => switchScreen("analysis-skills")}
						/>
					</nav>
				</header>
			) : null}
			{showLibrary ? (
				<>
					<div style={ledger}>
						<LeftRail view={view} m={m} controller={controller} />
						<CenterList view={view} m={m} controller={controller} />
					</div>
					<FloatingSyncButton
						sync={view.sync}
						loading={view.loading}
						m={m}
						onRefresh={() => void controller.refresh()}
					/>
					{view.selected ? (
						<DetailSheet
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
				</>
			) : skillsController ? (
				<SkillsScreen skillsController={skillsController} m={m} />
			) : null}
		</main>
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
			<header>
				<h1 style={{ fontSize: 18, margin: "0 0 2px" }}>Bookmark AI</h1>
				<p style={{ fontSize: 11, margin: 0, color: palette.inkFaint }}>
					{m.researchLedger}
				</p>
			</header>

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

			<SyncPanel sync={view.sync} loading={view.loading} m={m} />

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

/**
 * Left-rail Drive sync status readout (MIK-024): status, pending changes, last
 * synced time, and safe errors stay visible here, but the sync action itself
 * moved to {@link FloatingSyncButton} so the rail stays compact. In-flight
 * loading/syncing/writing progress renders as an explicit line (MIK-026).
 */
function SyncPanel({
	sync,
	loading,
	m,
}: {
	sync: SyncView;
	loading: boolean;
	m: OptionsMessages;
}) {
	const progress = syncProgressText(sync, loading, m);
	return (
		<section style={panel}>
			<p style={railLabel}>{m.driveSync}</p>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<span
					aria-hidden
					style={{
						width: 8,
						height: 8,
						borderRadius: 999,
						background: statusColor(syncTone(sync.status)),
					}}
				/>
				<span style={{ fontSize: 13 }}>{sync.status}</span>
			</div>
			{progress ? (
				<p
					role="status"
					style={{ fontSize: 12, color: palette.inkSoft, margin: "6px 0 0" }}
				>
					{progress}
				</p>
			) : null}
			{sync.pendingLocalChanges ? (
				<p style={{ fontSize: 12, color: palette.warn, margin: "6px 0 0" }}>
					{m.pendingLocal}
				</p>
			) : null}
			{sync.lastSyncedAt ? (
				<p style={{ fontSize: 11, color: palette.inkFaint, margin: "4px 0 0" }}>
					{m.lastSynced(formatTime(sync.lastSyncedAt))}
				</p>
			) : null}
			{sync.error ? (
				<p style={{ fontSize: 12, color: palette.danger, margin: "6px 0 0" }}>
					{sync.error}
				</p>
			) : null}
		</section>
	);
}

/**
 * Floating Drive sync action (MIK-024): the always-reachable replacement for
 * the old rail "Sync now" button. Shows the current sync tone/status and
 * dispatches the existing {@link OptionsController.refresh}. While the cache
 * is loading or a Drive pull/write is in flight the button is disabled and
 * reads what is happening, so a slow sync can never be double-clicked into a
 * second one (MIK-026; the controller drops duplicates too).
 */
function FloatingSyncButton({
	sync,
	loading,
	m,
	onRefresh,
}: {
	sync: SyncView;
	loading: boolean;
	m: OptionsMessages;
	onRefresh: () => void;
}) {
	const inFlight = loading || sync.syncing || sync.writing;
	const detail = loading
		? m.syncDetail.loading
		: sync.syncing
			? m.syncDetail.syncing
			: sync.writing
				? m.syncDetail.writing
				: sync.status;
	return (
		<button
			type="button"
			style={
				inFlight
					? { ...floatingSyncButton, ...disabledButton }
					: floatingSyncButton
			}
			disabled={inFlight}
			aria-busy={inFlight || undefined}
			onClick={onRefresh}
			aria-label={m.syncAria}
		>
			<span
				aria-hidden
				style={{
					width: 8,
					height: 8,
					borderRadius: 999,
					background: statusColor(syncTone(sync.status)),
				}}
			/>
			<span>{m.syncButton}</span>
			<span style={{ fontSize: 11, fontWeight: 400, color: palette.inkFaint }}>
				{detail}
			</span>
		</button>
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
 * One labeled chip group inside the Filters panel (MIK-028): a facet
 * subsection with single-select toggle chips and — for growable facets — the
 * capped list behind a `Show all N` toggle. Grouping every facet through this
 * one shape is what keeps the rail structured instead of scattered.
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
}) {
	// Expansion is view-only UI state; it never touches the controller.
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
			<p style={railLabel}>{label}</p>
			<div
				style={
					expanded
						? { display: "flex", flexWrap: "wrap", gap: 6, ...tagListExpanded }
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
		</div>
	);
}

/**
 * The single Filters panel (MIK-028): Domain, Genre, Tags, and AI status as
 * uniform subsections in one card, replacing the scattered per-facet blocks.
 * Domain and Tags can grow without bound, so they collapse behind the shared
 * facet cap; Genre and AI status stay small and render fully.
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
			/>
			<FacetGroup
				label={m.genre}
				values={facets.genres}
				active={filters.genre}
				m={m}
				onToggle={(genre) => controller.setGenre(genre)}
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
 * sheet, and the selected highlight only reflects the currently open sheet
 * (MIK-022). The summary gets two clamped lines now that the right pane is
 * gone; genre/tags/profile stay as compact metadata under it.
 *
 * The row container is a flex `<div>` (not a `<button>`) so the quick delete
 * button can legally live inside it (MIK-024): the main content stays a real
 * button for keyboard users (its Enter/Space click bubbles to the container's
 * select handler), while quick delete stops propagation so deleting never
 * opens the sheet.
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
		<div style={row.selected ? rowSelected : rowStyle} onClick={onSelect}>
			{/* Decorative site icon (MIK-032); the row's accessible text is the
			    title/summary button next to it. marginTop aligns it with the
			    first title line in this flex-start row. Looked up by the original
			    visited URL, not the canonical form (MIK-034). */}
			<span style={{ marginTop: 1 }}>
				<Favicon pageUrl={row.url} size={22} />
			</span>
			<button type="button" style={rowOpenButton} aria-expanded={row.selected}>
				<div style={{ fontSize: 14, fontWeight: 600, ...truncate }}>
					{row.title}
				</div>
				<div
					style={{
						fontSize: 12,
						color: palette.inkSoft,
						marginTop: 2,
						...summaryClamp,
					}}
				>
					{row.summary}
				</div>
				{row.genre || row.tags.length > 0 || row.analysisProfileId ? (
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: 6,
							marginTop: 5,
							alignItems: "center",
						}}
					>
						{row.genre ? (
							<span style={{ fontSize: 11, color: palette.accent }}>
								{row.genre}
							</span>
						) : null}
						{row.tags.slice(0, 4).map((t) => (
							<span key={t} style={{ fontSize: 11, color: palette.inkFaint }}>
								#{t}
							</span>
						))}
						{row.analysisProfileId ? (
							<span style={{ fontSize: 11, color: palette.inkFaint }}>
								· {row.analysisProfileId}
							</span>
						) : null}
					</div>
				) : null}
			</button>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
					gap: 4,
				}}
			>
				<StatusPill status={row.aiStatus} />
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
						// Quick delete must never open the detail sheet behind it.
						event.stopPropagation();
						onDelete();
					}}
				>
					✕
				</button>
			</div>
		</div>
	);
}

/** Media query below which the detail sheet goes fullscreen. */
const NARROW_VIEWPORT_QUERY = "(max-width: 720px)";

function subscribeToNarrowViewport(onChange: () => void): () => void {
	const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

/**
 * Whether the viewport is too narrow for a partial-width side sheet. Options-
 * local by design; the server snapshot (`false`) only matters for static
 * rendering in tests.
 */
function useIsNarrowViewport(): boolean {
	return useSyncExternalStore(
		subscribeToNarrowViewport,
		() => window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
		() => false,
	);
}

/**
 * The row-click detail side sheet (MIK-022): the single reading surface for a
 * bookmark's full detail and its long-form `analysisMarkdown`. Closes via the
 * Close buttons, Escape, and backdrop click — closing only clears the
 * selection, never the filters. Actions are Open, Delete, and Close only; the
 * sheet is a reading/deletion surface and no longer offers Re-analyze
 * (MIK-024 — a later explicit flow owns re-analysis). While an action is busy
 * Delete is disabled but Open and Close stay available, and Delete closes the
 * sheet once the record disappears (the controller drops the selection).
 *
 * The profile label shows the resolved display name (MIK-031): a custom
 * profile renders as a button that opens its edit modal via
 * `onEditCustomProfile`; built-in and unknown profiles render as read-only
 * text (unknown falls back to the raw id).
 */
function DetailSheet({
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
	const isNarrow = useIsNarrowViewport();

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				controller.clearSelection();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [controller]);

	return (
		<div
			style={sheetBackdrop}
			onClick={(event) => {
				// Only a true backdrop click closes; clicks inside the sheet bubble up
				// with a different target and are ignored.
				if (event.target === event.currentTarget) {
					controller.clearSelection();
				}
			}}
		>
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby="bookmark-detail-title"
				style={isNarrow ? sheetFullscreen : sheet}
			>
				<header style={sheetHeader}>
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
							// Best-effort focus management: land keyboard focus inside the
							// dialog when it opens.
							autoFocus
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
						{/* Keyed by URL: the sheet swaps records in place, so a failed
						    favicon for one site must not stick to the next (MIK-032). */}
						<Favicon key={detail.canonicalUrl} pageUrl={detail.url} size={28} />
						<h2 id="bookmark-detail-title" style={{ fontSize: 17, margin: 0 }}>
							{detail.title}
						</h2>
					</div>
					<a
						href={detail.url}
						target="_blank"
						rel="noreferrer"
						style={{
							fontSize: 12,
							color: palette.accent,
							wordBreak: "break-all",
						}}
					>
						{detail.url}
					</a>
				</header>

				<div style={sheetBody}>
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
									<span
										key={t}
										style={{ fontSize: 12, color: palette.inkSoft }}
									>
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
				</div>

				<footer style={sheetFooter}>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
						<a
							href={detail.url}
							target="_blank"
							rel="noreferrer"
							style={primaryButton}
						>
							{m.open}
						</a>
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
				</footer>
			</section>
		</div>
	);
}

/**
 * "Analysis skills" settings screen (MIK-018, MIK-025,
 * docs/ai-analysis-v2.md "Settings file"): a pure projection of
 * {@link SkillsController.getView}, rendered as its own top-level screen
 * instead of a panel below the ledger. Shows the settings sync readout, the
 * fixed built-in profiles read-only, and full CRUD over Drive-synced custom
 * skills; the create/edit form opens as a modal. Never computes
 * matching/priority itself — that stays inside `ai/profile.ts`'s
 * `selectAnalysisProfile`.
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
		<section style={settingsScreen} aria-label={m.skillsScreenAria}>
			<header>
				<h2 style={{ fontSize: 18, margin: 0 }}>{m.analysisSkills}</h2>
				<p style={{ fontSize: 12, color: palette.inkSoft, margin: "4px 0 0" }}>
					{m.skillsIntro.before}
					<code>bookmark-ai/settings.json</code>
					{m.skillsIntro.after}
				</p>
			</header>

			<section style={panel}>
				<p style={railLabel}>{m.settingsSync}</p>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						aria-hidden
						style={{
							width: 8,
							height: 8,
							borderRadius: 999,
							background: statusColor(syncTone(view.sync.status)),
						}}
					/>
					<span style={{ fontSize: 13 }}>{view.sync.status}</span>
					<button
						type="button"
						style={
							view.busy ? { ...subtleButton, ...disabledButton } : subtleButton
						}
						disabled={view.busy}
						onClick={() => void skillsController.refresh()}
					>
						{m.refreshSettings}
					</button>
				</div>
				{view.sync.pendingLocalChanges ? (
					<p style={{ fontSize: 12, color: palette.warn, margin: "6px 0 0" }}>
						{m.pendingLocal}
					</p>
				) : null}
			</section>

			{!view.formOpen && view.actionError ? (
				<Banner tone="danger" text={view.actionError} />
			) : null}

			{view.loading ? (
				<Notice text={m.loadingSkills} />
			) : (
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: 16,
					}}
				>
					<div style={panel}>
						<p style={railLabel}>{m.builtIn}</p>
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{view.builtIns.map((skill) => (
								<BuiltInSkillRow key={skill.id} skill={skill} m={m} />
							))}
						</ul>
					</div>
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
				</div>
			)}

			{view.formOpen ? (
				<SkillFormModal view={view} skillsController={skillsController} m={m} />
			) : null}
		</section>
	);
}

/**
 * Modal wrapper for the custom skill create/edit form (MIK-025). Open/close
 * state stays in the controller ({@link SkillsController.startCreate} /
 * `startEdit` open it, `cancelEdit` and a successful `submit` close it); this
 * component only renders the dialog chrome, Escape/backdrop close, and the
 * instruction authoring guidance next to the form.
 */
function SkillFormModal({
	view,
	skillsController,
	m,
}: {
	view: SkillsView;
	skillsController: SkillsController;
	m: OptionsMessages;
}) {
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				skillsController.cancelEdit();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [skillsController]);

	return (
		<div
			style={modalBackdrop}
			onClick={(event) => {
				// Only a true backdrop click closes; clicks inside the card bubble up
				// with a different target and are ignored.
				if (event.target === event.currentTarget) {
					skillsController.cancelEdit();
				}
			}}
		>
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby="skill-form-title"
				style={modalCard}
			>
				<header style={modalHeader}>
					<h3 id="skill-form-title" style={{ fontSize: 15, margin: 0 }}>
						{view.editingId ? m.editSkill : m.newSkill}
					</h3>
					<button
						type="button"
						style={subtleButton}
						onClick={() => skillsController.cancelEdit()}
						aria-label={m.closeSkillFormAria}
						// Best-effort focus management: land keyboard focus inside the
						// dialog when it opens.
						autoFocus
					>
						✕
					</button>
				</header>
				<div style={modalBody}>
					{view.actionError ? (
						<Banner tone="danger" text={view.actionError} />
					) : null}
					<SkillForm view={view} skillsController={skillsController} m={m} />
					<InstructionGuidance m={m} />
				</div>
			</section>
		</div>
	);
}

/**
 * Authoring guidance for the skill `instruction` field (MIK-025): what it
 * changes, per-source examples, safety warnings, and a plain-language
 * explanation of domain/pattern/priority matching. Static content — mirrors
 * the constraints in docs/ai-analysis-v2.md and docs/privacy-policy.md.
 */
function InstructionGuidance({ m }: { m: OptionsMessages }) {
	return (
		<aside style={guidanceBox} aria-label={m.guidance.aria}>
			<p style={{ margin: 0, fontWeight: 600, color: palette.ink }}>
				{m.guidance.title}
			</p>
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
		</aside>
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

function StatusPill({ status }: { status: AiStatus }) {
	return (
		<span
			style={{
				fontSize: 10,
				textTransform: "uppercase",
				letterSpacing: 0.5,
				color: statusColor(aiStatusTone(status)),
				border: `1px solid ${palette.border}`,
				borderRadius: 6,
				padding: "1px 6px",
				whiteSpace: "nowrap",
			}}
		>
			{status}
		</span>
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
