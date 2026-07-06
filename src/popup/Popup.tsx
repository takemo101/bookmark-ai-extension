/**
 * Bookmark Receipt popup (docs/design.md "Popup: Bookmark Receipt").
 *
 * A pure projection of {@link PopupController.getView}: it renders the current
 * tab, the Google connection / Prompt API badges, the primary Save & Analyze
 * action, the progress trail, the AI preview, recent saved bookmarks, and the
 * options link — and dispatches user intent back through the controller. It
 * imports only the controller and view types; no Drive client, Prompt API
 * client, JSONL parser, or merge internals appear here (AGENTS.md "Architecture
 * boundaries"). All wiring is injected via the `controller` prop, so the
 * component is trivially renderable with a fake in tests.
 *
 * Colors come from the active theme (light Warm Library / dark Deep Ledger)
 * through {@link usePopupTheme}; the popup reflects the saved preference but
 * exposes no selector — that lives in the Options app header.
 */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useSyncExternalStore } from "react";
import { type SupportedLanguage, detectUiLanguage } from "../lib/i18n/index";
import { statusColor } from "../lib/theme/index";
// UI-only dependencies (MIK-028, MIK-032): the safe Markdown renderer and the
// decorative favicon tile, no Options controller state — the sanctioned reuse
// of the no-raw-HTML rendering posture (docs/ai-analysis-v2.md "UI behavior").
import { Favicon } from "../options/favicon";
import { AnalysisMarkdown } from "../options/markdown";
import { type PopupMessages, popupMessages } from "./i18n";
import { openOptionsPage } from "./open-options";
import { paintPopupPageBackground } from "./page-reset";
import { usePopupTheme } from "./theme";
import type { ConnectionStatus, PromptApiStatus } from "./use-cases";
import type {
	AiPreview,
	FlowView,
	PopupController,
	PopupDetailView,
	PopupView,
	RecentItemView,
	TrailStage,
	TrailStageStatus,
} from "./view-model";
import type { AiStatus } from "./view-types";

export function Popup({
	controller,
	language,
}: {
	controller: PopupController;
	/**
	 * UI language override (MIK-029). Tests/embeds inject it for determinism;
	 * the runtime omits it and the browser UI language decides (Japanese
	 * fallback).
	 */
	language?: SupportedLanguage;
}) {
	// The third argument (server snapshot) lets tests render the popup with
	// `renderToStaticMarkup`, mirroring the Options component tests.
	const view = useSyncExternalStore(
		controller.subscribe,
		controller.getView,
		controller.getView,
	);
	const m = popupMessages(language ?? detectUiLanguage());
	const { palette, styles } = usePopupTheme();

	useEffect(() => {
		void controller.init();
	}, [controller]);

	// Keep the document body on the active theme's paper: the pre-mount reset
	// painted the light default before the stored preference resolved.
	useEffect(() => {
		if (typeof document !== "undefined") {
			paintPopupPageBackground(document.body, palette.paper);
		}
	}, [palette]);

	return (
		<main style={styles.surface}>
			<Header m={m} />
			<TabReceipt
				view={view}
				m={m}
				onDelete={() => void controller.deleteCurrentBookmark()}
			/>
			<Badges view={view} m={m} />
			<SaveAction view={view} m={m} onSave={() => void controller.save()} />
			<Flow flow={view.flow} m={m} />
			<Recent
				items={view.recent}
				m={m}
				busy={view.flow.kind === "running" || view.deleting}
				onReAnalyze={(url) => void controller.reAnalyze(url)}
				onSelect={(url) => controller.selectRecent(url)}
			/>
			<Footer m={m} />
			{view.selectedRecent ? (
				<RecentDetail
					detail={view.selectedRecent}
					m={m}
					onClose={() => controller.clearRecentSelection()}
				/>
			) : null}
		</main>
	);
}

function Header({ m }: { m: PopupMessages }) {
	const { palette } = usePopupTheme();
	return (
		<header style={{ marginBottom: 8 }}>
			<h1 style={{ fontSize: 16, margin: 0, letterSpacing: 0.2 }}>
				Bookmark AI
			</h1>
			<p style={{ fontSize: 11, margin: "2px 0 0", color: palette.inkFaint }}>
				{m.tagline}
			</p>
		</header>
	);
}

