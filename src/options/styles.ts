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

/**
 * Ask AI page frame: unlike Library/Skills, the chat screen should not let the
 * outer document scroll. The transcript viewport owns vertical overflow so the
 * composer stays pinned inside the chat surface.
 */
export const askAiPage: CSSProperties = {
	...page,
	height: "100vh",
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
};

/**
 * The two-zone workspace body (MIK-038): left rail · main content. Since
 * MIK-052 only the Library ledger renders inside this grid — rails are for
 * active controls (search/filters), and screens without them center their
 * content in {@link noRailContent} / {@link chatColumn} instead. The page
 * frame (max width, margins) comes from the shared {@link screenShell}.
 */
export const workspaceBody: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "240px minmax(0, 1fr)",
	gap: 16,
	alignItems: "start",
};

/**
 * Shared app header (MIK-025, MIK-036): the product brand on the left, the
 * Library / Analysis skills navigation on the right, on every screen.
 */
export const appHeader: CSSProperties = {
	maxWidth: 1200,
	margin: "0 auto",
	padding: "16px 24px 0",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: 8,
};

/** The product title inside the shared app header (MIK-036). */
export const brandTitle: CSSProperties = {
	fontSize: 18,
	margin: 0,
};

/**
 * Right-hand cluster of the app header (MIK-051): the shared sync hub next to
 * the screen navigation, so sync status/actions travel with every screen.
 */
export const appHeaderActions: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 12,
};

/**
 * Shared app-header sync hub (MIK-051): a native `<details>` disclosure whose
 * summary is the glance pill and whose panel drops below the header. The
 * anchor is relative so the panel can overlay the screen content.
 */
export const syncHub: CSSProperties = {
	position: "relative",
};

/** The always-visible glance pill of the sync hub (MIK-051). */
export const syncHubSummary: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: 6,
	padding: "5px 12px",
	fontFamily: fontStack,
	fontSize: 12,
	color: palette.inkSoft,
	background: palette.paperRaised,
	border: `1px solid ${palette.border}`,
	borderRadius: 999,
	cursor: "pointer",
	listStyle: "none",
	whiteSpace: "nowrap",
};

/**
 * The opened sync hub panel (MIK-051): bookmark Drive sync and analysis
 * settings sync sections with their manual actions. Overlays the screen
 * content below the header pill; sits under the detail sheet/modal backdrops
 * (zIndex 20/30) so those still cover it.
 */
export const syncHubPanel: CSSProperties = {
	position: "absolute",
	right: 0,
	top: "calc(100% + 8px)",
	zIndex: 15,
	width: 280,
	boxSizing: "border-box",
	display: "flex",
	flexDirection: "column",
	gap: 12,
	padding: "12px 14px",
	background: palette.paperRaised,
	border: `1px solid ${palette.borderStrong}`,
	borderRadius: 8,
	boxShadow: "0 10px 28px rgba(58, 52, 43, 0.22)",
	textAlign: "left",
};

/**
 * Shared screen frame (MIK-036): both the Library ledger and the Analysis
 * skills screen render inside this centered column, opening with a
 * {@link screenTitle}/{@link screenSubtitle} header so the two screens share
 * one layout rhythm.
 */
export const screenShell: CSSProperties = {
	maxWidth: 1200,
	margin: "0 auto",
	padding: "20px 24px 32px",
	display: "flex",
	flexDirection: "column",
	gap: 14,
};

/**
 * Ask AI screen frame inside {@link askAiPage}: fill the remaining viewport
 * under the app header and pass a bounded height down to the chat column.
 */
export const askAiScreenShell: CSSProperties = {
	...screenShell,
	width: "100%",
	boxSizing: "border-box",
	flex: 1,
	minHeight: 0,
	overflow: "hidden",
};

/** Screen title inside the shared screen header (MIK-036). */
export const screenTitle: CSSProperties = {
	fontSize: 18,
	margin: 0,
};

/**
 * Title row of the shared screen header (MIK-052): the screen title plus the
 * optional title-adjacent help disclosure.
 */
export const screenTitleRow: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 8,
};

/**
 * Title-adjacent help disclosure (MIK-052): a native `<details>` like the
 * sync hub — no dependency, no persisted open state. The anchor is relative
 * so the panel can overlay the screen content below the title.
 */
