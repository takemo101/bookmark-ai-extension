type PageResetTarget = {
	style: {
		margin: string;
	};
};

/**
 * Remove the browser's default body margin for the Options page so all outer
 * spacing is owned by the app header/screen shell style tokens.
 */
export function applyOptionsPageReset(body: PageResetTarget): () => void {
	const previousMargin = body.style.margin;
	body.style.margin = "0";
	return () => {
		body.style.margin = previousMargin;
	};
}
