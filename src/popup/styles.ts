/**
 * Visual tokens for the Bookmark Receipt popup (docs/design.md "UI Design").
 * The semantic colors come from the shared theme palettes (`lib/theme`):
 * light is the Warm Library paper identity, dark is Deep Ledger — the same
 * identity on dark ledger paper. No neon gradients, no AI-purple.
 *
 * Layout stays popup-local; the color-dependent style objects are built by
 * {@link createPopupStyles} from the active palette (the project ships no CSS
 * tooling, so components compose the returned objects inline). Nothing
 * Chrome-, Drive-, or AI-specific lives here.
 */
import type { CSSProperties } from "react";

import type { ThemePalette } from "../lib/theme/index";

export const fontStack = 'ui-serif, Georgia, "Times New Roman", serif';

/** The themed style objects the popup composes inline. */
export type PopupStyles = {
	readonly surface: CSSProperties;
	readonly card: CSSProperties;
	readonly primaryButton: CSSProperties;
	readonly primaryButtonDisabled: CSSProperties;
	readonly subtleButton: CSSProperties;
	readonly recentRowButton: CSSProperties;
	readonly detailOverlay: CSSProperties;
};

/** Build the popup's themed styles from the active semantic palette. */
export function createPopupStyles(palette: ThemePalette): PopupStyles {
	const surface: CSSProperties = {
		width: 340,
		boxSizing: "border-box",
		padding: "12px 14px 14px",
		fontFamily: fontStack,
		color: palette.ink,
		background: palette.paper,
		lineHeight: 1.4,
	};

	const primaryButton: CSSProperties = {
		width: "100%",
		padding: "8px 10px",
		fontFamily: fontStack,
		fontSize: 14,
		fontWeight: 600,
		color: palette.accentInk,
		background: palette.accent,
		border: `1px solid ${palette.accent}`,
		borderRadius: 8,
		cursor: "pointer",
	};

	return {
		surface,
		card: {
			background: palette.paperRaised,
			border: `1px solid ${palette.border}`,
			borderRadius: 8,
			padding: "8px 10px",
		},
		primaryButton,
		primaryButtonDisabled: {
			...primaryButton,
			background: palette.borderStrong,
			border: `1px solid ${palette.borderStrong}`,
			color: palette.paperRaised,
			cursor: "default",
		},
		subtleButton: {
			padding: "4px 8px",
			fontFamily: fontStack,
			fontSize: 12,
			color: palette.accent,
			background: "transparent",
			border: `1px solid ${palette.border}`,
			borderRadius: 6,
			cursor: "pointer",
		},
		/**
		 * The clickable recent-row title (MIK-028): a real button for keyboard
		 * users, visually just the truncated one-line title the compact list
		 * already shows.
		 */
		recentRowButton: {
			flex: 1,
			minWidth: 0,
			margin: 0,
			padding: 0,
			textAlign: "left",
			fontFamily: fontStack,
			fontSize: 12,
			color: palette.ink,
			background: "transparent",
			border: "none",
			cursor: "pointer",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap",
			lineHeight: 1.4,
		},
		/**
		 * Full-popup takeover for a recent bookmark's compact detail (MIK-028).
		 * The popup is too narrow for a side sheet, so the detail covers the
		 * receipt and scrolls on its own; Back/Close return to the receipt
		 * underneath.
		 */
		detailOverlay: {
			position: "fixed",
			inset: 0,
			boxSizing: "border-box",
			padding: "10px 14px 14px",
			fontFamily: fontStack,
			color: palette.ink,
			background: palette.paper,
			overflowY: "auto",
			zIndex: 10,
			lineHeight: 1.4,
		},
	};
}

/** Per-palette cache: only the two shared palettes exist at runtime. */
const stylesCache = new Map<ThemePalette, PopupStyles>();

/** The (cached) themed popup styles for a palette. */
export function popupStylesFor(palette: ThemePalette): PopupStyles {
	let styles = stylesCache.get(palette);
	if (!styles) {
		styles = createPopupStyles(palette);
		stylesCache.set(palette, styles);
	}
	return styles;
}
