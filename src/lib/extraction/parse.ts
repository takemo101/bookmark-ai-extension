/**
 * Boundary parser/sanitizer for injected extraction output.
 *
 * The in-page extractor runs in an untrusted document and is serialized back
 * across the `chrome.scripting` boundary, so its output must be parsed into a
 * trusted {@link ExtractedPage} before any internal use. Loose, recoverable
 * problems (a malformed heading entry, a blank paragraph) are sanitized away;
 * only a fundamentally unusable payload (not an object, no URL) is rejected.
 *
 * See docs/implementation-principles.md "Parse, don't validate".
 */
import { type Result, err, ok } from "./result";
import type {
	ExtractedPage,
	ExtractionError,
	Heading,
	RawExtractedPage,
} from "./types";

function extractionError(field: string, message: string): ExtractionError {
	return { field, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collapse internal whitespace and trim. Returns `undefined` for blanks. */
function cleanText(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const collapsed = value.replace(/\s+/g, " ").trim();
	return collapsed.length > 0 ? collapsed : undefined;
}

/** Trim only (URLs must not have their internal characters rewritten). */
function trimmedUrl(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Sanitize a raw headings value. Accepts an array whose entries are either
 * strings or `{ level, text }`-ish objects. Malformed or blank entries are
 * dropped rather than failing the whole parse.
 */
function parseHeadings(value: unknown): Heading[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const headings: Heading[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const text = cleanText(entry);
			if (text !== undefined) {
				headings.push({ level: 1, text });
			}
			continue;
		}
		if (isObject(entry)) {
			const text = cleanText(entry.text);
			if (text === undefined) {
				continue;
			}
			const rawLevel = entry.level;
			const level =
				typeof rawLevel === "number" && Number.isFinite(rawLevel)
					? Math.min(6, Math.max(1, Math.trunc(rawLevel)))
					: 1;
			headings.push({ level, text });
		}
	}
	return headings;
}

/**
 * Sanitize raw main-text. Accepts a single string or an array of strings; each
 * block is whitespace-collapsed and blanks are dropped so the excerpt builder
 * receives deterministic input.
 */
function parseMainText(value: unknown): string[] {
	if (typeof value === "string") {
		const cleaned = cleanText(value);
		return cleaned !== undefined ? [cleaned] : [];
	}
	if (!Array.isArray(value)) {
		return [];
	}
	const blocks: string[] = [];
	for (const entry of value) {
		const cleaned = cleanText(entry);
		if (cleaned !== undefined) {
			blocks.push(cleaned);
		}
	}
	return blocks;
}

/**
 * Parse loose {@link RawExtractedPage} output into a trusted
 * {@link ExtractedPage}. A non-object payload or a missing/blank URL is a
 * recoverable error; everything else is sanitized. Unknown extra fields (e.g. a
 * stray `excerpt`) are ignored and can never flow inward.
 */
export function parseExtractedPage(
	value: unknown,
): Result<ExtractedPage, ExtractionError> {
	if (!isObject(value)) {
		return err(extractionError("page", "extraction output must be an object"));
	}

	const raw = value as RawExtractedPage;

	const url = trimmedUrl(raw.url);
	if (url === undefined) {
		return err(extractionError("url", "extraction output must include a url"));
	}

	// Title falls back to the URL so the excerpt always has a leading anchor.
	const title = cleanText(raw.title) ?? url;

	const page: ExtractedPage = {
		url,
		title,
		canonicalUrl: trimmedUrl(raw.canonicalUrl),
		metaDescription: cleanText(raw.metaDescription),
		ogTitle: cleanText(raw.ogTitle),
		ogDescription: cleanText(raw.ogDescription),
		lang: cleanText(raw.lang),
		headings: parseHeadings(raw.headings),
		mainText: parseMainText(raw.mainText),
	};

	return ok(page);
}
