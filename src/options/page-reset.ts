import { palette } from "./styles";

type PageResetTarget = {
	style: {
		margin: string;
		background: string;
	};
};

/**
 * Remove the browser's default body margin and paint the Options document with
 * the Warm Library paper color, so no outer gutter or background mismatch
 * appears around the app header/screen shell. Options-local by design: the
 * Popup owns its own reset (`popup/page-reset.ts`) and `options/*` must not
 * depend on Popup page concerns for a two-line rule.
 */
export function applyOptionsPageReset(body: PageResetTarget): () => void {
	const previousMargin = body.style.margin;
	const previousBackground = body.style.background;
	body.style.margin = "0";
	body.style.background = palette.paper;
	return () => {
		body.style.margin = previousMargin;
		body.style.background = previousBackground;
	};
}
