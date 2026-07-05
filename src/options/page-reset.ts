import { lightThemePalette } from "../lib/theme/index";

type PageResetTarget = {
	style: {
		margin: string;
		background: string;
	};
};

/**
 * Paint the Options document body with the active theme's paper color, so no
 * background mismatch appears around the app header/screen shell when the
 * theme resolves or changes after mount.
 */
export function paintOptionsPageBackground(
	body: PageResetTarget,
	paper: string,
): void {
	body.style.background = paper;
}

/**
 * Remove the browser's default body margin and paint the Options document
 * with the paper color before first paint. The pre-mount default is the
 * light Warm Library paper; once the theme store resolves the persisted
 * preference the mounted page repaints via
 * {@link paintOptionsPageBackground}. Options-local by design: the Popup
 * owns its own reset (`popup/page-reset.ts`) and `options/*` must not depend
 * on Popup page concerns for a two-line rule.
 */
export function applyOptionsPageReset(
	body: PageResetTarget,
	paper: string = lightThemePalette.paper,
): () => void {
	const previousMargin = body.style.margin;
	const previousBackground = body.style.background;
	body.style.margin = "0";
	paintOptionsPageBackground(body, paper);
	return () => {
		body.style.margin = previousMargin;
		body.style.background = previousBackground;
	};
}
