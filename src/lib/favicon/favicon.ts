/**
 * Display-only favicon resolution for bookmark URLs (MIK-032).
 *
 * Chrome MV3 serves site favicons through the extension-local `_favicon`
 * endpoint (`chrome-extension://<id>/_favicon/?pageUrl=…&size=…`), enabled by
 * the `favicon` manifest permission — no external favicon service and no host
 * permissions (https://developer.chrome.com/docs/extensions/how-to/ui/favicons).
 *
 * Everything here is derived at render time from the bookmark URL: no favicon
 * image data is ever persisted to bookmark records, settings, Drive, or the
 * local cache (docs/privacy-policy.md). The Chrome runtime is read defensively
 * via `globalThis.chrome` — off-extension (tests, standalone renders) it is
 * simply `undefined` and the view degrades to the fallback glyph (MIK-015
 * posture, same as `popup/open-options.ts`).
 */

/** What the UI needs to render a favicon: an image URL and a text fallback. */
export type FaviconView = {
	/** `_favicon` endpoint URL, or `undefined` off-extension / for bad URLs. */
	readonly src?: string;
	/** Single glyph shown when no image can render (hostname initial or `•`). */
	readonly fallback: string;
};

/** The narrow slice of `chrome.runtime` this helper reads. Injectable in tests. */
export type FaviconRuntime = {
	getURL(path: string): string;
};

/** Glyph for URLs whose hostname yields no usable initial. */
const NEUTRAL_GLYPH = "•";

const DEFAULT_SIZE = 32;

function defaultRuntime(): FaviconRuntime | undefined {
	// Reading the bare `chrome` identifier throws `ReferenceError` when the
	// global is undeclared; `globalThis.chrome` is always safe to read.
	const chromeLike = (
		globalThis as {
			chrome?: { runtime?: { getURL?: (path: string) => string } };
		}
	).chrome;
	const runtime = chromeLike?.runtime;
	if (!runtime?.getURL) {
		return undefined;
	}
	return { getURL: (path) => runtime.getURL?.(path) ?? "" };
}

/**
 * The fallback glyph for a page URL: the first character of its hostname
 * (ignoring a leading `www.`), uppercased. Invalid or hostless URLs yield the
 * neutral glyph instead of throwing.
 */
export function faviconFallback(pageUrl: string): string {
	let hostname: string;
	try {
		hostname = new URL(pageUrl).hostname;
	} catch {
		return NEUTRAL_GLYPH;
	}
	const first = [...hostname.replace(/^www\./, "")][0];
	return first ? first.toUpperCase() : NEUTRAL_GLYPH;
}

/**
 * Build the favicon view for a bookmark URL. `src` is present only when both
 * the Chrome runtime is reachable (or injected) and the URL parses; the
 * fallback glyph is always present so the UI never renders an empty box.
 */
export function faviconView(
	pageUrl: string,
	options: { size?: number; runtime?: FaviconRuntime } = {},
): FaviconView {
	const fallback = faviconFallback(pageUrl);
	if (fallback === NEUTRAL_GLYPH) {
		// The URL did not parse (or has no hostname); requesting a favicon for it
		// would only ever return Chrome's placeholder document icon.
		return { fallback };
	}
	const runtime = options.runtime ?? defaultRuntime();
	if (!runtime) {
		return { fallback };
	}
	const size = options.size ?? DEFAULT_SIZE;
	const base = runtime.getURL("/_favicon/");
	return {
		src: `${base}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`,
		fallback,
	};
}
