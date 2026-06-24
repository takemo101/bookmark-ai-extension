import { describe, expect, it } from "vitest";

import { BookmarkInvariantError } from "./result";
import {
	bookmarkId,
	compareIsoTimestamp,
	isoTimestamp,
	isoTimestampFromDate,
	maxIsoTimestamp,
	minIsoTimestamp,
	parseBookmarkId,
	parseGenre,
	parseIsoTimestamp,
	parseTag,
	parseTags,
} from "./values";

describe("parseBookmarkId", () => {
	it("accepts and trims a non-empty string", () => {
		const result = parseBookmarkId("  abc  ");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe("abc");
	});

	it("rejects empty and non-string ids", () => {
		expect(parseBookmarkId("   ").ok).toBe(false);
		expect(parseBookmarkId(42).ok).toBe(false);
		expect(parseBookmarkId(undefined).ok).toBe(false);
	});
});

describe("bookmarkId asserting constructor", () => {
	it("throws an invariant error on invalid input", () => {
		expect(() => bookmarkId("")).toThrow(BookmarkInvariantError);
	});
});

describe("parseIsoTimestamp", () => {
	it("accepts ISO-8601 timestamps", () => {
		expect(parseIsoTimestamp("2026-06-25T07:14:04.000Z").ok).toBe(true);
		expect(parseIsoTimestamp("2026-06-25T07:14:04Z").ok).toBe(true);
		expect(parseIsoTimestamp("2026-06-25T07:14:04+09:00").ok).toBe(true);
	});

	it("rejects non-ISO and invalid dates", () => {
		expect(parseIsoTimestamp("2026-06-25").ok).toBe(false);
		expect(parseIsoTimestamp("just now").ok).toBe(false);
		expect(parseIsoTimestamp("2026-13-99T00:00:00Z").ok).toBe(false);
		expect(parseIsoTimestamp(1234).ok).toBe(false);
	});

	it("builds a timestamp from a Date", () => {
		const ts = isoTimestampFromDate(new Date("2026-06-25T00:00:00.000Z"));
		expect(ts).toBe("2026-06-25T00:00:00.000Z");
	});

	it("throws when building from an Invalid Date", () => {
		expect(() => isoTimestampFromDate(new Date("nope"))).toThrow(
			BookmarkInvariantError,
		);
	});

	it("compares and picks min/max", () => {
		const a = isoTimestamp("2026-06-25T00:00:00.000Z");
		const b = isoTimestamp("2026-06-26T00:00:00.000Z");
		expect(compareIsoTimestamp(a, b)).toBeLessThan(0);
		expect(maxIsoTimestamp(a, b)).toBe(b);
		expect(minIsoTimestamp(a, b)).toBe(a);
	});
});

describe("parseGenre", () => {
	it("accepts and trims non-empty genres", () => {
		const result = parseGenre("  開発ツール  ");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe("開発ツール");
	});

	it("rejects empty and non-string genres", () => {
		expect(parseGenre("  ").ok).toBe(false);
		expect(parseGenre(5).ok).toBe(false);
	});
});

describe("parseTag / parseTags", () => {
	it("accepts and trims a single tag", () => {
		const result = parseTag(" GitHub ");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe("GitHub");
	});

	it("defaults missing tag lists to empty", () => {
		const result = parseTags(undefined);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	it("trims, drops blanks, and dedupes case-insensitively preserving order", () => {
		const result = parseTags([" GitHub ", "github", "", "TypeScript"]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual(["GitHub", "TypeScript"]);
	});

	it("rejects a non-array tag list", () => {
		expect(parseTags("GitHub").ok).toBe(false);
	});

	it("rejects a list with a non-string entry", () => {
		expect(parseTags(["ok", 42]).ok).toBe(false);
	});
});
