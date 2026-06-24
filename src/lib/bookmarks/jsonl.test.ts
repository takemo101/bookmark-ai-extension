import { describe, expect, it } from "vitest";

import { parseJsonl, serializeJsonl } from "./jsonl";
import { type BookmarkRecordV1 } from "./record";

function line(overrides: Partial<BookmarkRecordV1> = {}): string {
	const record: BookmarkRecordV1 = {
		schemaVersion: 1,
		id: "bm-1",
		canonicalUrl: "https://example.com/a",
		url: "https://example.com/a",
		title: "Example",
		tags: [],
		aiStatus: "pending",
		createdAt: "2026-06-25T00:00:00.000Z",
		updatedAt: "2026-06-25T00:00:00.000Z",
		...overrides,
	};
	return JSON.stringify(record);
}

describe("parseJsonl", () => {
	it("parses valid lines into records", () => {
		const text = [line({ id: "bm-1" }), line({ id: "bm-2", url: "https://example.com/b", canonicalUrl: "https://example.com/b" })].join(
			"\n",
		);
		const result = parseJsonl(text);
		expect(result.records).toHaveLength(2);
		expect(result.problems).toHaveLength(0);
	});

	it("skips empty and whitespace-only lines without reporting them", () => {
		const text = ["", line(), "   ", ""].join("\n");
		const result = parseJsonl(text);
		expect(result.records).toHaveLength(1);
		expect(result.problems).toHaveLength(0);
	});

	it("reports malformed JSON with its line number", () => {
		const text = [line(), "{ not json", line({ id: "bm-3" })].join("\n");
		const result = parseJsonl(text);
		expect(result.records).toHaveLength(2);
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0]).toMatchObject({
			line: 2,
			kind: "malformed-json",
		});
	});

	it("reports an unsupported schema version", () => {
		const text = line({ schemaVersion: 9 as 1 });
		const result = parseJsonl(text);
		expect(result.records).toHaveLength(0);
		expect(result.problems[0].kind).toBe("unsupported-schema");
	});

	it("reports a non-object line", () => {
		const result = parseJsonl("42");
		expect(result.problems[0].kind).toBe("not-an-object");
	});

	it("reports invalid fields", () => {
		const result = parseJsonl(line({ createdAt: "nope" }));
		expect(result.records).toHaveLength(0);
		expect(result.problems[0].kind).toBe("invalid-field");
	});

	it("keeps good records while quarantining bad lines", () => {
		const text = [
			line({ id: "good-1" }),
			"garbage",
			line({ id: "bad", aiStatus: "???" as "pending" }),
			line({ id: "good-2", url: "https://example.com/c", canonicalUrl: "https://example.com/c" }),
		].join("\n");
		const result = parseJsonl(text);
		expect(result.records.map((r) => r.id)).toEqual(["good-1", "good-2"]);
		expect(result.problems.map((p) => p.line)).toEqual([2, 3]);
	});
});

describe("serializeJsonl", () => {
	it("round-trips records through serialize → parse", () => {
		const text = [
			line({ id: "bm-1" }),
			line({ id: "bm-2", url: "https://example.com/b", canonicalUrl: "https://example.com/b" }),
		].join("\n");
		const parsed = parseJsonl(text);
		const serialized = serializeJsonl(parsed.records);
		const reparsed = parseJsonl(serialized);
		expect(reparsed.problems).toHaveLength(0);
		expect(reparsed.records).toEqual(parsed.records);
	});

	it("ends with a trailing newline that parses as a skipped blank line", () => {
		const parsed = parseJsonl(line());
		const serialized = serializeJsonl(parsed.records);
		expect(serialized.endsWith("\n")).toBe(true);
		expect(parseJsonl(serialized).problems).toHaveLength(0);
	});

	it("serializes an empty collection to an empty string", () => {
		expect(serializeJsonl([])).toBe("");
	});
});
