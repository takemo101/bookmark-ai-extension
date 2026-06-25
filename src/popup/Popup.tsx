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
 */
import { useEffect, useSyncExternalStore } from "react";

import type {
	AiPreview,
	FlowView,
	PopupController,
	PopupView,
	RecentItemView,
	TrailStage,
	TrailStageStatus,
} from "./view-model";
import type {
	ConnectionStatus,
	PromptApiStatus,
} from "./use-cases";
import type { AiStatus } from "./view-types";
import {
	card,
	palette,
	primaryButton,
	primaryButtonDisabled,
	statusColor,
	subtleButton,
	surface,
} from "./styles";

export function Popup({ controller }: { controller: PopupController }) {
	const view = useSyncExternalStore(controller.subscribe, controller.getView);

	useEffect(() => {
		void controller.init();
	}, [controller]);

	return (
		<main style={surface}>
			<Header />
			<TabReceipt view={view} />
			<Badges view={view} />
			<SaveAction view={view} onSave={() => void controller.save()} />
			<Flow flow={view.flow} />
			<Recent
				items={view.recent}
				onReAnalyze={(url) => void controller.reAnalyze(url)}
			/>
			<Footer />
		</main>
	);
}

function Header() {
	return (
		<header style={{ marginBottom: 10 }}>
			<h1 style={{ fontSize: 16, margin: 0, letterSpacing: 0.2 }}>
				Bookmark AI
			</h1>
			<p style={{ fontSize: 11, margin: "2px 0 0", color: palette.inkFaint }}>
				Save the current tab as an AI-enriched bookmark.
			</p>
		</header>
	);
}

function TabReceipt({ view }: { view: PopupView }) {
	const title = view.tab?.title ?? (view.loading ? "Reading current tab…" : "No active tab");
	const url = view.tab?.url ?? "";
	return (
		<section style={{ ...card, marginBottom: 8 }}>
			<div
				style={{
					fontSize: 10,
					textTransform: "uppercase",
					letterSpacing: 1,
					color: palette.inkFaint,
				}}
			>
				Current tab
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
		</section>
	);
}

function Badges({ view }: { view: PopupView }) {
	return (
		<section
			style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}
		>
			<Badge label="Google" text={connectionText(view.connection)} tone={connectionTone(view.connection)} />
			<Badge label="Prompt API" text={promptApiText(view.promptApi)} tone={promptApiTone(view.promptApi)} />
			<Badge label="Sync" text={view.sync.status} tone={syncTone(view.sync.status)} />
			{view.sync.pendingLocalChanges ? (
				<Badge label="Local" text="changes pending" tone="warn" />
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
					background: statusColor(tone),
				}}
			/>
			<span style={{ color: palette.inkFaint }}>{label}:</span>
			<span>{text}</span>
		</span>
	);
}

function SaveAction({ view, onSave }: { view: PopupView; onSave: () => void }) {
	const saving = view.flow.kind === "running";
	const disabled = !view.canSave || saving;
	return (
		<button
			type="button"
			onClick={onSave}
			disabled={disabled}
			style={disabled ? primaryButtonDisabled : primaryButton}
		>
			{saving ? "Saving & Analyzing…" : "Save & Analyze"}
		</button>
	);
}

function Flow({ flow }: { flow: FlowView }) {
	if (flow.kind === "idle") {
		return null;
	}
	return (
		<section style={{ ...card, marginTop: 10 }}>
			<Trail trail={flow.trail} />
			{flow.kind === "error" ? (
				<p style={{ fontSize: 12, color: palette.danger, margin: "8px 0 0" }}>
					{flow.message}
				</p>
			) : null}
			{flow.kind === "done" ? <Receipt receipt={flow.receipt} /> : null}
		</section>
	);
}

