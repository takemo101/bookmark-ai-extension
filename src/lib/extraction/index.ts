/**
 * `extraction/*` boundary.
 *
 * Owns current-page extraction and structured excerpt construction (capped
 * around 8k-12k characters). It is independent of Drive, storage, React, and
 * AI, and it never persists raw page excerpts. See docs/design.md "Page
 * Extraction" and docs/implementation-principles.md "Module boundary rules".
 *
 * Surface:
 *   - {@link extractPageContent} — injected in-page extractor (needs the DOM).
 *   - {@link parseExtractedPage} — boundary parser/sanitizer (pure).
 *   - {@link buildExcerpt} — deterministic structured excerpt builder (pure).
 */
export type { Result, Ok, Err } from "./result";
export { ok, err } from "./result";

export type {
	Heading,
	RawExtractedPage,
	ExtractedPage,
	ExtractionError,
	PageExcerpt,
} from "./types";

export { parseExtractedPage } from "./parse";

export {
	DEFAULT_EXCERPT_CHAR_CAP,
	buildExcerpt,
	type BuildExcerptOptions,
} from "./build-excerpt";

export { extractPageContent } from "./extract-page";
