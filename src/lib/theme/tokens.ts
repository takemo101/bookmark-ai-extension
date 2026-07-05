/**
 * Semantic theme palettes shared by the Popup and Options UIs (pure,
 * Chrome-free).
 *
 * Light is the existing "Warm Library" identity: paper-like off-white
 * surfaces, muted ink, gentle hairline borders, restrained accents. Dark is
 * "Deep Ledger": the same identity on dark ledger/database-like paper —
 * crisp warm ink on deep warm-graphite surfaces, warm/graphite borders, the
 * same restrained accent family. No neon gradients, no AI-purple, in either
 * theme (docs/design.md "UI Design").
 *
 * Popup and Options own their layout tokens in their layer-local `styles.ts`;
 * only the semantic colors live here so the two layers never import each
 * other (AGENTS.md "Architecture boundaries").
 */
import type { ResolvedTheme } from "./preference";

/** The semantic color tokens both UI layers compose their styles from. */
export type ThemePalette = {
	/** Paper surfaces, base → raised → slightly inset. */
	readonly paper: string;
	readonly paperRaised: string;
	readonly paperInset: string;
	/** Ink for text, primary → soft → faint. */
	readonly ink: string;
	readonly inkSoft: string;
	readonly inkFaint: string;
	/** Hairline borders, gentle → strong. */
	readonly border: string;
	readonly borderStrong: string;
	/** Restrained accent for primary actions. */
	readonly accent: string;
	/** Text color on top of the accent. */
	readonly accentInk: string;
	/** Status tones. */
	readonly ok: string;
	readonly warn: string;
	readonly danger: string;
	/** Selection highlight for the active ledger row / chat bubble. */
	readonly selected: string;
	/** Full-screen overlay backdrop color (drawer/dialog scrims). */
	readonly overlay: string;
	/** Shadow color composed into `box-shadow` values. */
	readonly shadow: string;
};

/** Warm Library — the existing light identity. */
export const lightThemePalette: ThemePalette = {
	paper: "#faf6ee",
	paperRaised: "#fffdf8",
	paperInset: "#f3ede1",
	ink: "#3a342b",
	inkSoft: "#6b6253",
	inkFaint: "#9a907e",
	border: "#e6ddca",
	borderStrong: "#d8ccb2",
	accent: "#7a5d3a", // warm brown, primary action
	accentInk: "#fffdf8",
	ok: "#4f7a52", // muted green — ready/synced
	warn: "#9a7b2e", // muted amber — pending/unavailable
	danger: "#9a4b3f", // muted brick — failed/error
	selected: "#f0e7d4",
	overlay: "rgba(58, 52, 43, 0.35)",
	shadow: "rgba(58, 52, 43, 0.22)",
};

/** Deep Ledger — Warm Library on dark ledger paper, crisp and restrained. */
export const darkThemePalette: ThemePalette = {
	paper: "#221d15",
	paperRaised: "#2b2519",
	paperInset: "#1b1710",
	ink: "#ede4d3",
	inkSoft: "#b5a98f",
	inkFaint: "#84795f",
	border: "#3e3626",
	borderStrong: "#554a33",
	accent: "#c8a468", // warm brass, primary action on dark paper
	accentInk: "#241f15",
	ok: "#8cb98f",
	warn: "#cfa74e",
	danger: "#d08b7c",
	selected: "#3a3220",
	overlay: "rgba(10, 8, 4, 0.6)",
	shadow: "rgba(0, 0, 0, 0.5)",
};

/** The palette of a resolved theme. */
export function themePaletteFor(resolved: ResolvedTheme): ThemePalette {
	return resolved === "dark" ? darkThemePalette : lightThemePalette;
}

/** The status tones a dot/badge can take. */
export type StatusTone = "ok" | "warn" | "danger" | "neutral";

/** A status dot/badge color for AI-status, connection, and sync badges. */
export function statusColor(palette: ThemePalette, tone: StatusTone): string {
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
