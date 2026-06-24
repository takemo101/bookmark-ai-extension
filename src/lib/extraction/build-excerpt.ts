/**
 * Pure structured-excerpt builder.
 *
 * Turns a sanitized {@link ExtractedPage} into a {@link PageExcerpt} for AI
 * analysis. The build is deterministic and depends on no Chrome, Drive,
 * storage, React, or AI APIs, so it is unit-testable in isolation (see
 * docs/design.md "Page Extraction" and docs/implementation-principles.md
 * "Model-first implementation order" step 5).
 *
 * Priority order of sections — earlier sections survive truncation:
 *   1. Title
 *   2. Canonical URL (falls back to the page URL)
 *   3. Meta description
 *   4. Open Graph title
 *   5. Open Graph description
 *   6. Headings
 *   7. Selected visible main text
 *
 * The result is never persisted; it is a transient input to AI analysis. See
 * docs/privacy-policy.md "Page Text Excerpts".
 */
import type { ExtractedPage, PageExcerpt } from "./types";

/**
 * Default excerpt character cap. The design calls for "roughly 8k-12k
 * characters" (docs/design.md "Page Extraction"); 12000 is chosen as the
 * documented default to give AI analysis the most context within that range.
 */
export const DEFAULT_EXCERPT_CHAR_CAP = 12000;

const SECTION_SEPARATOR = "\n\n";

export type BuildExcerptOptions = {
	/** Override the character cap. Defaults to {@link DEFAULT_EXCERPT_CHAR_CAP}. */
	maxChars?: number;
};

/** Ordered, labeled excerpt sections. Empty sections are omitted upstream. */
function orderedSections(page: ExtractedPage): string[] {
	const sections: string[] = [];

	sections.push(`Title: ${page.title}`);
	sections.push(`URL: ${page.canonicalUrl ?? page.url}`);

	if (page.metaDescription !== undefined) {
		sections.push(`Description: ${page.metaDescription}`);
	}
	if (page.ogTitle !== undefined) {
		sections.push(`OG Title: ${page.ogTitle}`);
	}
	if (page.ogDescription !== undefined) {
		sections.push(`OG Description: ${page.ogDescription}`);
	}
	if (page.headings.length > 0) {
		const lines = page.headings.map((h) => `- ${h.text}`).join("\n");
		sections.push(`Headings:\n${lines}`);
	}
	if (page.mainText.length > 0) {
		sections.push(`Content:\n${page.mainText.join("\n\n")}`);
	}

	return sections;
}

/**
 * Build a capped, structured excerpt. Sections are appended in priority order
 * until the next section would exceed the cap; at that point the remaining
 * budget is filled with a deterministic prefix of that section and the rest is
 * dropped. The returned `text.length` never exceeds the cap.
 */
export function buildExcerpt(
	page: ExtractedPage,
	options: BuildExcerptOptions = {},
): PageExcerpt {
	const cap = Math.max(0, Math.trunc(options.maxChars ?? DEFAULT_EXCERPT_CHAR_CAP));
	const sections = orderedSections(page);

	let text = "";
	let truncated = false;

	for (const section of sections) {
		const addition = text.length === 0 ? section : SECTION_SEPARATOR + section;
		if (text.length + addition.length <= cap) {
			text += addition;
			continue;
		}
		// Section does not fit: fill any remaining budget deterministically, then
		// stop. Anything not appended is considered truncated.
		const remaining = cap - text.length;
		if (remaining > 0) {
			text += addition.slice(0, remaining);
		}
		truncated = true;
		break;
	}

	return { text, length: text.length, truncated, cap };
}
