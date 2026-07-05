import { palette } from "./styles";

type PageResetTarget = {
	style: {
		margin: string;
		background: string;
	};
};

/**
 * Remove the browser's default body margin and paint the Popup document with
 * the Warm Library paper color (MIK-056), so no outer gutter or background
 * mismatch appears around the receipt surface. Popup-local by design: the
 * Options page owns its own reset (`options/page-reset.ts`) and `popup/*`
 * must not depend on Options page concerns for a two-line rule.
 */
export function applyPopupPageReset(body: PageResetTarget): () => void {
	const previousMargin = body.style.margin;
	const previousBackground = body.style.background;
	body.style.margin = "0";
	body.style.background = palette.paper;
	return () => {
		body.style.margin = previousMargin;
		body.style.background = previousBackground;
	};
}
