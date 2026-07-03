/**
 * Research Ledger options page (docs/design.md "Options page: Research Ledger").
 *
 * A pure projection of {@link OptionsController.getView}: it renders the
 * two-zone ledger — left rail (search, sync state, genre/tag/status filters)
 * and the center bookmark rows with per-row quick delete — plus a floating
 * Drive sync action and a detail side sheet overlay that a row click opens
 * with open/delete actions (MIK-022, MIK-024). It dispatches
 * user intent back through the controller and imports only the controller,
 * view types, and style tokens; no Drive client, Prompt API client, JSONL
 * parser, or merge internals appear here (AGENTS.md "Architecture
 * boundaries"). All wiring is injected via the `controller` prop, so the
 * component is trivially renderable with a fake in tests.
 */
import type { ChangeEvent } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";

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
	chip,
	chipActive,
	dangerButton,
	disabledButton,
	floatingSyncButton,
	ledger,
	page,
	palette,
	panel,
	primaryButton,
	rail,
	railLabel,
	row as rowStyle,
	rowDeleteButton,
	rowOpenButton,
	rowSelected,
	searchInput,
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

export function Options({
	controller,
	skillsController,
}: {
	controller: OptionsController;
	/** Optional so existing tests/embeds can render without the skills panel. */
	skillsController?: SkillsController;
}) {
	const view = useSyncExternalStore(
		controller.subscribe,
		controller.getView,
		controller.getView,
	);

	useEffect(() => {
		void controller.init();
	}, [controller]);

	useLockBodyScroll(view.selected !== undefined);

	return (
		<main style={page}>
			<div style={ledger}>
				<LeftRail view={view} controller={controller} />
				<CenterList view={view} controller={controller} />
			</div>
			<FloatingSyncButton
				sync={view.sync}
				onRefresh={() => void controller.refresh()}
			/>
			{view.selected ? (
				<DetailSheet
					detail={view.selected}
					busy={view.busy}
					controller={controller}
				/>
			) : null}
			{skillsController ? (
				<SkillsSection skillsController={skillsController} />
			) : null}
		</main>
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
	controller,
}: {
	view: OptionsView;
	controller: OptionsController;
}) {
	const hasFilters =
		view.filters.query.length > 0 ||
		view.filters.genre !== undefined ||
		view.filters.tag !== undefined ||
		view.filters.aiStatus !== undefined;

	return (
		<aside style={rail}>
			<header>
				<h1 style={{ fontSize: 18, margin: "0 0 2px" }}>Bookmark AI</h1>
				<p style={{ fontSize: 11, margin: 0, color: palette.inkFaint }}>
					Research Ledger
				</p>
			</header>

			<section style={panel}>
				<p style={railLabel}>Search</p>
				<input
					type="search"
					value={view.filters.query}
					placeholder="Title, URL, summary, tags…"
					onChange={(e) => controller.setQuery(e.target.value)}
					style={searchInput}
					aria-label="Search bookmarks"
				/>
				<p style={{ fontSize: 11, color: palette.inkFaint, margin: "8px 0 0" }}>
					{view.filteredCount} of {view.totalCount} shown
				</p>
				{hasFilters ? (
					<button
						type="button"
						style={{ ...subtleButton, marginTop: 8 }}
						onClick={() => controller.clearFilters()}
					>
						Clear filters
					</button>
				) : null}
			</section>

			<SyncPanel sync={view.sync} />

			<FilterFacets
				facets={view.facets}
				filters={view.filters}
				controller={controller}
			/>
		</aside>
	);
}

/**
 * Left-rail Drive sync status readout (MIK-024): status, pending changes, last
 * synced time, and safe errors stay visible here, but the sync action itself
 * moved to {@link FloatingSyncButton} so the rail stays compact.
 */