export const screenHelp: CSSProperties = {
	position: "relative",
};

/** The small `?` summary toggle beside the screen title (MIK-052). */
export const screenHelpSummary: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	width: 20,
	height: 20,
	fontFamily: fontStack,
	fontSize: 12,
	color: palette.inkSoft,
	background: palette.paperRaised,
	border: `1px solid ${palette.borderStrong}`,
	borderRadius: 999,
	cursor: "pointer",
	listStyle: "none",
};

/**
 * The opened help panel below the title (MIK-052): explanatory screen
 * guidance that used to live in explanation-only rails. Mirrors the sync hub
 * panel chrome; sits under the detail sheet/modal backdrops (zIndex 20/30).
 */
export const screenHelpPanel: CSSProperties = {
	position: "absolute",
	left: 0,
	top: "calc(100% + 8px)",
	zIndex: 15,
	width: 320,
	boxSizing: "border-box",
	padding: "12px 14px",
	background: palette.paperRaised,
	border: `1px solid ${palette.borderStrong}`,
	borderRadius: 8,
	boxShadow: "0 10px 28px rgba(58, 52, 43, 0.22)",
	fontSize: 12,
	color: palette.inkSoft,
	textAlign: "left",
};

/**
 * Centered single-column body for no-rail screens (MIK-052): screens whose
 * rail held only explanations render their main content in this readable
 * column instead of the {@link workspaceBody} grid.
 */
export const noRailContent: CSSProperties = {
	width: "100%",
	maxWidth: 880,
	margin: "0 auto",
	boxSizing: "border-box",
};

/**
 * Centered comfortable chat column for the no-rail Ask AI screen (MIK-052):
 * a bit wider than {@link noRailContent} so recommendation cards breathe, but
 * narrower than the 1200px shell for chat readability.
 */
export const chatColumn: CSSProperties = {
	width: "100%",
	maxWidth: 960,
	margin: "0 auto",
	boxSizing: "border-box",
	flex: 1,
	minHeight: 0,
	display: "flex",
	flexDirection: "column",
};

/** One-line screen subtitle under the screen title (MIK-036). */
export const screenSubtitle: CSSProperties = {
	fontSize: 12,
	color: palette.inkSoft,
	margin: "4px 0 0",
};

export const navTab: CSSProperties = {
	padding: "6px 14px",
	fontFamily: fontStack,
	fontSize: 13,
	color: palette.inkSoft,
	background: "transparent",
	border: `1px solid ${palette.border}`,
	borderRadius: 999,
	cursor: "pointer",
};

export const navTabActive: CSSProperties = {
	...navTab,
	color: palette.accentInk,
	background: palette.accent,
	border: `1px solid ${palette.accent}`,
	fontWeight: 600,
};

/**
 * Centered modal dialog for the custom skill create/edit form (MIK-025). Sits
 * above the header sync hub panel and the detail sheet backdrop.
 */
export const modalBackdrop: CSSProperties = {
	position: "fixed",
	inset: 0,
	background: "rgba(58, 52, 43, 0.35)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 24,
	zIndex: 30,
};

export const modalCard: CSSProperties = {
	boxSizing: "border-box",
	width: "min(680px, 100%)",
	maxHeight: "85vh",
	display: "flex",
	flexDirection: "column",
	background: palette.paper,
	border: `1px solid ${palette.borderStrong}`,
	borderRadius: 10,
	boxShadow: "0 18px 48px rgba(58, 52, 43, 0.28)",
};

export const modalHeader: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: 8,
	padding: "12px 20px",
	background: palette.paperRaised,
	borderBottom: `1px solid ${palette.border}`,
	borderRadius: "10px 10px 0 0",
};

export const modalBody: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "14px 20px 20px",
	display: "flex",
	flexDirection: "column",
	gap: 12,
};

/** Instruction authoring guidance box inside the skill form modal (MIK-025). */
export const guidanceBox: CSSProperties = {
	background: palette.paperInset,
	border: `1px solid ${palette.border}`,
	borderRadius: 8,
	padding: "10px 12px",
	fontSize: 12,
	color: palette.inkSoft,
};

