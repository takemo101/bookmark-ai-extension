/**
 * Shared right drawer (MIK-053): the one overlay foundation for the bookmark
 * detail drawer (MIK-022) and the analysis skill create/edit drawer, so both
 * close the same way and neither drifts into a one-off modal again.
 *
 * Shared behavior:
 *
 * - fixed backdrop with a right-aligned panel (`role="dialog"`,
 *   `aria-modal`, labelled by the consumer's title element);
 * - Escape closes;
 * - only a *true* backdrop click closes — clicks inside the panel bubble up
 *   with a different target and are ignored;
 * - narrow viewports switch the panel to fullscreen width;
 * - header/body/footer slots; the body owns internal vertical scrolling.
 *
 * Open/close state stays in the consumer's controller; this component only
 * renders the chrome and reports close intents through `onClose`. Locking
 * the underlying page scroll stays at the screen/root level
 * (`useLockBodyScroll`), unchanged.
 */
import type { ReactNode } from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import {
	drawerBackdrop,
	drawerBody,
	drawerFooter,
	drawerHeader,
	drawerPanel,
	drawerPanelFullscreen,
} from "../styles";

/** Media query below which the drawer panel goes fullscreen. */
const NARROW_VIEWPORT_QUERY = "(max-width: 720px)";

function subscribeToNarrowViewport(onChange: () => void): () => void {
	const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

/**
 * Whether the viewport is too narrow for a partial-width drawer. Options-
 * local by design; the server snapshot (`false`) only matters for static
 * rendering in tests.
 */
function useIsNarrowViewport(): boolean {
	return useSyncExternalStore(
		subscribeToNarrowViewport,
		() => window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
		() => false,
	);
}

export function Drawer({
	labelledBy,
	onClose,
	header,
	footer,
	children,
}: {
	/** id of the element inside `header` that names the dialog. */
	labelledBy: string;
	/** Close intent: Escape, true backdrop click, or a consumer close button. */
	onClose: () => void;
	header: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	const isNarrow = useIsNarrowViewport();
	const backdropRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	useEffect(() => {
		const backdrop = backdropRef.current;
		if (!backdrop) {
			return;
		}
		function onBackdropClick(event: MouseEvent): void {
			if (event.target === backdrop) {
				onClose();
			}
		}
		backdrop.addEventListener("click", onBackdropClick);
		return () => backdrop.removeEventListener("click", onBackdropClick);
	}, [onClose]);

	return (
		<div ref={backdropRef} style={drawerBackdrop}>
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelledBy}
				style={isNarrow ? drawerPanelFullscreen : drawerPanel}
			>
				<header style={drawerHeader}>{header}</header>
				<div style={drawerBody}>{children}</div>
				{footer ? <footer style={drawerFooter}>{footer}</footer> : null}
			</section>
		</div>
	);
}
