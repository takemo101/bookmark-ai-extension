import { describe, expect, it } from "vitest";

import { isoTimestamp } from "../bookmarks/index";
import {
	createCustomSkill,
	parseCustomSkill,
	serializeCustomSkill,
} from "./skill";
import { skillId } from "./values";

describe("parseCustomSkill", () => {
	const valid = {
		id: "skill-1",
		name: "My GitHub skill",
		enabled: true,
		priority: 15,
		domains: ["github.com"],
		urlPatterns: ["github.com/my-org/*"],
		instruction: "Focus on release notes.",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-02T00:00:00Z",
	};

	it("parses a valid skill", () => {
		const result = parseCustomSkill(valid);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.id).toBe("skill-1");
			expect(result.value.name).toBe("My GitHub skill");
			expect(result.value.domains).toEqual(["github.com"]);
		}
	});

	it("trims blank entries out of domains/urlPatterns", () => {
		const result = parseCustomSkill({
			...valid,
			domains: ["github.com", "  ", "gitlab.com"],
			urlPatterns: [" example.com/* ", ""],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.domains).toEqual(["github.com", "gitlab.com"]);
			expect(result.value.urlPatterns).toEqual(["example.com/*"]);
		}
	});

	it("rejects a non-object", () => {
		expect(parseCustomSkill("nope").ok).toBe(false);
	});

	it("rejects an empty name", () => {
		const result = parseCustomSkill({ ...valid, name: "  " });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("name");
	});

	it("rejects a non-boolean enabled", () => {
		const result = parseCustomSkill({ ...valid, enabled: "yes" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("enabled");
	});

	it("rejects a non-finite priority", () => {
		const result = parseCustomSkill({ ...valid, priority: Number.NaN });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("priority");
	});

	it("rejects an empty instruction", () => {
		const result = parseCustomSkill({ ...valid, instruction: "   " });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("instruction");
	});

	it("rejects updatedAt earlier than createdAt", () => {
		const result = parseCustomSkill({
			...valid,
			createdAt: "2026-01-02T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe("updatedAt");
	});

	it("drops unknown fields (e.g. a raw excerpt) on round-trip", () => {
		const result = parseCustomSkill({ ...valid, excerpt: "raw page text" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			const serialized = serializeCustomSkill(result.value) as Record<
				string,
				unknown
			>;
			expect(serialized.excerpt).toBeUndefined();
		}
	});

	it("round-trips through serializeCustomSkill", () => {
		const parsed = parseCustomSkill(valid);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(serializeCustomSkill(parsed.value)).toEqual(valid);
		}
	});
});

describe("createCustomSkill", () => {
	it("defaults enabled to true and priority to 10", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		const result = createCustomSkill(
			{ name: "Generic", instruction: "Explain the page." },
			{ id: skillId("s1"), now },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.enabled).toBe(true);
			expect(result.value.priority).toBe(10);
			expect(result.value.domains).toEqual([]);
			expect(result.value.urlPatterns).toEqual([]);
			expect(result.value.createdAt).toBe(now);
			expect(result.value.updatedAt).toBe(now);
		}
	});

	it("propagates a validation error from the underlying parser", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		const result = createCustomSkill(
			{ name: "", instruction: "x" },
			{ id: skillId("s1"), now },
		);
		expect(result.ok).toBe(false);
	});
});
