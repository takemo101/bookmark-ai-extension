import { describe, expect, it } from "vitest";

import {
	type BookmarkRecordV1,
	createBookmarkRecord,
	parseBookmarkRecord,
	serializeBookmarkRecord,
} from "./record";
import { bookmarkId, isoTimestamp } from "./values";

function validV1(overrides: Partial<BookmarkRecordV1> = {}): BookmarkRecordV1 {
	return {
		schemaVersion: 1,
		id: "bm-1",
		canonicalUrl: "https://example.com/a",
		url: "https://example.com/a",
		title: "Example",
		tags: ["GitHub", "TypeScript"],
		aiStatus: "ready",
		createdAt: "2026-06-25T00:00:00.000Z",
		updatedAt: "2026-06-25T01:00:00.000Z",
		...overrides,
	};
}

describe("parseBookmarkRecord", () => {
	it("parses a valid record into branded domain values", () => {
		const result = parseBookmarkRecord(validV1());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.id).toBe("bm-1");
			expect(result.value.title).toBe("Example");
			expect(result.value.tags).toEqual(["GitHub", "TypeScript"]);
		}
	});

	it("derives canonicalUrl from url when absent", () => {
		const record = validV1();
		const { canonicalUrl: _omit, ...withoutCanonical } = record;
		void _omit;
		const result = parseBookmarkRecord({
			...withoutCanonical,
			url: "https://www.example.com/a?utm_source=x",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.canonicalUrl).toBe("https://example.com/a");
		}
	});

	it("falls back the title to the URL when empty", () => {
		const result = parseBookmarkRecord(validV1({ title: "   " }));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.title).toBe("https://example.com/a");
	});

	it("drops a raw page excerpt and any other unknown field", () => {
		const result = parseBookmarkRecord({
			...validV1(),
			excerpt: "raw page text that must never be stored",
			pageText: "more raw text",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect("excerpt" in result.value).toBe(false);
			expect("pageText" in result.value).toBe(false);
			const serialized = serializeBookmarkRecord(result.value);
			expect("excerpt" in serialized).toBe(false);
		}
	});

	it("rejects an unsupported schema version", () => {
		const result = parseBookmarkRecord(validV1({ schemaVersion: 2 as 1 }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("schemaVersion");
	});

	it("rejects a non-object", () => {
		expect(parseBookmarkRecord(42).ok).toBe(false);
		expect(parseBookmarkRecord(null).ok).toBe(false);
		expect(parseBookmarkRecord([]).ok).toBe(false);
	});

	it("rejects invalid fields", () => {
		expect(parseBookmarkRecord(validV1({ id: "" })).ok).toBe(false);
		expect(parseBookmarkRecord(validV1({ url: "not-a-url" })).ok).toBe(false);
		expect(
			parseBookmarkRecord(validV1({ aiStatus: "bogus" as "ready" })).ok,
		).toBe(false);
		expect(
			parseBookmarkRecord(validV1({ tags: "GitHub" as unknown as string[] })).ok,
		).toBe(false);
		expect(parseBookmarkRecord(validV1({ createdAt: "yesterday" })).ok).toBe(
			false,
		);
	});

	it("rejects updatedAt earlier than createdAt", () => {
		const result = parseBookmarkRecord(
			validV1({
				createdAt: "2026-06-25T05:00:00.000Z",
				updatedAt: "2026-06-25T01:00:00.000Z",
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("updatedAt");
	});

	it("rejects an unknown aiModel", () => {
		expect(
			parseBookmarkRecord(validV1({ aiModel: "gpt" as "chrome-prompt-api" })).ok,
		).toBe(false);
	});
});

describe("serializeBookmarkRecord", () => {
	it("round-trips a record through parse → serialize", () => {
		const parsed = parseBookmarkRecord(validV1({ genre: "開発ツール" }));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			const serialized = serializeBookmarkRecord(parsed.value);
			const reparsed = parseBookmarkRecord(serialized);
			expect(reparsed.ok).toBe(true);
			if (reparsed.ok) expect(reparsed.value).toEqual(parsed.value);
		}
	});

	it("omits undefined optional fields", () => {
		const parsed = parseBookmarkRecord(validV1());
		if (parsed.ok) {
			const serialized = serializeBookmarkRecord(parsed.value);
			expect("description" in serialized).toBe(false);
			expect("genre" in serialized).toBe(false);
			expect("lastAnalyzedAt" in serialized).toBe(false);
		}
	});
});

describe("createBookmarkRecord", () => {
	const ctx = {
		id: bookmarkId("bm-new"),
		now: isoTimestamp("2026-06-25T12:00:00.000Z"),
	};

	it("creates an always-valid pending record with sensible defaults", () => {
		const result = createBookmarkRecord({ url: "https://example.com/x" }, ctx);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.aiStatus).toBe("pending");
			expect(result.value.title).toBe("https://example.com/x");
			expect(result.value.tags).toEqual([]);
			expect(result.value.createdAt).toBe(ctx.now);
			expect(result.value.updatedAt).toBe(ctx.now);
		}
	});

	it("rejects an invalid URL", () => {
		expect(createBookmarkRecord({ url: "nope" }, ctx).ok).toBe(false);
	});
});
