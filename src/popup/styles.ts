/**
 * "Warm Library" visual tokens for the Bookmark Receipt popup (docs/design.md
 * "UI Design"). Paper-like off-white surfaces, muted ink text, gentle hairline
 * borders, and restrained accent colors — no neon gradients, no AI-purple.
 *
 * Tokens only: plain values and a few shared style objects. The component
 * composes them inline (the project ships no CSS tooling), so there is nothing
 * Chrome-, Drive-, or AI-specific here.
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
	/** Restrained accents for status. */
	accent: "#7a5d3a", // warm brown, primary action
	accentInk: "#fffdf8",
	ok: "#4f7a52", // muted green — ready/synced
	warn: "#9a7b2e", // muted amber — pending/unavailable
	danger: "#9a4b3f", // muted brick — failed/error
} as const;

export const fontStack =
	'ui-serif, Georgia, "Times New Roman", serif';

export const surface: CSSProperties = {
	width: 340,
	boxSizing: "border-box",
	padding: "16px 18px 18px",
	fontFamily: fontStack,
	color: palette.ink,
	background: palette.paper,
	lineHeight: 1.4,
};

export const card: CSSProperties = {
	background: palette.paperRaised,
	border: `1px solid ${palette.border}`,
	borderRadius: 8,
	padding: "10px 12px",
};

export const primaryButton: CSSProperties = {
	width: "100%",
	padding: "10px 12px",
	fontFamily: fontStack,
	fontSize: 14,
	fontWeight: 600,
	color: palette.accentInk,
	background: palette.accent,
	border: `1px solid ${palette.accent}`,
	borderRadius: 8,
	cursor: "pointer",
};

export const primaryButtonDisabled: CSSProperties = {
	...primaryButton,
	background: palette.borderStrong,
	border: `1px solid ${palette.borderStrong}`,
	color: palette.paperRaised,
	cursor: "default",
};

export const subtleButton: CSSProperties = {
	padding: "4px 8px",
	fontFamily: fontStack,
	fontSize: 12,
	color: palette.accent,
	background: "transparent",
	border: `1px solid ${palette.border}`,
	borderRadius: 6,
	cursor: "pointer",
};

/** A status dot/badge color for the AI status and connection badges. */
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
