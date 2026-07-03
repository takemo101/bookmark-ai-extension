import { describe, expect, it } from "vitest";

import { parseSettingsText, parseSettingsV1 } from "./parse";

describe("parseSettingsText", () => {
	it("bootstraps to empty settings when the file is missing/empty", () => {
		const result = parseSettingsText("");
		expect(result.problems).toHaveLength(0);
		expect(result.settings.size).toBe(0);
	});

	it("bootstraps to empty settings for whitespace-only text", () => {
		const result = parseSettingsText("   \n  ");
		expect(result.problems).toHaveLength(0);
		expect(result.settings.size).toBe(0);
	});

	it("reports malformed JSON as a safe, quarantined problem", () => {
		const result = parseSettingsText("{ not json");
		expect(result.settings.size).toBe(0);
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0].kind).toBe("malformed-json");
	});

	it("parses a valid settings document", () => {
		const doc = {
			schemaVersion: 1,
			updatedAt: "2026-01-01T00:00:00Z",
			analysisSkills: {
				custom: [
					{
						id: "s1",
						name: "My skill",
						enabled: true,
						priority: 10,
						domains: ["example.com"],
						urlPatterns: [],
						instruction: "Focus on X.",
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-01T00:00:00Z",
					},
				],
			},
		};
		const result = parseSettingsText(JSON.stringify(doc));
		expect(result.problems).toHaveLength(0);
		expect(result.settings.size).toBe(1);
		expect(result.settings.updatedAt).toBe("2026-01-01T00:00:00Z");
	});
});

describe("parseSettingsV1", () => {
	it("rejects a non-object", () => {
		const result = parseSettingsV1("nope");
		expect(result.settings.size).toBe(0);
		expect(result.problems[0].kind).toBe("not-an-object");
	});

	it("rejects an unsupported schema version", () => {
		const result = parseSettingsV1({ schemaVersion: 2 });
		expect(result.problems[0].kind).toBe("unsupported-schema");
	});

	it("rejects a missing/invalid top-level updatedAt", () => {
		const result = parseSettingsV1({ schemaVersion: 1, updatedAt: "nope" });
		expect(result.problems[0].kind).toBe("invalid-field");
		expect(result.settings.size).toBe(0);
	});

	it("quarantines one bad skill entry but keeps the rest", () => {
		const good = {
			id: "s1",
			name: "Good",
			enabled: true,
			priority: 10,
			domains: [],
			urlPatterns: ["example.com/*"],
			instruction: "Focus on X.",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		};
		const bad = { ...good, id: "s2", name: "" };
		const result = parseSettingsV1({
			schemaVersion: 1,
			updatedAt: "2026-01-01T00:00:00Z",
			analysisSkills: { custom: [good, bad] },
		});
		expect(result.settings.size).toBe(1);
		expect(result.settings.customSkills()[0]?.id).toBe("s1");
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0].index).toBe(1);
	});

	it("treats a missing analysisSkills.custom as an empty list", () => {
		const result = parseSettingsV1({
			schemaVersion: 1,
			updatedAt: "2026-01-01T00:00:00Z",
		});
		expect(result.problems).toHaveLength(0);
		expect(result.settings.size).toBe(0);
	});
});
