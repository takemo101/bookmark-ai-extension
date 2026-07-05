/**
 * Shared bookmark summary body (MIK-053): the one row/card shape behind the
 * Library ledger rows (MIK-024) and the Ask AI recommendation cards
 * (MIK-046), so both surfaces show the same favicon/title/metadata/status
 * anatomy and can never drift apart again.
 *
 * The container is a flex `<div>` (not a `<button>`) so contextual trailing
 * actions like the Library quick delete can legally live inside it; the main
 * content stays a real button for mouse and keyboard users. The favicon is
 * looked up by the original visited URL, never the canonical form (MIK-034),
 * and no favicon data is stored anywhere — fallback behavior stays owned by
 * {@link Favicon}.
 *
 * Contextual slots: the Library row passes `selected` styling, `expanded`
 * detail state, and a `trailing` column (updated time + quick delete); the
 * Ask AI card passes the recommendation `reason` line and no trailing
 * extras. The `data-bookmark-summary` marker pins the shared primitive in
 * static-markup tests.
 */
import type { ReactNode } from "react";

import { Favicon } from "../favicon";
import {
	aiStatusTone,
	palette,
	row as rowStyle,
	rowOpenButton,
	rowSelected,
	statusColor,
	summaryClamp,
	truncate,
} from "../styles";
import type { AiStatus } from "../view-types";

/** How many tags a summary row/card shows at most. */
const SUMMARY_TAG_CAP = 4;

/** The small uppercase AI-status pill shared by rows, cards, and drawers. */
export function StatusPill({ status }: { status: AiStatus }) {
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

export function BookmarkSummaryItem({
	url,
	title,
	description,
	domain,
	genre,
	tags,
	metaSuffix,
	reason,
	aiStatus,
	selected = false,
	expanded,
	openAriaLabel,
	onOpen,
	trailing,
}: {
	/** The original visited URL — the favicon source (MIK-034). */
	url: string;
	title: string;
	/** The clamped summary/description line under the title. */
	description?: string;
	/** Shown in the metadata line by the Ask AI card context. */
	domain?: string;
	genre?: string;
	tags: readonly string[];
	/** Extra metadata tail (e.g. the Library row's analysis profile id). */
	metaSuffix?: string;
	/** The Ask AI recommendation reason line; absent on Library rows. */
	reason?: string;
	aiStatus: AiStatus;
	/** Highlights the row while its detail drawer is open (Library). */
	selected?: boolean;
	/** `aria-expanded` of the open button; only the Library row sets it. */
	expanded?: boolean;
	openAriaLabel?: string;
	onOpen: () => void;
	/** Trailing column extras rendered under the status pill (Library). */
	trailing?: ReactNode;
}) {
	const hasMetadata =
		domain !== undefined ||
		genre !== undefined ||
		tags.length > 0 ||
		metaSuffix !== undefined;

	return (
		<div data-bookmark-summary style={selected ? rowSelected : rowStyle}>
			{/* Decorative site icon (MIK-032); the accessible text is the main
			    button next to it. marginTop aligns it with the first title line
			    in this flex-start row. */}
			<span style={{ marginTop: 1 }}>
				<Favicon pageUrl={url} size={22} />
			</span>
			<button
				type="button"
				style={rowOpenButton}
				aria-label={openAriaLabel}
				aria-expanded={expanded}
				onClick={onOpen}
			>
				<div style={{ fontSize: 14, fontWeight: 600, ...truncate }}>
					{title}
				</div>
				{description ? (
					<div
						style={{
							fontSize: 12,
							color: palette.inkSoft,
							marginTop: 2,
							...summaryClamp,
						}}
					>
						{description}
					</div>
				) : null}
				{hasMetadata ? (
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: 6,
							marginTop: 5,
							alignItems: "center",
						}}
					>
						{domain ? (
							<span style={{ fontSize: 11, color: palette.inkFaint }}>
								{domain}
							</span>
						) : null}
						{genre ? (
							<span style={{ fontSize: 11, color: palette.accent }}>
								{genre}
							</span>
						) : null}
						{tags.slice(0, SUMMARY_TAG_CAP).map((t) => (
							<span key={t} style={{ fontSize: 11, color: palette.inkFaint }}>
								#{t}
							</span>
						))}
						{metaSuffix ? (
							<span style={{ fontSize: 11, color: palette.inkFaint }}>
								{metaSuffix}
							</span>
						) : null}
					</div>
				) : null}
				{reason ? (
					<div style={{ fontSize: 12, color: palette.accent, marginTop: 4 }}>
						{reason}
					</div>
				) : null}
			</button>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
					gap: 4,
				}}
			>
				<StatusPill status={aiStatus} />
				{trailing}
			</div>
		</div>
	);
}