function TabReceipt({
	view,
	m,
	onDelete,
}: {
	view: PopupView;
	m: PopupMessages;
	onDelete: () => void;
}) {
	const { palette, styles } = usePopupTheme();
	const title =
		view.tab?.title ?? (view.loading ? m.readingTab : m.noActiveTab);
	const url = view.tab?.url ?? "";
	return (
		<section style={{ ...styles.card, marginBottom: 6 }}>
			<div
				style={{
					fontSize: 10,
					textTransform: "uppercase",
					letterSpacing: 1,
					color: palette.inkFaint,
				}}
			>
				{m.currentTab}
			</div>
			<div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{title}</div>
			{url ? (
				<div
					style={{
						fontSize: 11,
						color: palette.inkSoft,
						marginTop: 2,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{url}
				</div>
			) : null}
			{view.currentBookmark ? (
				<CurrentBookmark view={view} m={m} onDelete={onDelete} />
			) : null}
		</section>
	);
}

/**
 * The already-bookmarked state of the current page: a clear "Already
 * bookmarked" line with the record's AI status and a Remove affordance that
 * deletes through the app's tombstone delete. Save & Analyze stays available —
 * a duplicate save is the documented upsert that refreshes the analysis
 * (docs/design.md "Duplicate Behavior") — so the hint says exactly that.
 */
function CurrentBookmark({
	view,
	m,
	onDelete,
}: {
	view: PopupView;
	m: PopupMessages;
	onDelete: () => void;
}) {
	const { palette, styles } = usePopupTheme();
	const bookmark = view.currentBookmark;
	if (!bookmark) {
		return null;
	}
	const busy = view.deleting || view.flow.kind === "running";
	return (
		<div
			style={{
				marginTop: 8,
				paddingTop: 8,
				borderTop: `1px solid ${palette.border}`,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<span aria-hidden style={{ color: palette.ok, fontSize: 12 }}>
					✓
				</span>
				<span style={{ fontSize: 12, fontWeight: 600, color: palette.ok }}>
					{m.alreadyBookmarked}
				</span>
				<StatusPill status={bookmark.aiStatus} />
				<span style={{ flex: 1 }} />
				<button
					type="button"
					style={
						busy
							? { ...styles.subtleButton, cursor: "default", opacity: 0.6 }
							: styles.subtleButton
					}
					disabled={busy}
					onClick={onDelete}
				>
					{view.deleting ? m.removing : m.remove}
				</button>
			</div>
			<p style={{ fontSize: 11, color: palette.inkFaint, margin: "4px 0 0" }}>
				{m.duplicateSaveHint}
			</p>
			{view.deleteError ? (
				<p style={{ fontSize: 11, color: palette.danger, margin: "4px 0 0" }}>
					{m.removeFailed(view.deleteError)}
				</p>
			) : null}
		</div>
	);
}

function Badges({ view, m }: { view: PopupView; m: PopupMessages }) {
	return (
		<section
			style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}
		>
			<Badge
				label={m.googleLabel}
				text={connectionText(view.connection, m)}
				tone={connectionTone(view.connection)}
			/>
			<Badge
				label={m.promptApiLabel}
				text={promptApiText(view.promptApi)}
				tone={promptApiTone(view.promptApi)}
			/>
			<Badge
				label={m.syncLabel}
				text={view.sync.status}
				tone={syncTone(view.sync.status)}
			/>
			{view.sync.pendingLocalChanges ? (
				<Badge label={m.localLabel} text={m.changesPending} tone="warn" />
			) : null}
		</section>
	);
}

function Badge({
	label,
	text,
	tone,
}: {
	label: string;
	text: string;
	tone: "ok" | "warn" | "danger" | "neutral";
}) {
	const { palette } = usePopupTheme();
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				fontSize: 11,
				color: palette.inkSoft,
				background: palette.paperRaised,
				border: `1px solid ${palette.border}`,
				borderRadius: 999,
				padding: "2px 8px",
			}}
		>
			<span
				aria-hidden
				style={{
					width: 7,
					height: 7,
					borderRadius: 999,
					background: statusColor(palette, tone),
				}}
			/>
			<span style={{ color: palette.inkFaint }}>{label}:</span>
			<span>{text}</span>
		</span>
	);
}