function SyncPanel({ sync }: { sync: SyncView }) {
	return (
		<section style={panel}>
			<p style={railLabel}>Drive sync</p>
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
			{sync.pendingLocalChanges ? (
				<p style={{ fontSize: 12, color: palette.warn, margin: "6px 0 0" }}>
					Local changes pending — will retry on next sync
				</p>
			) : null}
			{sync.lastSyncedAt ? (
				<p style={{ fontSize: 11, color: palette.inkFaint, margin: "4px 0 0" }}>
					Last synced {formatTime(sync.lastSyncedAt)}
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
 * dispatches the existing {@link OptionsController.refresh} — no new sync
 * semantics (MIK-026 owns richer progress states).
 */
function FloatingSyncButton({
	sync,
	onRefresh,
}: {
	sync: SyncView;
	onRefresh: () => void;
}) {
	return (
		<button
			type="button"
			style={floatingSyncButton}
			onClick={onRefresh}
			aria-label="Sync with Google Drive"
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
			<span>Sync Drive</span>
			<span style={{ fontSize: 11, fontWeight: 400, color: palette.inkFaint }}>
				{sync.status}
			</span>
		</button>
	);
}

/** How many tag chips the rail shows before collapsing behind "Show all". */
const TAG_FACET_CAP = 12;

/**
 * The tags to render given the expansion state (MIK-024): collapsed shows the
 * first {@link TAG_FACET_CAP} chips, but the active tag filter always stays
 * visible so a filter picked while expanded never disappears on collapse.
 * Exported for tests only — view logic, no controller state.
 */
export function visibleTagFacets(
	tags: readonly string[],
	activeTag: string | undefined,
	expanded: boolean,
): readonly string[] {
	if (expanded || tags.length <= TAG_FACET_CAP) {
		return tags;
	}
	const capped = tags.slice(0, TAG_FACET_CAP);
	if (activeTag !== undefined && !capped.includes(activeTag)) {
		capped.push(activeTag);
	}
	return capped;
}

function FilterFacets({
	facets,
	filters,
	controller,
}: {
	facets: FacetsView;
	filters: FiltersView;
	controller: OptionsController;
}) {
	// Expansion is view-only UI state; it never touches the controller.
	const [tagsExpanded, setTagsExpanded] = useState(false);
	const tags = visibleTagFacets(facets.tags, filters.tag, tagsExpanded);
	const overflowCount = facets.tags.length - TAG_FACET_CAP;

	return (
		<section style={panel}>
			<p style={railLabel}>AI status</p>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{facets.statuses.map((status) => (
					<button
						key={status}
						type="button"
						style={filters.aiStatus === status ? chipActive : chip}
						onClick={() =>
							controller.setStatus(
								filters.aiStatus === status ? undefined : status,
							)
						}
					>
						{status}
					</button>
				))}
			</div>

			{facets.genres.length > 0 ? (
				<>
					<p style={{ ...railLabel, marginTop: 14 }}>Genre</p>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{facets.genres.map((genre) => (
							<button
								key={genre}
								type="button"
								style={filters.genre === genre ? chipActive : chip}
								onClick={() =>
									controller.setGenre(
										filters.genre === genre ? undefined : genre,
									)
								}
							>
								{genre}
							</button>
						))}
					</div>
				</>
			) : null}

			{facets.tags.length > 0 ? (
				<>
					<p style={{ ...railLabel, marginTop: 14 }}>Tags</p>
					<div
						style={
							tagsExpanded
								? {
										display: "flex",
										flexWrap: "wrap",
										gap: 6,
										...tagListExpanded,
									}
								: { display: "flex", flexWrap: "wrap", gap: 6 }
						}
					>
						{tags.map((tag) => (
							<button
								key={tag}
								type="button"
								style={filters.tag === tag ? chipActive : chip}
								onClick={() =>
									controller.setTag(filters.tag === tag ? undefined : tag)
								}
							>
								#{tag}
							</button>
						))}
					</div>
					{overflowCount > 0 ? (
						<button
							type="button"
							style={{ ...subtleButton, marginTop: 8 }}
							onClick={() => setTagsExpanded((expanded) => !expanded)}
						>
							{tagsExpanded
								? "Show fewer tags"
								: `Show all ${facets.tags.length} tags`}
						</button>
					) : null}
				</>
			) : null}
		</section>
	);
}

function CenterList({
	view,
	controller,
}: {
	view: OptionsView;
	controller: OptionsController;
}) {
	if (view.loading) {
		return (
			<section>
				<Notice text="Loading your library…" />
			</section>
		);
	}
	if (view.empty) {
		return (
			<section>
				<Notice text="No bookmarks yet. Save the current tab from the popup to start your ledger." />
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
				<Notice text="No bookmarks match the current search and filters." />
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
	onSelect,
	onDelete,
}: {
	row: RowView;
	busy: boolean;
	onSelect: () => void;
	onDelete: () => void;
}) {
	return (
		<div style={row.selected ? rowSelected : rowStyle} onClick={onSelect}>
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
					aria-label={`Delete ${row.title}`}
					title="Delete bookmark"
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
 */
function DetailSheet({
	detail,
	busy,
	controller,
}: {
	detail: DetailView;
	busy: boolean;
	controller: OptionsController;
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
							aria-label="Close details"
							// Best-effort focus management: land keyboard focus inside the
							// dialog when it opens.
							autoFocus
						>
							✕
						</button>
					</div>
					<h2
						id="bookmark-detail-title"
						style={{ fontSize: 17, margin: "6px 0 4px" }}
					>
						{detail.title}
					</h2>
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
								? "AI analysis has not finished for this bookmark yet."
								: "No AI description yet."}
						</p>
					)}

					{detail.genre ? (
						<DetailField label="Genre" value={detail.genre} />
					) : null}

					{detail.analysisProfileId ? (
						<DetailField label="Profile" value={detail.analysisProfileId} />
					) : null}

					{detail.tags.length > 0 ? (
						<div style={{ marginTop: 10 }}>
							<p style={railLabel}>Tags</p>
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
							<p style={railLabel}>Analysis</p>
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
						<TimeRow label="Created" value={detail.createdAt} />
						<TimeRow label="Updated" value={detail.updatedAt} />
						{detail.lastAnalyzedAt ? (
							<TimeRow label="Analyzed" value={detail.lastAnalyzedAt} />
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
							Open
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
							Delete
						</button>
						<button
							type="button"
							style={subtleButton}
							onClick={() => controller.clearSelection()}
						>
							Close
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
							Working — keep this page open until it finishes.
						</p>
					) : null}
				</footer>
			</section>
		</div>
	);
}

/**
 * "Analysis skills" panel (MIK-018, docs/ai-analysis-v2.md "Settings file"): a
 * pure projection of {@link SkillsController.getView}. Shows the fixed
 * built-in profiles read-only, plus full CRUD over Drive-synced custom
 * skills. Never computes matching/priority itself — that stays inside
 * `ai/profile.ts`'s `selectAnalysisProfile`.
 */
function SkillsSection({
	skillsController,
}: {
	skillsController: SkillsController;
}) {
	const view = useSyncExternalStore(
		skillsController.subscribe,
		skillsController.getView,
	);

	useEffect(() => {
		void skillsController.init();
	}, [skillsController]);

	return (
		<section
			style={{
				maxWidth: 1200,
				margin: "0 auto",
				padding: "0 24px 32px",
			}}
		>
			<div style={panel}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: 10,
					}}
				>
					<h2 style={{ fontSize: 15, margin: 0 }}>Analysis skills</h2>
					{!view.formOpen ? (
						<button
							type="button"
							style={subtleButton}
							onClick={() => skillsController.startCreate()}
						>
							Add custom skill
						</button>
					) : null}
				</div>

				{view.actionError ? (
					<p
						style={{ fontSize: 12, color: palette.danger, margin: "0 0 10px" }}
					>
						{view.actionError}
					</p>
				) : null}

				{view.formOpen ? (
					<SkillForm view={view} skillsController={skillsController} />
				) : null}

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: 16,
						marginTop: 14,
					}}
				>
					<div>
						<p style={railLabel}>Built-in (read-only)</p>
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{view.builtIns.map((skill) => (
								<BuiltInSkillRow key={skill.id} skill={skill} />
							))}
						</ul>
					</div>
					<div>
						<p style={railLabel}>Custom (Drive-synced)</p>
						{view.custom.length === 0 ? (
							<p style={{ fontSize: 12, color: palette.inkFaint }}>
								No custom skills yet.
							</p>
						) : (
							<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
								{view.custom.map((skill) => (
									<CustomSkillRow
										key={skill.id}
										skill={skill}
										busy={view.busy}
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
			</div>
		</section>
	);
}

function BuiltInSkillRow({ skill }: { skill: BuiltInSkillView }) {
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
				priority {skill.priority} · {skill.urlPatterns.join(", ")}
			</span>
		</li>
	);
}

function CustomSkillRow({
	skill,
	busy,
	onEdit,
	onDelete,
	onToggle,
}: {
	skill: CustomSkillRowView;
	busy: boolean;
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
						priority {skill.priority}
					</span>
					{!skill.enabled ? (
						<span style={{ color: palette.warn }}> · disabled</span>
					) : null}
				</span>
				<span style={{ display: "flex", gap: 6 }}>
					<button
						type="button"
						style={busy ? { ...subtleButton, ...disabledButton } : subtleButton}
						disabled={busy}
						onClick={() => onToggle(!skill.enabled)}
					>
						{skill.enabled ? "Disable" : "Enable"}
					</button>
					<button
						type="button"
						style={busy ? { ...subtleButton, ...disabledButton } : subtleButton}
						disabled={busy}
						onClick={onEdit}
					>
						Edit
					</button>
					<button
						type="button"
						style={busy ? { ...dangerButton, ...disabledButton } : dangerButton}
						disabled={busy}
						onClick={onDelete}
					>
						Delete
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
}: {
	view: SkillsView;
	skillsController: SkillsController;
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
				...panel,
				background: palette.paperInset,
				marginBottom: 4,
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}
			onSubmit={(e) => {
				e.preventDefault();
				void skillsController.submit();
			}}
		>
			<p style={railLabel}>
				{view.editingId ? "Edit custom skill" : "New custom skill"}
			</p>
			<label style={{ fontSize: 12 }}>
				Name
				<input
					style={searchInput}
					value={view.form.name}
					onChange={set("name")}
					required
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				Priority
				<input
					style={searchInput}
					type="number"
					value={view.form.priority}
					onChange={set("priority")}
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				Domains (comma-separated, e.g. github.com)
				<input
					style={searchInput}
					value={view.form.domains}
					onChange={set("domains")}
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				URL patterns (comma-separated, `*` wildcard, e.g. example.com/docs/*)
				<input
					style={searchInput}
					value={view.form.urlPatterns}
					onChange={set("urlPatterns")}
				/>
			</label>
			<label style={{ fontSize: 12 }}>
				Instruction
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
					{view.editingId ? "Save changes" : "Create skill"}
				</button>
				<button
					type="button"
					style={subtleButton}
					onClick={() => skillsController.cancelEdit()}
				>
					Cancel
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
