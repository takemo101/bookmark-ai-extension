/**
 * Shared Options screen frame (MIK-053): one component owns screen width,
 * rail/no-rail behavior, header/content column alignment, and the Ask AI
 * outer scroll locking, so the three top-level screens stop drifting apart.
 *
 * Variants:
 *
 * - `library` — normal document scroll; the header spans the 1200px shell and
 *   the body renders the two-zone workspace grid (240px rail + main content).
 * - `noRail` — normal document scroll; the header and the body stack inside
 *   the same centered 880px column so the title never sits wider than the
 *   content below it.
 * - `chat` — the outer page is locked (`height: 100vh`, `overflow: hidden`);
 *   the header and the chat body share the same centered 880px no-rail width
 *   (MIK-054) and the body fills the remaining viewport height so the chat
 *   viewport stays the only scroller and the composer stays pinned.
 *
 * Every screen opens with the same title/subtitle rhythm (MIK-036) and every
 * screen carries title-adjacent `?` help (MIK-052/MIK-053) through
 * {@link ScreenHelp}. Purely presentational: no controller, Chrome, Drive, or
 * AI knowledge lives here.
 */
import type { CSSProperties, ReactNode } from "react";

import {
	askAiScreenShell,
	chatBody,
	chatColumn,
	noRailColumn,
	type OptionsStyles,
	screenShell,
	screenTitle,
	screenTitleRow,
	workspaceBody,
} from "../styles";
import { useOptionsTheme } from "../theme";
import { ScreenHelp } from "./ScreenHelp";

export type ScreenFrameVariant = "library" | "noRail" | "chat";

/**
 * The app-page style for the active screen's frame variant: the `chat`
 * variant locks the outer document so its viewport is the only scroller.
 * Takes the active themed styles because the page frame carries the theme's
 * paper background and ink color.
 */
export function screenFramePageStyle(
	styles: OptionsStyles,
	variant: ScreenFrameVariant,
): CSSProperties {
	return variant === "chat" ? styles.askAiPage : styles.page;
}

/**
 * Shared screen header (MIK-036): title, optional title-adjacent help, and a
 * one-line subtitle. The subtitle accepts nodes because help content may
 * embed the Drive settings filename as `<code>`.
 */
function ScreenHeader({
	title,
	subtitle,
	helpLabel,
	help,
}: {
	title: string;
	subtitle: ReactNode;
	/** Accessible name of the `?` help trigger; required with help. */
	helpLabel?: string;
	/** Explanatory guidance disclosed by the title-adjacent help. */
	help?: ReactNode;
}) {
	const { styles } = useOptionsTheme();
	return (
		<header>
			<div style={screenTitleRow}>
				<h2 style={screenTitle}>{title}</h2>
				{help && helpLabel ? (
					<ScreenHelp label={helpLabel}>{help}</ScreenHelp>
				) : null}
			</div>
			<p style={styles.screenSubtitle}>{subtitle}</p>
		</header>
	);
}

export function ScreenFrame({
	variant,
	title,
	subtitle,
	helpLabel,
	help,
	rail,
	ariaLabel,
	children,
}: {
	variant: ScreenFrameVariant;
	title: string;
	subtitle: ReactNode;
	helpLabel?: string;
	help?: ReactNode;
	/** The left rail content; rendered by the `library` variant only. */
	rail?: ReactNode;
	ariaLabel?: string;
	children: ReactNode;
}) {
	const header = (
		<ScreenHeader
			title={title}
			subtitle={subtitle}
			helpLabel={helpLabel}
			help={help}
		/>
	);

	if (variant === "library") {
		return (
			<section style={screenShell} aria-label={ariaLabel}>
				{header}
				<div style={workspaceBody}>
					{rail}
					{children}
				</div>
			</section>
		);
	}
	if (variant === "noRail") {
		return (
			<section style={screenShell} aria-label={ariaLabel}>
				<div style={noRailColumn}>
					{header}
					{children}
				</div>
			</section>
		);
	}
	return (
		<section style={askAiScreenShell} aria-label={ariaLabel}>
			<div style={chatColumn}>
				{header}
				<div style={chatBody}>{children}</div>
			</div>
		</section>
	);
}
