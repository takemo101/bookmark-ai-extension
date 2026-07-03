import { describe, expect, it } from "vitest";

import { createCustomSkill, skillId } from "../settings/index";
import { isoTimestamp } from "../bookmarks/index";
import { toAnalysisProfile } from "./custom-profile";
import { selectAnalysisProfile } from "./profile";

function makeSkill(overrides: {
	domains?: string[];
	urlPatterns?: string[];
	priority?: number;
}) {
	const now = isoTimestamp("2026-01-01T00:00:00Z");
	const result = createCustomSkill(
		{
			name: "Custom",
			instruction: "Custom emphasis.",
			domains: overrides.domains ?? [],
			urlPatterns: overrides.urlPatterns ?? [],
			priority: overrides.priority ?? 10,
		},
		{ id: skillId("custom-1"), now },
	);
	if (!result.ok) throw new Error(`fixture failed: ${result.error.message}`);
	return result.value;
}

describe("toAnalysisProfile", () => {
	it("synthesizes a domain into a bare pattern and a wildcard subpath pattern", () => {
		const profile = toAnalysisProfile(makeSkill({ domains: ["example.com"] }));
		expect(profile.urlPatterns).toEqual(["example.com", "example.com/*"]);
	});

	it("appends the skill's own urlPatterns after the synthesized domain patterns", () => {
		const profile = toAnalysisProfile(
			makeSkill({
				domains: ["example.com"],
				urlPatterns: ["other.example/docs/*"],
			}),
		);
		expect(profile.urlPatterns).toEqual([
			"example.com",
			"example.com/*",
			"other.example/docs/*",
		]);
	});

	it("carries id, name, priority, and instruction through unchanged", () => {
		const skill = makeSkill({ priority: 42 });
		const profile = toAnalysisProfile(skill);
		expect(profile.id).toBe(skill.id);
		expect(profile.name).toBe(skill.name);
		expect(profile.priority).toBe(42);
		expect(profile.instruction).toBe(skill.instruction);
	});

	it("matches a domain-only custom skill against a subpath URL via selectAnalysisProfile", () => {
		const profile = toAnalysisProfile(
			makeSkill({ domains: ["example.com"], priority: 50 }),
		);
		const selected = selectAnalysisProfile("https://example.com/a/b", [
			profile,
		]);
		expect(selected.id).toBe(profile.id);
	});
});