export const rail: CSSProperties = {
	position: "sticky",
	top: 20,
	display: "flex",
	flexDirection: "column",
	gap: 14,
	// The sticky rail scrolls inside the viewport instead of growing the page
	// when domains/tags multiply (MIK-035); 40 = top offset + bottom breathing.
	maxHeight: "calc(100vh - 40px)",
	overflowY: "auto",
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

/**
 * The row's main open-detail hit area. The row container is a plain flex box
 * (a `<button>` cannot legally nest the quick-delete `<button>`), so this reset
 * keeps the title/summary block a real button for keyboard users while the
 * visual row chrome stays on the container.
 */
export const rowOpenButton: CSSProperties = {
	flex: 1,
	minWidth: 0,
	margin: 0,
	padding: 0,
	textAlign: "left",
	background: "transparent",
	border: "none",
	cursor: "pointer",
	fontFamily: fontStack,
	color: palette.ink,
	lineHeight: 1.45,
};

/** Compact per-row quick delete (MIK-024): danger-toned but visually small. */
export const rowDeleteButton: CSSProperties = {
	padding: "1px 7px",
	fontFamily: fontStack,
	fontSize: 11,
	lineHeight: 1.6,
	color: palette.danger,
	background: "transparent",
	border: `1px solid ${palette.border}`,
	borderRadius: 6,
	cursor: "pointer",
};

/**
 * Expanded TAGS facet container (MIK-024): once the user shows all tags, the
 * list scrolls inside a capped box instead of stretching the sticky rail past
 * the viewport.
 */
export const tagListExpanded: CSSProperties = {
	maxHeight: 240,
	overflowY: "auto",
};

/**
 * Collapsible facet group header (MIK-035): a full-width toggle button whose
 * accessible name is the group label plus the collapsed active-filter summary.
 */
export const facetHeaderButton: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 6,
	width: "100%",
	margin: "0 0 8px",
	padding: 0,
	background: "transparent",
	border: "none",
	cursor: "pointer",
	fontFamily: fontStack,
	textAlign: "left",
};

/** The group label inside the header button; margin moves to the button. */
export const facetHeaderLabel: CSSProperties = {
	...railLabel,
	margin: 0,
};

/**
 * Compact summary chip for a collapsed group's active filter value (MIK-035):
 * the selection stays visible without expanding the group.
 */
