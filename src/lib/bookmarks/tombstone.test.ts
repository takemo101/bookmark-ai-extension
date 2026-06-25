import { describe, expect, it } from "vitest";

import {
	type TombstoneV1,
	isTombstoneShape,
	parseTombstone,
	serializeTombstone,
} from "./tombstone";

function wire(overrides: Partial<TombstoneV1> = {}): unknown {
	return {
		schemaVersion: 1,
		kind: "tombstone",
		canonicalUrl: "https://example.com/a",
		deletedAt: "2026-06-26T00:00:00.000Z",
		...overrides,
	};
}

describe("isTombstoneShape", () => {
	it("recognizes only objects tagged with kind 'tombstone'", () => {
		expect(isTombstoneShape(wire())).toBe(true);
		expect(isTombstoneShape({ schemaVersion: 1, id: "bm-1" })).toBe(false);
		expect(isTombstoneShape("tombstone")).toBe(false);
		expect(isTombstoneShape(null)).toBe(false);
	});
});

describe("parseTombstone", () => {
	it("parses a valid tombstone", () => {
		const result = parseTombstone(wire());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.canonicalUrl).toBe("https://example.com/a");
			expect(result.value.deletedAt).toBe("2026-06-26T00:00:00.000Z");
		}
	});

	it("rejects an unsupported schema version", () => {
		const result = parseTombstone(wire({ schemaVersion: 9 as 1 }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("schemaVersion");
	});

	it("rejects a non-tombstone kind", () => {
		const result = parseTombstone(wire({ kind: "bookmark" as "tombstone" }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("kind");
	});

	it("rejects an invalid canonical URL", () => {
		const result = parseTombstone(wire({ canonicalUrl: "not-a-url" }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("canonicalUrl");
	});

	it("rejects an invalid deletedAt timestamp", () => {
		const result = parseTombstone(wire({ deletedAt: "nope" }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("deletedAt");
	});

	it("round-trips through serialize → parse", () => {
		const parsed = parseTombstone(wire());
		if (!parsed.ok) throw new Error("fixture parse failed");
		const reparsed = parseTombstone(serializeTombstone(parsed.value));
		expect(reparsed.ok).toBe(true);
		if (reparsed.ok) expect(reparsed.value).toEqual(parsed.value);
	});
});