function SaveAction({
	view,
	m,
	onSave,
}: {
	view: PopupView;
	m: PopupMessages;
	onSave: () => void;
}) {
	const { styles } = usePopupTheme();
	const saving = view.flow.kind === "running";
	const disabled = !view.canSave || saving;
	return (
		<button
			type="button"
			onClick={onSave}
			disabled={disabled}
			style={disabled ? styles.primaryButtonDisabled : styles.primaryButton}
		>
			{saving ? m.saving : m.save}
		</button>
	);
}

function Flow({ flow, m }: { flow: FlowView; m: PopupMessages }) {
	const { palette, styles } = usePopupTheme();
	if (flow.kind === "idle") {
		return null;
	}
	return (
		<section style={{ ...styles.card, marginTop: 8 }}>
			<Trail
				trail={flow.trail}
				m={m}
				modelSetup={flow.kind === "running" ? flow.modelSetup : undefined}
			/>
			{flow.kind === "running" ? (
				<p
					style={{
						fontSize: 12,
						fontWeight: 600,
						color: palette.warn,
						margin: "8px 0 0",
					}}
				>
					{m.runningNotice}
				</p>
			) : null}
			{flow.kind === "error" ? (
				<p style={{ fontSize: 12, color: palette.danger, margin: "8px 0 0" }}>
					{flow.message}
				</p>
			) : null}
			{flow.kind === "done" ? <Receipt receipt={flow.receipt} m={m} /> : null}
		</section>
	);
}

function Trail({
	trail,
	m,
	modelSetup,
}: {
	trail: readonly TrailStage[];
	m: PopupMessages;
	modelSetup?: Extract<FlowView, { kind: "running" }>["modelSetup"];
}) {
	const { palette } = usePopupTheme();
	function item(
		stage: { readonly key: string; readonly status: TrailStageStatus },
		label: string,
	) {
		return (
			<li
				key={stage.key}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					fontSize: 12,
					color:
						stage.status === "pending" ? palette.inkFaint : palette.inkSoft,
					padding: "1px 0",
				}}
			>
				<span aria-hidden>{stageGlyph(stage.status)}</span>
				<span>{label}</span>
			</li>
		);
	}
	function modelSetupItem(stage: TrailStage) {
		const label = modelSetup?.downloading
			? m.modelDownloading(modelSetup.percent)
			: m.modelPreparing;
		return (
			<li
				key={stage.key}
				aria-live="polite"
				style={{
					display: "grid",
					gridTemplateColumns: "20px 1fr",
					gap: 8,
					alignItems: "start",
					padding: 10,
					margin: "3px 0",
					border: `1px solid ${palette.borderStrong}`,
					background: palette.selected,
					borderRadius: 12,
					boxShadow: `0 4px 14px ${palette.shadow}`,
				}}
			>
				<span
					aria-hidden
					style={{
						width: 15,
						height: 15,
						marginTop: 1,
						border: `2px solid ${palette.borderStrong}`,
						borderTopColor: palette.accent,
						borderRadius: "50%",
						animation: "bookmark-ai-model-spin 0.8s linear infinite",
					}}
				/>
				<div>
					<div
						style={{
							fontSize: 13,
							fontWeight: 800,
							color: palette.ink,
							lineHeight: 1.25,
						}}
					>
						{label}
					</div>
					{modelSetup?.downloading ? (
						<ModelSetupProgress percent={modelSetup.percent} />
					) : null}
					<div
						style={{
							fontSize: 10.5,
							color: palette.inkSoft,
							marginTop: 6,
							lineHeight: 1.35,
						}}
					>
						{m.modelSetupHint}
					</div>
				</div>
			</li>
		);
	}
	function ModelSetupProgress({ percent }: { percent?: number }) {
		const trackStyle: CSSProperties = {
			height: 6,
			background: palette.paperInset,
			borderRadius: 999,
			overflow: "hidden",
			marginTop: 7,
		};
		const fillStyle: CSSProperties = {
			height: "100%",
			width: percent !== undefined ? `${percent}%` : "38%",
			borderRadius: 999,
			background: palette.accent,
			animation:
				percent !== undefined
					? "bookmark-ai-model-shimmer 1.5s linear infinite"
					: "bookmark-ai-model-indeterminate 1.15s ease-in-out infinite",
		};
		const fill = <div aria-hidden style={fillStyle} />;
		if (percent === undefined) {
			return <div style={trackStyle}>{fill}</div>;
		}
		return (
			<div
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				style={trackStyle}
			>
				{fill}
			</div>
		);
	}
	return (
		<>
			<style>{MODEL_SETUP_TRAIL_CSS}</style>
			<ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
				{trail.map((stage) => {
					if (stage.key === "analyzing" && modelSetup) {
						return modelSetupItem(stage);
					}
					return item(stage, m.trail[stage.key] ?? stage.label);
				})}
			</ol>
		</>
	);
}

