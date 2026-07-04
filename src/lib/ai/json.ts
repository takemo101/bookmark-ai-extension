/**
 * Shared tolerant JSON helpers for AI boundary parsers.
 *
 * Models often wrap JSON in prose or ```code fences```; parsers scan for the
 * first balanced `{…}` object so surrounding text is ignored. Used by
 * ./parse.ts (page analysis) and ./ask-ai-recommendation.ts.
 */

/**
 * Extract the first balanced JSON object substring from arbitrary text,
 * respecting string literals and escapes so braces inside strings don't confuse
 * the scan. Returns null when no balanced object is present.
 */
export function extractJsonObject(text: string): string | null {
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

export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
