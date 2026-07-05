/**
 * Title-adjacent `?` help popover (MIK-052, popover since MIK-053).
 *
 * A button-driven disclosure — click/keyboard accessible, never hover-only —
 * whose panel renders with `position: fixed`, measured from the trigger at
 * open time, so an `overflow: hidden` ancestor (the Ask AI chat page) can
 * never clip it. The panel stays in the static markup (hidden while closed)
 * so tests can pin the guidance copy without dispatching events.
 *
 * Open/closed is view-only local state: it is never persisted and never
 * touches a controller. Closes on Escape, on any click outside the anchor,
 * and on a second trigger click. No third-party popover dependency.
 */
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { screenHelp } from "../styles";
import { useOptionsTheme } from "../theme";

/** Gap between the trigger's bottom edge and the popover panel. */
const PANEL_OFFSET = 8;
/** Keep the fixed panel this far inside the viewport edges. */
const PANEL_VIEWPORT_MARGIN = 8;
/** Must match the {@link screenHelpPanel} width for edge clamping. */
const PANEL_WIDTH = 320;

type PanelPosition = { readonly top: number; readonly left: number };

/** Fixed-position coordinates for the panel, clamped into the viewport. */
function panelPositionFor(
	trigger: Pick<HTMLElement, "getBoundingClientRect">,
	viewportWidth: number,
): PanelPosition {
	const rect = trigger.getBoundingClientRect();
	const maxLeft = viewportWidth - PANEL_WIDTH - PANEL_VIEWPORT_MARGIN;
	return {
		top: rect.bottom + PANEL_OFFSET,
		left: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
	};
}

export function ScreenHelp({
	label,
	children,
}: {
	/** Accessible name of the `?` trigger (e.g. "Library help"). */
	label: string;
	/** The explanatory guidance disclosed by the popover. */
	children: ReactNode;
}) {
	const { styles } = useOptionsTheme();
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<PanelPosition | undefined>();
	const anchorRef = useRef<HTMLSpanElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelId = useId();

	function toggle(): void {
		if (!open && triggerRef.current) {
			setPosition(panelPositionFor(triggerRef.current, window.innerWidth));
		}
		setOpen((current) => !current);
	}

	useEffect(() => {
		if (!open) {
			return;
		}
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				setOpen(false);
			}
		}
		function onPointerDown(event: MouseEvent): void {
			// A click anywhere outside the anchor (trigger + panel) closes; the
			// trigger's own click is handled by its toggle instead.
			const anchor = anchorRef.current;
			if (
				anchor &&
				event.target instanceof Node &&
				!anchor.contains(event.target)
			) {
				setOpen(false);
			}
		}
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("mousedown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("mousedown", onPointerDown);
		};
	}, [open]);

	return (
		<span ref={anchorRef} style={screenHelp}>
			<button
				ref={triggerRef}
				type="button"
				aria-label={label}
				aria-expanded={open}
				aria-controls={panelId}
				style={styles.screenHelpTrigger}
				onClick={toggle}
			>
				?
			</button>
			<div
				id={panelId}
				hidden={!open}
				style={{
					...styles.screenHelpPanel,
					top: position?.top,
					left: position?.left,
				}}
			>
				{children}
			</div>
		</span>
	);
}