export const facetActiveSummary: CSSProperties = {
	marginLeft: "auto",
	fontSize: 11,
	color: palette.accentInk,
	background: palette.accent,
	borderRadius: 999,
	padding: "1px 8px",
	maxWidth: 130,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

/** Faint option count shown while a group is collapsed with no active filter. */
export const facetCollapsedCount: CSSProperties = {
	marginLeft: "auto",
	fontSize: 11,
	color: palette.inkFaint,
};

/**
 * Link-like detail profile label for a custom analysis skill (MIK-031): the
 * name reads as body text but is clickable, opening the skill's edit modal.
 */
export const profileEditButton: CSSProperties = {
	margin: 0,
	padding: 0,
	fontFamily: fontStack,
	fontSize: 13,
	color: palette.accent,
	background: "transparent",
	border: "none",
	textDecoration: "underline",
	cursor: "pointer",
};

export const truncate: CSSProperties = {
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

/** Two-line clamp for the richer row summary (inline-style line clamp). */
export const summaryClamp: CSSProperties = {
	display: "-webkit-box",
	WebkitBoxOrient: "vertical",
	WebkitLineClamp: 2,
	overflow: "hidden",
};

/**
 * Detail side sheet (MIK-022). The backdrop hosts the sheet flush against the
 * viewport's right edge; on narrow screens the sheet goes fullscreen.
 */
export const sheetBackdrop: CSSProperties = {
	position: "fixed",
	inset: 0,
	background: "rgba(58, 52, 43, 0.35)",
	display: "flex",
	justifyContent: "flex-end",
	zIndex: 20,
};

export const sheet: CSSProperties = {
	boxSizing: "border-box",
	width: "min(60vw, 860px)",
	height: "100%",
	display: "flex",
	flexDirection: "column",
	background: palette.paper,
	borderLeft: `1px solid ${palette.borderStrong}`,
	boxShadow: "-12px 0 32px rgba(58, 52, 43, 0.18)",
};

export const sheetFullscreen: CSSProperties = {
	...sheet,
	width: "100%",
	borderLeft: "none",
};

export const sheetHeader: CSSProperties = {
	padding: "14px 20px 12px",
	background: palette.paperRaised,
	borderBottom: `1px solid ${palette.border}`,
};

export const sheetBody: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "14px 20px 24px",
};

export const sheetFooter: CSSProperties = {
	padding: "12px 20px",
	background: palette.paperRaised,
	borderTop: `1px solid ${palette.border}`,
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

/**
 * Ask AI chat surface (MIK-049, sitesurf-inspired layout): the main area of
 * the Ask AI screen becomes a fixed-height flex column — scrollable transcript
 * viewport on top, composer pinned at the bottom — so the composer never
 * scrolls away with the conversation. The parent Ask AI page/screen/column
 * provide the bounded viewport height; this shell fills that space instead of
 * guessing with a viewport-minus-header magic number.
 */
export const askAiChatShell: CSSProperties = {
	height: "100%",
	minHeight: 0,
	display: "flex",
	flexDirection: "column",
	gap: 12,
};

/** Hosts the scroll viewport plus the floating jump-to-latest overlay. */
export const askAiViewportShell: CSSProperties = {
	position: "relative",
	flex: 1,
	minHeight: 0,
};

/** The one scrolling element of the chat surface. */
export const askAiViewport: CSSProperties = {
	boxSizing: "border-box",
	height: "100%",
	overflowY: "auto",
	overflowX: "hidden",
	display: "flex",
	flexDirection: "column",
	gap: 12,
	padding: "2px 2px 10px",
};

/** Centered welcome/examples landing state before the first message. */
export const askAiWelcome: CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	textAlign: "center",
	gap: 10,
	padding: "0 16px",
};

/** Faint uppercase role label above a chat turn (You / AI). */
export const askAiTurnLabel: CSSProperties = {
	fontSize: 10,
	textTransform: "uppercase",
	letterSpacing: 1,
	color: palette.inkFaint,
	margin: "0 0 4px",
};

/** A right-aligned user turn: label plus bubble as one column. */
export const askAiUserTurn: CSSProperties = {
	alignSelf: "flex-end",
	maxWidth: "85%",
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-end",
};

/** The raised user message bubble (Warm Library, chat-cornered). */
export const askAiUserBubble: CSSProperties = {
	margin: 0,
	padding: "10px 14px",
	fontSize: 13,
	color: palette.ink,
	whiteSpace: "pre-wrap",
	background: palette.selected,
	border: `1px solid ${palette.borderStrong}`,
	borderRadius: "14px 14px 4px 14px",
};

/** A full-width assistant turn wrapper around the existing result panel. */
export const askAiAssistantTurn: CSSProperties = {
	alignSelf: "stretch",
	minWidth: 0,
};

/**
 * Floating jump-to-latest overlay button, centered above the composer. Only
 * rendered while the user has scrolled away from the bottom.
 */
export const askAiLatestButton: CSSProperties = {
	position: "absolute",
	left: "50%",
	bottom: 12,
	transform: "translateX(-50%)",
	zIndex: 5,
	display: "inline-flex",
	alignItems: "center",
	gap: 6,
	padding: "6px 12px",
	fontFamily: fontStack,
	fontSize: 12,
	fontWeight: 600,
	color: palette.accent,
	background: palette.paperRaised,
	border: `1px solid ${palette.borderStrong}`,
	borderRadius: 999,
	boxShadow: "0 4px 12px rgba(58, 52, 43, 0.18)",
	cursor: "pointer",
};

/** The composer panel pinned to the bottom of the chat shell. */
export const askAiComposer: CSSProperties = {
	...panel,
	display: "flex",
	flexDirection: "column",
	gap: 8,
	flexShrink: 0,
};

/**
 * Compact cache/scope/privacy context at the top of the Ask AI chat viewport
 * (MIK-050, slimmed by MIK-051): cache freshness plus the scope and privacy
 * notes as small inline items rendered as the first scrollable item inside
 * the chat frame — informational only; sync status and actions live in the
 * shared app-header sync hub.
 */
export const askAiChatContext: CSSProperties = {
	...panel,
	flexShrink: 0,
	padding: "8px 12px",
	display: "flex",
	flexWrap: "wrap",
	alignItems: "center",
	columnGap: 14,
	rowGap: 4,
	fontSize: 12,
	color: palette.inkSoft,
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
