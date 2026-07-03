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
import type { ChangeEvent } from "react";
import { useEffect, useSyncExternalStore } from "react";

import { type MarkdownBlock, parseMarkdownBlocks } from "./markdown";
import type {
	BuiltInSkillView,
	CustomSkillRowView,
	SkillFormValues,
	SkillsController,
	SkillsView,
} from "./skills-view-model";
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

export function Options({
	controller,
	skillsController,
}: {
	controller: OptionsController;
	/** Optional so existing tests/embeds can render without the skills panel. */
	skillsController?: SkillsController;
}) {
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
			{skillsController ? (
				<SkillsSection skillsController={skillsController} />
			) : null}
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
							onSelect={() => controller.select(item.canonicalUrl)}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

function LedgerRow({ row, onSelect }: { row: RowView; onSelect: () => void }) {
	return (
		<button
			type="button"
			style={row.selected ? rowSelected : rowStyle}
			onClick={onSelect}
		>
			<div style={{ minWidth: 0, flex: 1 }}>
				<div style={{ fontSize: 14, fontWeight: 600, ...truncate }}>
					{row.title}
				</div>
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
							<span style={{ fontSize: 11, color: palette.accent }}>
								{row.genre}
							</span>
						) : null}
						{row.tags.slice(0, 4).map((t) => (
							<span key={t} style={{ fontSize: 11, color: palette.inkFaint }}>
								#{t}
							</span>
						))}
					</div>
				) : null}
			</div>
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
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					marginBottom: 6,
				}}
			>
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
					{detail.aiStatus === "pending"
						? "AI analysis has not finished for this bookmark. Re-analyze it while its page is the active tab."
						: "No AI description yet."}
				</p>
			)}

			{detail.genre ? <DetailField label="Genre" value={detail.genre} /> : null}

			{detail.analysisProfileId ? (
				<DetailField label="Profile" value={detail.analysisProfileId} />
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

			{detail.analysisMarkdown ? (
				<AnalysisMarkdown markdown={detail.analysisMarkdown} />
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
				<a
					href={detail.url}
					target="_blank"
					rel="noreferrer"
					style={primaryButton}
				>
					Open
				</a>
				{detail.canReAnalyze ? (
					<button
						type="button"
						style={
							view.busy ? { ...subtleButton, ...disabledButton } : subtleButton
						}
						disabled={view.busy}
						onClick={() => void controller.reAnalyze(detail.canonicalUrl)}
					>
						{view.busy ? "Analyzing…" : "Re-analyze"}
					</button>
				) : null}
				<button
					type="button"
					style={
						view.busy ? { ...dangerButton, ...disabledButton } : dangerButton
					}
					disabled={view.busy}
					onClick={() => void controller.deleteBookmark(detail.canonicalUrl)}
				>
					Delete
				</button>
			</div>
			{view.busy ? (
				<p style={{ fontSize: 11, color: palette.inkFaint, margin: "8px 0 0" }}>
					Analyzing in the foreground — keep this page open until it finishes.
				</p>
			) : null}
		</aside>
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

/**
 * Renders `analysisMarkdown` as plain React text nodes grouped by block type.
 * Only {@link parseMarkdownBlocks}'s block text ever reaches JSX children —
 * never `dangerouslySetInnerHTML` — so raw HTML/script content is inert,
 * displayed as literal escaped text rather than interpreted markup.
 */
function AnalysisMarkdown({ markdown }: { markdown: string }) {
	const blocks = parseMarkdownBlocks(markdown);
	return (
		<div style={{ marginTop: 10 }}>
			<p style={railLabel}>Analysis</p>
			<div style={{ fontSize: 13, color: palette.ink }}>
				{blocks.map((block, i) => (
					<AnalysisBlock key={i} block={block} />
				))}
			</div>
		</div>
	);
}

function AnalysisBlock({ block }: { block: MarkdownBlock }) {
	if (block.type === "heading") {
		return (
			<p style={{ fontWeight: 700, margin: "10px 0 4px" }}>{block.text}</p>
		);
	}
	if (block.type === "list-item") {
		return <p style={{ margin: "2px 0", paddingLeft: 14 }}>• {block.text}</p>;
	}
	return <p style={{ margin: "6px 0" }}>{block.text}</p>;
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
