import { describe, expect, it } from "vitest";

import { parseCachedSettingsState } from "./settings-parse";
import { SETTINGS_CACHE_SCHEMA_VERSION } from "./settings-types";

const GOOD_SKILL = {
	id: "s1",
	name: "Good",
	enabled: true,
	priority: 10,
	domains: ["example.com"],
	urlPatterns: [],
	instruction: "Focus on X.",
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};

describe("parseCachedSettingsState", () => {
	it("returns the empty state for a non-object", () => {
		const result = parseCachedSettingsState("nope");
		expect(result.state.settings.size).toBe(0);
		expect(result.problems[0].kind).toBe("not-an-object");
	});

	it("returns the empty state for an unsupported schema version", () => {
		const result = parseCachedSettingsState({ schemaVersion: 2 });
		expect(result.problems[0].kind).toBe("unsupported-schema");
	});

	it("parses a valid cached snapshot", () => {
		const result = parseCachedSettingsState({
			schemaVersion: SETTINGS_CACHE_SCHEMA_VERSION,
			updatedAt: "2026-01-01T00:00:00Z",
			customSkills: [GOOD_SKILL],
			sync: { status: "synced", lastSyncedAt: "2026-01-01T00:00:00Z" },
		});
		expect(result.problems).toHaveLength(0);
		expect(result.state.settings.size).toBe(1);
		expect(result.state.sync.status).toBe("synced");
	});

	it("quarantines one bad skill entry but keeps the rest", () => {
		const bad = { ...GOOD_SKILL, id: "s2", name: "" };
		const result = parseCachedSettingsState({
			schemaVersion: SETTINGS_CACHE_SCHEMA_VERSION,
			updatedAt: "2026-01-01T00:00:00Z",
			customSkills: [GOOD_SKILL, bad],
			sync: { status: "idle" },
		});
		expect(result.state.settings.size).toBe(1);
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0].kind).toBe("invalid-skill");
	});

	it("drops an invalid drive location but keeps the rest of the state", () => {
		const result = parseCachedSettingsState({
			schemaVersion: SETTINGS_CACHE_SCHEMA_VERSION,
			updatedAt: "2026-01-01T00:00:00Z",
			customSkills: [GOOD_SKILL],
			drive: { folderId: "f1" }, // missing fileId/revision
			sync: { status: "idle" },
		});
		expect(result.state.location).toBeUndefined();
		expect(result.state.settings.size).toBe(1);
		expect(result.problems.some((p) => p.kind === "invalid-location")).toBe(
			true,
		);
	});

	it("falls back to idle sync for a malformed sync object", () => {
		const result = parseCachedSettingsState({
			schemaVersion: SETTINGS_CACHE_SCHEMA_VERSION,
			updatedAt: "2026-01-01T00:00:00Z",
			customSkills: [],
			sync: "not-an-object",
		});
		expect(result.state.sync.status).toBe("idle");
		expect(result.problems.some((p) => p.kind === "invalid-sync")).toBe(true);
	});

	it("reports and drops an invalid top-level updatedAt but keeps other fields", () => {
		const result = parseCachedSettingsState({
			schemaVersion: SETTINGS_CACHE_SCHEMA_VERSION,
			updatedAt: "not-a-timestamp",
			customSkills: [GOOD_SKILL],
			sync: { status: "idle" },
		});
		expect(result.problems.some((p) => p.kind === "invalid-field")).toBe(true);
		expect(result.state.settings.size).toBe(1);
	});
});
