import { lightThemePalette } from "../lib/theme/index";

type PageResetTarget = {
	style: {
		margin: string;
		background: string;
	};
};

/**
 * Paint the Popup document body with the active theme's paper color, so no
 * background mismatch appears around the receipt surface when the theme
 * resolves or changes after mount.
 */
export function paintPopupPageBackground(
	body: PageResetTarget,
	paper: string,
): void {
	body.style.background = paper;
}

/**
 * Remove the browser's default body margin and paint the Popup document with
 * the paper color (MIK-056) before first paint. The pre-mount default is the
 * light Warm Library paper; once the theme store resolves the persisted
 * preference the mounted popup repaints via
 * {@link paintPopupPageBackground}. Popup-local by design: the Options page
 * owns its own reset (`options/page-reset.ts`) and `popup/*` must not depend
 * on Options page concerns for a two-line rule.
 */
export function applyPopupPageReset(
	body: PageResetTarget,
	paper: string = lightThemePalette.paper,
): () => void {
	const previousMargin = body.style.margin;
	const previousBackground = body.style.background;
	body.style.margin = "0";
	paintPopupPageBackground(body, paper);
	return () => {
		body.style.margin = previousMargin;
		body.style.background = previousBackground;
	};
}
