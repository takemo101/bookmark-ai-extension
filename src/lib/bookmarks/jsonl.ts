/**
 * JSONL parsing and serialization for the bookmark store.
 *
 * The store is one JSON object per line (current-state records, not an event
 * log — see docs/design.md "Bookmark Data Model"). Parsing is intentionally
 * total: a malformed line never throws and never aborts the whole file. Each
 * problem line is reported with its 1-based line number and quarantined, so a
 * single bad record on one PC cannot destroy the rest of the library.
 */
import {
	type BookmarkRecord,
	parseBookmarkRecord,
	serializeBookmarkRecord,
} from "./record";

export type JsonlProblemKind =
	| "malformed-json"
	| "not-an-object"
	| "unsupported-schema"
	| "invalid-field";

export type JsonlProblem = {
	readonly line: number;
	readonly kind: JsonlProblemKind;
	readonly message: string;
	readonly raw: string;
};

export type JsonlParseResult = {
	readonly records: BookmarkRecord[];
	readonly problems: JsonlProblem[];
};

function classify(field: string): JsonlProblemKind {
	if (field === "schemaVersion") return "unsupported-schema";
	if (field === "record") return "not-an-object";
	return "invalid-field";
}

/**
 * Parse JSONL text. Blank/whitespace-only lines are skipped silently; every
 * other failure becomes a {@link JsonlProblem}. Valid lines become
 * always-valid {@link BookmarkRecord}s.
 */
export function parseJsonl(text: string): JsonlParseResult {
	const records: BookmarkRecord[] = [];
	const problems: JsonlProblem[] = [];

	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const line = i + 1;
		if (raw.trim().length === 0) {
			continue;
		}

		let decoded: unknown;
		try {
			decoded = JSON.parse(raw);
		} catch {
			problems.push({
				line,
				kind: "malformed-json",
				message: "line is not valid JSON",
				raw,
			});
			continue;
		}

		const parsed = parseBookmarkRecord(decoded);
		if (!parsed.ok) {
			problems.push({
				line,
				kind: classify(parsed.error.field),
				message: parsed.error.message,
				raw,
			});
			continue;
		}
		records.push(parsed.value);
	}

	return { records, problems };
}

/**
 * Serialize records to JSONL: one compact JSON object per line, terminated by a
 * trailing newline. `parseJsonl(serializeJsonl(records))` round-trips the
 * records (the trailing newline is parsed as a skipped blank line).
 */
export function serializeJsonl(records: readonly BookmarkRecord[]): string {
	if (records.length === 0) {
		return "";
	}
	return `${records
		.map((record) => JSON.stringify(serializeBookmarkRecord(record)))
		.join("\n")}\n`;
}