const MODEL_SETUP_TRAIL_CSS = `
@keyframes bookmark-ai-model-spin { to { transform: rotate(360deg); } }
@keyframes bookmark-ai-model-shimmer {
	0% { filter: brightness(0.92); }
	50% { filter: brightness(1.18); }
	100% { filter: brightness(0.92); }
}
@keyframes bookmark-ai-model-indeterminate {
	0% { transform: translateX(-110%); }
	100% { transform: translateX(270%); }
}
@media (prefers-reduced-motion: reduce) {
	* { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
`;

function Receipt({
	receipt,
	m,
}: {
	receipt: Extract<FlowView, { kind: "done" }>["receipt"];
	m: PopupMessages;
}) {
	const { palette } = usePopupTheme();
	return (
		<div style={{ marginTop: 8 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					marginBottom: 4,
				}}
			>
				<StatusPill status={receipt.aiStatus} />
				{!receipt.driveSynced ? (
					<span style={{ fontSize: 11, color: palette.warn }}>
						{m.savedLocally}
					</span>
				) : null}
			</div>
			{receipt.aiStatus === "ready" ? (
				<Preview preview={receipt.preview} />
			) : (
				<p style={{ fontSize: 12, color: palette.inkSoft, margin: 0 }}>
					{receipt.aiStatus === "unavailable"
						? m.unavailableReceipt
						: receipt.aiError
							? m.failedReceipt(receipt.aiError)
							: m.savedReceipt}
				</p>
			)}
			{receipt.driveWarning ? (
				<p style={{ fontSize: 11, color: palette.warn, margin: "6px 0 0" }}>
					{m.drivePending(receipt.driveWarning)}
				</p>
			) : null}
		</div>
	);
}

function Preview({ preview }: { preview: AiPreview }) {
	const { palette } = usePopupTheme();
	return (
		<div>
			{preview.description ? (
				<p style={{ fontSize: 12, color: palette.ink, margin: "0 0 4px" }}>
					{preview.description}
				</p>
			) : null}
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 4,
					alignItems: "center",
				}}
			>
				{preview.genre ? (
					<span
						style={{
							fontSize: 11,
							color: palette.accent,
							border: `1px solid ${palette.border}`,
							borderRadius: 6,
							padding: "1px 6px",
						}}
					>
						{preview.genre}
					</span>
				) : null}
				{preview.tags.map((t) => (
					<span key={t} style={{ fontSize: 11, color: palette.inkSoft }}>
						#{t}
					</span>
				))}
			</div>
		</div>
	);
}

/**
 * Compact recent list (MIK-027): one line per bookmark — title, status pill,
 * and an inline Re-analyze affordance when the status is not `ready`. The
 * title tooltip carries the description/URL the row no longer shows; the full
 * ledger lives in Options, never here. Clicking the title opens the compact
 * detail overlay (MIK-028); Re-analyze stops propagation so it never also
 * opens the detail.
 */
