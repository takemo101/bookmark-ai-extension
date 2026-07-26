/**
 * Pure transform: raw Summarizer API text → a {@link ConciseSummary}.
 *
 * The Summarizer fallback requests three Markdown key points, but the API makes
 * no schema promise, so *any* nonblank output is a usable fallback
 * (docs/summarizer-fallback.md "Summary configuration"). This module therefore
 * only:
 *   - preserves the generated Markdown as-is (trimmed) for the safe Markdown
 *     renderer, and
 *   - derives a deterministic one-line plain-text `description` for compact
 *     list/receipt display.
 *
 * Blank or punctuation-only output is *not* usable: it returns `null`, and the
 * analyzer then keeps the original Prompt API terminal outcome.
 *
 * Completely pure — no Chrome, no logging, no persistence.
 */
import type { ConciseSummary } from "./types";

/** Separator joining the generated key points into one compact line. */
const POINT_SEPARATOR = " / ";

/** Leading block-level Markdown marks: heading, list bullet/number, quote. */
const LEADING_BLOCK_MARK = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/;

/** Inline emphasis/code marks stripped from the plain-text description. */
const INLINE_MARK = /[*_`~]/g;

/** A line carries text only if something in it is a letter or a digit. */
const HAS_TEXT = /[\p{L}\p{N}]/u;

/**
 * Reduce one Markdown line to plain text: drop its block marker, its inline
 * emphasis/code marks, and any leftover whitespace runs.
 */
function toPlainLine(line: string): string {
	return line
		.replace(LEADING_BLOCK_MARK, "")
		.replace(INLINE_MARK, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Build a usable {@link ConciseSummary} from raw Summarizer output, or `null`
 * when the output carries no text.
 */
export function buildConciseSummary(raw: string): ConciseSummary | null {
	const analysisMarkdown = raw.trim();
	if (analysisMarkdown.length === 0) {
		return null;
	}
	const description = analysisMarkdown
		.split("\n")
		.map(toPlainLine)
		// Rule/bullet-only lines ("---", a stray "-") carry no key point.
		.filter((line) => HAS_TEXT.test(line))
		.join(POINT_SEPARATOR);
	if (description.length === 0) {
		return null;
	}
	return { description, analysisMarkdown };
}
