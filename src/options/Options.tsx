/**
 * Research Ledger options page (docs/design.md "Options page: Research Ledger").
 *
 * A pure projection of {@link OptionsController.getView}: it renders the
 * three-pane ledger — left rail (search, sync state, genre/tag/status filters),
 * center bookmark rows, right detail pane with open/delete/re-analyze actions —
 * and dispatches user intent back through the controller. It imports only the
 * controller, view types, and style tokens; no Drive client, Prompt API client,
 * JSONL parser, or merge internals appear here (AGENTS.md "Architecture
 * boundaries"). All wiring is injected via the `controller` prop, so the
 * component is trivially renderable with a fake in tests.
 */
import { useEffect, useSyncExternalStore } from "react";

import type {
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
	ledger,
	page,
	palette,
	panel,
	primaryButton,
	rail,
	railLabel,
	row as rowStyle,
	rowSelected,
	searchInput,
	statusColor,
	subtleButton,
	syncTone,
	truncate,
} from "./styles";

export function Options({ controller }: { controller: OptionsController }) {
	const view = useSyncExternalStore(controller.subscribe, controller.getView);

	useEffect(() => {
		void controller.init();
	}, [controller]);

	return (
		<main style={page}>
			<div style={ledger}>
				<LeftRail view={view} controller={controller} />
				<CenterList view={view} controller={controller} />
				<DetailPane view={view} controller={controller} />
			</div>
		</main>
	);
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

			<SyncPanel sync={view.sync} onRefresh={() => void controller.refresh()} />

			<FilterFacets
				facets={view.facets}
				filters={view.filters}
				controller={controller}
			/>
		</aside>
	);
}

function SyncPanel({
	sync,
	onRefresh,
}: {
	sync: SyncView;
	onRefresh: () => void;
}) {
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
			<button
				type="button"
				style={{ ...subtleButton, marginTop: 8 }}
				onClick={onRefresh}
			>
				Sync now
			</button>
		</section>
	);
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
									controller.setGenre(filters.genre === genre ? undefined : genre)
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
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{facets.tags.map((tag) => (
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
				<Notice
					text="No bookmarks yet. Save the current tab from the popup to start your ledger."
				/>
			</section>
		);
	}
	if (view.noMatches) {
		return (
			<section>
				<Notice text="No bookmarks match the current search and filters." />
			</section>
		);
	}
	return (
		<section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			{view.actionError ? <Banner tone="danger" text={view.actionError} /> : null}
			{view.actionNotice ? <Banner tone="warn" text={view.actionNotice} /> : null}
			<ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
				{view.rows.map((item) => (
					<li key={item.canonicalUrl}>
						<LedgerRow row={item} onSelect={() => controller.select(item.canonicalUrl)} />
					</li>
				))}
			</ul>
		</section>
	);
}

function LedgerRow({ row, onSelect }: { row: RowView; onSelect: () => void }) {
	return (
		<button type="button" style={row.selected ? rowSelected : rowStyle} onClick={onSelect}>
			<div style={{ minWidth: 0, flex: 1 }}>
				<div style={{ fontSize: 14, fontWeight: 600, ...truncate }}>{row.title}</div>
				<div style={{ fontSize: 12, color: palette.inkSoft, ...truncate }}>
					{row.summary}
				</div>
				{row.genre || row.tags.length > 0 ? (
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: 6,
							marginTop: 4,
							alignItems: "center",
						}}
					>
						{row.genre ? (
							<span style={{ fontSize: 11, color: palette.accent }}>{row.genre}</span>
						) : null}
						{row.tags.slice(0, 4).map((t) => (
							<span key={t} style={{ fontSize: 11, color: palette.inkFaint }}>
								#{t}
							</span>
						))}
					</div>
				) : null}
			</div>
			<div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
				<StatusPill status={row.aiStatus} />
				<span style={{ fontSize: 10, color: palette.inkFaint }}>
					{formatTime(row.updatedAt)}
				</span>
			</div>
		</button>
	);
}

function DetailPane({
	view,
	controller,
}: {
	view: OptionsView;
	controller: OptionsController;
}) {
	const detail = view.selected;
	if (!detail) {
		return (
			<aside style={panel}>
				<p style={{ fontSize: 12, color: palette.inkFaint, margin: 0 }}>
					Select a bookmark to see its details.
				</p>
			</aside>
		);
	}
	return (
		<aside style={{ ...panel, position: "sticky", top: 20 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
				<StatusPill status={detail.aiStatus} />
			</div>
			<h2 style={{ fontSize: 16, margin: "0 0 4px" }}>{detail.title}</h2>
			<a
				href={detail.url}
				target="_blank"
				rel="noreferrer"
				style={{ fontSize: 12, color: palette.accent, wordBreak: "break-all" }}
			>
				{detail.url}
			</a>

			{detail.description ? (
				<p style={{ fontSize: 13, color: palette.ink, margin: "10px 0 0" }}>
					{detail.description}
				</p>
			) : (
				<p style={{ fontSize: 12, color: palette.inkSoft, margin: "10px 0 0" }}>
					No AI description yet.
				</p>
			)}

			{detail.genre ? (
				<DetailField label="Genre" value={detail.genre} />
			) : null}

			{detail.tags.length > 0 ? (
				<div style={{ marginTop: 10 }}>
					<p style={railLabel}>Tags</p>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{detail.tags.map((t) => (
							<span key={t} style={{ fontSize: 12, color: palette.inkSoft }}>
								#{t}
							</span>
						))}
					</div>
				</div>
			) : null}

			{detail.aiError ? (
				<p style={{ fontSize: 12, color: palette.danger, margin: "10px 0 0" }}>
					{detail.aiError}
				</p>
			) : null}

			<dl style={{ margin: "12px 0 0", fontSize: 11, color: palette.inkFaint }}>
				<TimeRow label="Created" value={detail.createdAt} />
				<TimeRow label="Updated" value={detail.updatedAt} />
				{detail.lastAnalyzedAt ? (
					<TimeRow label="Analyzed" value={detail.lastAnalyzedAt} />
				) : null}
			</dl>

			<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
				<a href={detail.url} target="_blank" rel="noreferrer" style={primaryButton}>
					Open
				</a>
				{detail.canReAnalyze ? (
					<button
						type="button"
						style={view.busy ? { ...subtleButton, ...disabledButton } : subtleButton}
						disabled={view.busy}
						onClick={() => void controller.reAnalyze(detail.canonicalUrl)}
					>
						Re-analyze
					</button>
				) : null}
				<button
					type="button"
					style={view.busy ? { ...dangerButton, ...disabledButton } : dangerButton}
					disabled={view.busy}
					onClick={() => void controller.deleteBookmark(detail.canonicalUrl)}
				>
					Delete
				</button>
			</div>
		</aside>
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
		<div style={{ ...panel, textAlign: "center", color: palette.inkSoft, fontSize: 13 }}>
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