function Recent({
	items,
	m,
	busy,
	onReAnalyze,
	onSelect,
}: {
	items: readonly RecentItemView[];
	m: PopupMessages;
	busy: boolean;
	onReAnalyze: (canonicalUrl: string) => void;
	onSelect: (canonicalUrl: string) => void;
}) {
	const { palette, styles } = usePopupTheme();
	if (items.length === 0) {
		return null;
	}
	return (
		<section style={{ marginTop: 10 }}>
			<h2
				style={{
					fontSize: 11,
					textTransform: "uppercase",
					letterSpacing: 1,
					color: palette.inkFaint,
					margin: "0 0 4px",
				}}
			>
				{m.recentBookmarks}
			</h2>
			<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
				{items.map((item) => (
					<li
						key={item.canonicalUrl}
						style={{
							borderTop: `1px solid ${palette.border}`,
							padding: "4px 0",
							display: "flex",
							gap: 6,
							alignItems: "center",
						}}
					>
						{/* Decorative site icon (MIK-032); the accessible row text stays
						    the title button next to it. */}
						<Favicon pageUrl={item.url} size={16} />
						<button
							type="button"
							title={item.description ?? item.url}
							style={styles.recentRowButton}
							aria-haspopup="dialog"
							onClick={() => onSelect(item.canonicalUrl)}
						>
							{item.title}
						</button>
						<StatusPill status={item.aiStatus} />
						{item.canReAnalyze ? (
							<button
								type="button"
								style={
									busy
										? {
												...styles.subtleButton,
												cursor: "default",
												opacity: 0.6,
											}
										: styles.subtleButton
								}
								disabled={busy}
								onClick={(event) => {
									// Never also open the detail behind the inline action.
									event.stopPropagation();
									onReAnalyze(item.canonicalUrl);
								}}
							>
								{m.reAnalyze}
							</button>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * The compact recent-bookmark detail (MIK-028): a full-popup overlay — the
 * 340px receipt has no room for a side sheet — with Back/Close, the link, the
 * AI description/genre/tags, and the long-form analysis rendered through the
 * safe Markdown component (no raw HTML execution). A reading surface only:
 * no delete, no filters, no full ledger — those stay in Options.
 */
function RecentDetail({
	detail,
	m,
	onClose,
}: {
	detail: PopupDetailView;
	m: PopupMessages;
	onClose: () => void;
}) {
	const { palette, styles } = usePopupTheme();
	return (
		<section
			role="dialog"
			aria-modal="true"
			aria-labelledby="recent-detail-title"
			style={styles.detailOverlay}
		>
			<header>
				<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
					<button type="button" style={styles.subtleButton} onClick={onClose}>
						{m.back}
					</button>
					<span style={{ flex: 1 }} />
					<StatusPill status={detail.aiStatus} />
					<button
						type="button"
						style={styles.subtleButton}
						onClick={onClose}
						aria-label={m.closeDetails}
					>
						✕
					</button>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						margin: "10px 0 2px",
					}}
				>
					{/* Keyed by URL: the overlay can swap records in place, so a failed
					    favicon for one site must not stick to the next (MIK-032). */}
					<Favicon key={detail.canonicalUrl} pageUrl={detail.url} size={18} />
					<h2 id="recent-detail-title" style={{ fontSize: 15, margin: 0 }}>
						{detail.title}
					</h2>
				</div>
				<ExternalLink
					href={detail.url}
					style={{
						fontSize: 11,
						color: palette.accent,
						wordBreak: "break-all",
					}}
				>
					{detail.url}
				</ExternalLink>
			</header>

			{detail.description ? (
				<p style={{ fontSize: 12, color: palette.ink, margin: "8px 0 0" }}>
					{detail.description}
				</p>
			) : null}

			{detail.genre || detail.tags.length > 0 ? (
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 4,
						alignItems: "center",
						marginTop: 6,
					}}
				>
					{detail.genre ? (
						<span
							style={{
								fontSize: 11,
								color: palette.accent,
								border: `1px solid ${palette.border}`,
								borderRadius: 6,
								padding: "1px 6px",
							}}
						>
							{detail.genre}
						</span>
					) : null}
					{detail.tags.map((t) => (
						<span key={t} style={{ fontSize: 11, color: palette.inkSoft }}>
							#{t}
						</span>
					))}
				</div>
			) : null}

			{detail.analysisMarkdown ? (
				<div
					style={{
						marginTop: 10,
						paddingTop: 8,
						borderTop: `1px solid ${palette.border}`,
					}}
				>
					<AnalysisMarkdown markdown={detail.analysisMarkdown} />
				</div>
			) : null}

			{detail.aiError ? (
				<p style={{ fontSize: 11, color: palette.danger, margin: "8px 0 0" }}>
					{detail.aiError}
				</p>
			) : null}

			<p style={{ fontSize: 10, color: palette.inkFaint, margin: "10px 0 0" }}>
				{m.updated(formatDate(detail.updatedAt))}
				{/* Readable profile name (MIK-031); the controller falls back to the
				    raw id when the profile is unknown here. */}
				{detail.analysisProfileName ? ` · ${detail.analysisProfileName}` : ""}
			</p>
		</section>
	);
}

/**
 * Render an ISO timestamp as a short local date. Display-only formatting; the
 * stored value remains the canonical ISO string from the domain.
 */
function formatDate(iso: string): string {
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

function ExternalLink({
	href,
	style,
	children,
}: {
	href: string;
	style?: CSSProperties;
	children: ReactNode;
}) {
	return (
		<a href={href} target="_blank" rel="noreferrer" style={style}>
			{children}
		</a>
	);
}

function Footer({ m }: { m: PopupMessages }) {
	const { palette, styles } = usePopupTheme();
	return (
		<footer
			style={{
				marginTop: 10,
				paddingTop: 6,
				borderTop: `1px solid ${palette.border}`,
				display: "flex",
				justifyContent: "flex-end",
			}}
		>
			<button
				type="button"
				style={styles.subtleButton}
				// `globalThis.chrome` is absent outside the extension (and in tests);
				// `openOptionsPage` reads it safely so the popup never throws when
				// opened standalone (a bare `chrome` reference would `ReferenceError`).
				onClick={() => openOptionsPage()}
			>
				{m.manageInOptions}
			</button>
		</footer>
	);
}

function StatusPill({ status }: { status: AiStatus }) {
	const { palette } = usePopupTheme();
	return (
		<span
			style={{
				fontSize: 10,
				textTransform: "uppercase",
				letterSpacing: 0.5,
				color: statusColor(palette, aiStatusTone(status)),
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

function stageGlyph(status: TrailStageStatus): string {
	switch (status) {
		case "done":
			return "✓";
		case "active":
			return "◌";
		case "failed":
			return "✕";
		case "skipped":
			return "–";
		default:
			return "·";
	}
}

function aiStatusTone(status: AiStatus): "ok" | "warn" | "danger" | "neutral" {
	switch (status) {
		case "ready":
			return "ok";
		case "pending":
			return "warn";
		case "unavailable":
			return "warn";
		case "failed":
			return "danger";
		default:
			return "neutral";
	}
}

function connectionText(status: ConnectionStatus, m: PopupMessages): string {
	return status === "connected"
		? m.connection.connected
		: status === "disconnected"
			? m.connection.disconnected
			: m.connection.unknown;
}

function connectionTone(status: ConnectionStatus): "ok" | "warn" | "neutral" {
	return status === "connected"
		? "ok"
		: status === "disconnected"
			? "warn"
			: "neutral";
}

function promptApiText(status: PromptApiStatus): string {
	return status;
}

function promptApiTone(
	status: PromptApiStatus,
): "ok" | "warn" | "danger" | "neutral" {
	switch (status) {
		case "available":
			return "ok";
		case "downloadable":
		case "downloading":
			return "warn";
		case "unavailable":
			return "danger";
		default:
			return "neutral";
	}
}

function syncTone(
	status: PopupView["sync"]["status"],
): "ok" | "warn" | "danger" | "neutral" {
	switch (status) {
		case "synced":
			return "ok";
		case "syncing":
			return "warn";
		case "error":
			return "danger";
		default:
			return "neutral";
	}
}
