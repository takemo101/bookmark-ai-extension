/**
 * In-page extraction function.
 *
 * {@link extractPageContent} is intended to be injected into the active tab via
 * `chrome.scripting.executeScript({ target, func: extractPageContent })` only
 * after the user clicks Save (see docs/design.md "Save Flow" and "Privacy
 * Posture"; AGENTS.md security rules). It runs inside the page, so it must be
 * fully self-contained: it closes over no module imports and touches only DOM
 * globals, because the function body is serialized to the target frame.
 *
 * It returns a loose {@link RawExtractedPage}; callers must run the output
 * through {@link parseExtractedPage} before any internal use. This module owns
 * no persistence — raw text is never stored here.
 */
import type { RawExtractedPage } from "./types";

/**
 * Generic, site-agnostic page extractor. No site-specific adapters, no crawling
 * — it reads metadata and visible main text from the current document only.
 */
export function extractPageContent(): RawExtractedPage {
	const metaContent = (selector: string): string | undefined => {
		const el = document.querySelector(selector);
		const content = el?.getAttribute("content");
		return content !== null && content !== undefined ? content : undefined;
	};

	const canonical = document
		.querySelector('link[rel="canonical"]')
		?.getAttribute("href");

	const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(
		(el) => ({
			level: Number(el.tagName.slice(1)) || 1,
			text: el.textContent ?? "",
		}),
	);

	// Prefer a semantic main/article region, fall back to the body. Collect the
	// rendered text of block-level candidates; `innerText` reflects what is
	// actually visible, which keeps hidden boilerplate out of the excerpt.
	const root = document.querySelector("main, article") ?? document.body;
	const mainText: string[] = [];
	if (root) {
		const blocks = root.querySelectorAll(
			"p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, dd",
		);
		for (const node of Array.from(blocks)) {
			const el = node as HTMLElement;
			const text = (el.innerText ?? el.textContent ?? "").trim();
			if (text.length > 0) {
				mainText.push(text);
			}
		}
	}

	return {
		url: location.href,
		title: document.title,
		canonicalUrl: canonical ?? undefined,
		metaDescription: metaContent('meta[name="description"]'),
		ogTitle: metaContent('meta[property="og:title"]'),
		ogDescription: metaContent('meta[property="og:description"]'),
		lang: document.documentElement.getAttribute("lang") ?? undefined,
		headings,
		mainText,
	};
}
