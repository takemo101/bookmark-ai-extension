/**
 * Pure parser: raw Prompt API text → typed {@link PageAnalysis}.
 *
 * This is the AI boundary's "parse, don't validate" step. It is completely pure
 * — no Chrome, no Prompt API, no clock — so it is unit-testable in isolation.
 * Malformed output (no JSON, bad JSON, wrong shape, missing/blank required
 * fields) becomes a typed {@link AnalysisParseError}, which the analyzer maps to
 * a `failed` status. See docs/implementation-principles.md "Error handling
 * policy".
 *
 * Tolerance: models often wrap JSON in prose or ```code fences```. The parser
 * scans for the first balanced `{…}` object, so surrounding text is ignored.
 */
import { type Result, err, ok } from "./result";
import {
	MAX_TAGS,
	type AnalysisParseError,
	type AnalysisParseErrorKind,
	type PageAnalysis,
} from "./types";

function parseError(
	kind: AnalysisParseErrorKind,
	message: string,
	field?: string,
): AnalysisParseError {
	return field === undefined ? { kind, message } : { kind, field, message };
}

/**
 * Extract the first balanced JSON object substring from arbitrary text,
 * respecting string literals and escapes so braces inside strings don't confuse
 * the scan. Returns null when no balanced object is present.
 */
function extractJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	if (start === -1) {
		return null;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize the raw `tags` field: must be an array; each entry trimmed, blanks
 * and non-strings dropped, case-insensitive duplicates removed, capped at
 * {@link MAX_TAGS}. Excess tags are excess, not malformed — they are dropped,
 * not rejected.
 */
function parseTagList(value: unknown): Result<string[], AnalysisParseError> {
	if (!Array.isArray(value)) {
		return err(parseError("invalid-field", "tags must be an array", "tags"));
	}
	const seen = new Set<string>();
	const tags: string[] = [];
	for (const raw of value) {
		if (typeof raw !== "string") {
			continue;
		}
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		tags.push(trimmed);
		if (tags.length >= MAX_TAGS) {
			break;
		}
	}
	return ok(tags);
}

/**
 * Parse raw model output into a {@link PageAnalysis}. `description` and `tags`
 * are required; `genre` is optional (a blank or non-string genre is dropped
 * rather than failing the whole analysis).
 */
export function parseAnalysis(
	raw: unknown,
): Result<PageAnalysis, AnalysisParseError> {
	if (typeof raw !== "string") {
		return err(parseError("invalid-field", "AI output must be a string"));
	}
	if (raw.trim().length === 0) {
		return err(parseError("empty-output", "AI output was empty"));
	}

	const jsonText = extractJsonObject(raw);
	if (jsonText === null) {
		return err(parseError("no-json", "no JSON object found in AI output"));
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(jsonText);
	} catch (error) {
		return err(
			parseError(
				"invalid-json",
				`AI output was not valid JSON: ${(error as Error).message}`,
			),
		);
	}

	if (!isObject(decoded)) {
		return err(parseError("not-object", "AI output JSON was not an object"));
	}

	if (decoded.description === undefined) {
		return err(parseError("missing-field", "description is required", "description"));
	}
	if (typeof decoded.description !== "string") {
		return err(
			parseError("invalid-field", "description must be a string", "description"),
		);
	}
	const description = decoded.description.trim();
	if (description.length === 0) {
		return err(
			parseError("empty-description", "description must not be empty", "description"),
		);
	}

	if (decoded.tags === undefined) {
		return err(parseError("missing-field", "tags is required", "tags"));
	}
	const tags = parseTagList(decoded.tags);
	if (!tags.ok) {
		return tags;
	}

	let genre: string | undefined;
	if (typeof decoded.genre === "string" && decoded.genre.trim().length > 0) {
		genre = decoded.genre.trim();
	}

	const analysis: PageAnalysis = genre === undefined
		? { description, tags: tags.value }
		: { description, genre, tags: tags.value };
	return ok(analysis);
}