function Trail({ trail }: { trail: readonly TrailStage[] }) {
	return (
		<ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
			{trail.map((stage) => (
				<li
					key={stage.key}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 12,
						color: stage.status === "pending" ? palette.inkFaint : palette.inkSoft,
						padding: "2px 0",
					}}
				>
					<span aria-hidden>{stageGlyph(stage.status)}</span>
					<span>{stage.label}</span>
				</li>
			))}
		</ol>
	);
}

function Receipt({
	receipt,
}: {
	receipt: Extract<FlowView, { kind: "done" }>["receipt"];
}) {
	return (
		<div style={{ marginTop: 8 }}>
			<div
				style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}
			>
				<StatusPill status={receipt.aiStatus} />
				{!receipt.driveSynced ? (
					<span style={{ fontSize: 11, color: palette.warn }}>
						saved locally
					</span>
				) : null}
			</div>
			{receipt.aiStatus === "ready" ? (
				<Preview preview={receipt.preview} />
			) : (
				<p style={{ fontSize: 12, color: palette.inkSoft, margin: 0 }}>
					{receipt.aiStatus === "unavailable"
						? "Saved without AI — the Prompt API was unavailable. Re-analyze later from Options."
						: receipt.aiError
							? `Saved, but analysis failed: ${receipt.aiError}. Re-analyze later from Options.`
							: "Saved. Re-analyze later from Options."}
				</p>
			)}
			{receipt.driveWarning ? (
				<p style={{ fontSize: 11, color: palette.warn, margin: "6px 0 0" }}>
					Drive sync pending: {receipt.driveWarning}
				</p>
			) : null}
		</div>
	);
}

function Preview({ preview }: { preview: AiPreview }) {
	return (
		<div>
			{preview.description ? (
				<p style={{ fontSize: 12, color: palette.ink, margin: "0 0 4px" }}>
					{preview.description}
				</p>
			) : null}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
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

function Recent({
	items,
	onReAnalyze,
}: {
	items: readonly RecentItemView[];
	onReAnalyze: (canonicalUrl: string) => void;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<section style={{ marginTop: 12 }}>
			<h2
				style={{
					fontSize: 11,
					textTransform: "uppercase",
					letterSpacing: 1,
					color: palette.inkFaint,
					margin: "0 0 6px",
				}}
			>
				Recent bookmarks
			</h2>
			<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
				{items.map((item) => (
					<li
						key={item.canonicalUrl}
						style={{
							borderTop: `1px solid ${palette.border}`,
							padding: "6px 0",
							display: "flex",
							gap: 8,
							alignItems: "flex-start",
						}}
					>
						<div style={{ minWidth: 0, flex: 1 }}>
							<div
								style={{
									fontSize: 12,
									fontWeight: 600,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{item.title}
							</div>
							<div
								style={{
									fontSize: 11,
									color: palette.inkSoft,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{item.description ?? item.url}
							</div>
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
							<StatusPill status={item.aiStatus} />
							{item.canReAnalyze ? (
								<button
									type="button"
									style={subtleButton}
									onClick={() => onReAnalyze(item.canonicalUrl)}
								>
									Re-analyze
								</button>
							) : null}
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

function Footer() {
	return (
		<footer
			style={{
				marginTop: 12,
				paddingTop: 8,
				borderTop: `1px solid ${palette.border}`,
				display: "flex",
				justifyContent: "flex-end",
			}}
		>
			<button
				type="button"
				style={subtleButton}
				onClick={() => {
					// `chrome.runtime` is absent outside the extension (and in tests);
					// guard so the popup never throws when opened standalone.
					chrome?.runtime?.openOptionsPage?.();
				}}
			>
				Manage in Options
			</button>
		</footer>
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

function connectionText(status: ConnectionStatus): string {
	return status === "connected"
		? "connected"
		: status === "disconnected"
			? "sign in"
			: "unknown";
}

function connectionTone(status: ConnectionStatus): "ok" | "warn" | "neutral" {
	return status === "connected" ? "ok" : status === "disconnected" ? "warn" : "neutral";
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
