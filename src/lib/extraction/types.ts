/**
 * Extraction data shapes.
 *
 * Two shapes exist on purpose, mirroring the bookmark domain split between an
 * on-the-wire shape and an always-valid domain value:
 *
 *   - {@link RawExtractedPage} is the loose, untrusted shape produced by the
 *     in-page extractor and handed back across the `chrome.scripting` boundary.
 *     Every field is `unknown` because nothing about a third-party page can be
 *     trusted before parsing.
 *   - {@link ExtractedPage} is the sanitized, trusted shape. It can only be
 *     produced by {@link parseExtractedPage}, so malformed extraction output
 *     never leaks inward. See docs/implementation-principles.md "Parse, don't
 *     validate".
 *
 * Neither shape is a {@link BookmarkRecord}: the raw visible text in
 * {@link ExtractedPage.mainText} and the built excerpt are inputs to AI
 * analysis only and must never be persisted. See docs/privacy-policy.md "Page
 * Text Excerpts".
 */

/** A single page heading. `level` is the heading rank (1 for h1, 2 for h2, …). */
export type Heading = {
	readonly level: number;
	readonly text: string;
};

/**
 * Loose shape returned by the injected in-page extractor. Serialized across the
 * `chrome.scripting.executeScript` boundary, so all fields are untrusted.
 */
export type RawExtractedPage = {
	url?: unknown;
	title?: unknown;
	canonicalUrl?: unknown;
	metaDescription?: unknown;
	ogTitle?: unknown;
	ogDescription?: unknown;
	lang?: unknown;
	headings?: unknown;
	mainText?: unknown;
};

/** Sanitized, trusted page data. Produced only by {@link parseExtractedPage}. */
export type ExtractedPage = {
	readonly url: string;
	readonly title: string;
	readonly canonicalUrl?: string;
	readonly metaDescription?: string;
	readonly ogTitle?: string;
	readonly ogDescription?: string;
	readonly lang?: string;
	readonly headings: readonly Heading[];
	readonly mainText: readonly string[];
};

/** Recoverable parse failure at the extraction boundary. */
export type ExtractionError = {
	readonly field: string;
	readonly message: string;
};

/**
 * Structured excerpt built from an {@link ExtractedPage}. Bounded by a
 * deterministic character cap. This is a transient AI input — it is never stored
 * in `bookmarks.jsonl`.
 */
export type PageExcerpt = {
	/** The capped excerpt text. `text.length` never exceeds the cap. */
	readonly text: string;
	/** Convenience: equals `text.length`. */
	readonly length: number;
	/** True when content was dropped or cut to fit the cap. */
	readonly truncated: boolean;
	/** The character cap that was applied. */
	readonly cap: number;
};
