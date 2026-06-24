/**
 * "Warm Library" visual tokens for the Research Ledger options page
 * (docs/design.md "UI Design", "Options page: Research Ledger"). Paper-like
 * off-white surfaces, muted ink text, gentle hairline borders, restrained accent
 * colors — no neon gradients, no AI-purple.
 *
 * The palette intentionally mirrors the popup's Warm Library identity, but the
 * options page owns its own layout tokens (a full-width three-pane ledger rather
 * than a narrow receipt), so they live here inside `options/*` instead of
 * reaching across into `popup/*` (AGENTS.md "Architecture boundaries").
 *
 * Tokens only: plain values and shared style objects the component composes
 * inline (the project ships no CSS tooling); nothing Chrome-, Drive-, or
 * AI-specific lives here.
 */
import type { CSSProperties } from "react";

export const palette = {
	/** Paper surfaces, lightest → slightly inset. */
	paper: "#faf6ee",
	paperRaised: "#fffdf8",
	paperInset: "#f3ede1",
	/** Muted ink for text, primary → faint. */
	ink: "#3a342b",
	inkSoft: "#6b6253",
	inkFaint: "#9a907e",
	/** Gentle hairline borders. */
	border: "#e6ddca",
	borderStrong: "#d8ccb2",
	/** Restrained accents. */
	accent: "#7a5d3a", // warm brown, primary action
	accentInk: "#fffdf8",
	ok: "#4f7a52", // muted green — ready/synced
	warn: "#9a7b2e", // muted amber — pending/unavailable
	danger: "#9a4b3f", // muted brick — failed/error
	/** Selection highlight for the active ledger row. */
	selected: "#f0e7d4",
} as const;

export const fontStack = 'ui-serif, Georgia, "Times New Roman", serif';

/** Full-page ledger frame. */
export const page: CSSProperties = {
	boxSizing: "border-box",
	minHeight: "100vh",
	margin: 0,
	fontFamily: fontStack,
	color: palette.ink,
	background: palette.paper,
	lineHeight: 1.45,
};

/** The three-pane grid: left rail · center list · right detail. */
export const ledger: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "240px minmax(0, 1fr) 320px",
	gap: 16,
	alignItems: "start",
	maxWidth: 1200,
	margin: "0 auto",
	padding: "20px 24px 32px",
};

export const rail: CSSProperties = {
	position: "sticky",
	top: 20,
	display: "flex",
	flexDirection: "column",
	gap: 14,
};

export const panel: CSSProperties = {
	background: palette.paperRaised,
	border: `1px solid ${palette.border}`,
	borderRadius: 8,
	padding: "12px 14px",
};

export const railLabel: CSSProperties = {
	fontSize: 10,
	textTransform: "uppercase",
	letterSpacing: 1,
	color: palette.inkFaint,
	margin: "0 0 8px",
};

export const searchInput: CSSProperties = {
	width: "100%",
	boxSizing: "border-box",
	padding: "8px 10px",
	fontFamily: fontStack,
	fontSize: 13,
	color: palette.ink,
	background: palette.paper,
	border: `1px solid ${palette.borderStrong}`,
	borderRadius: 6,
};

export const chip: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: 5,
	fontSize: 12,
	color: palette.inkSoft,
	background: palette.paper,
	border: `1px solid ${palette.border}`,
	borderRadius: 999,
	padding: "3px 9px",
	cursor: "pointer",
};

export const chipActive: CSSProperties = {
	...chip,
	color: palette.accentInk,
	background: palette.accent,
	border: `1px solid ${palette.accent}`,
};

export const row: CSSProperties = {
	display: "flex",
	gap: 10,
	alignItems: "flex-start",
	width: "100%",
	textAlign: "left",
	boxSizing: "border-box",
	padding: "10px 12px",
	background: palette.paperRaised,
	border: `1px solid ${palette.border}`,
	borderRadius: 8,
	cursor: "pointer",
	fontFamily: fontStack,
	color: palette.ink,
};

export const rowSelected: CSSProperties = {
	...row,
	background: palette.selected,
	border: `1px solid ${palette.borderStrong}`,
};

export const truncate: CSSProperties = {
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

export const primaryButton: CSSProperties = {
	padding: "7px 12px",
	fontFamily: fontStack,
	fontSize: 13,
	fontWeight: 600,
	color: palette.accentInk,
	background: palette.accent,
	border: `1px solid ${palette.accent}`,
	borderRadius: 6,
	cursor: "pointer",
};

export const subtleButton: CSSProperties = {
	padding: "5px 10px",
	fontFamily: fontStack,
	fontSize: 12,
	color: palette.accent,
	background: "transparent",
	border: `1px solid ${palette.border}`,
	borderRadius: 6,
	cursor: "pointer",
};

export const dangerButton: CSSProperties = {
	...subtleButton,
	color: palette.danger,
	border: `1px solid ${palette.danger}`,
};

export const disabledButton: CSSProperties = {
	opacity: 0.5,
	cursor: "default",
};

/** A status dot/badge color for the AI status and sync badges. */
export function statusColor(
	tone: "ok" | "warn" | "danger" | "neutral",
): string {
	switch (tone) {
		case "ok":
			return palette.ok;
		case "warn":
			return palette.warn;
		case "danger":
			return palette.danger;
		default:
			return palette.inkFaint;
	}
}

export function aiStatusTone(
	status: string,
): "ok" | "warn" | "danger" | "neutral" {
	switch (status) {
		case "ready":
			return "ok";
		case "pending":
		case "unavailable":
			return "warn";
		case "failed":
			return "danger";
		default:
			return "neutral";
	}
}

export function syncTone(status: string): "ok" | "warn" | "danger" | "neutral" {
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
