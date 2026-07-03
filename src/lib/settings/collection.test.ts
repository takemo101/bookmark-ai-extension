import { describe, expect, it } from "vitest";

import { isoTimestamp } from "../bookmarks/index";
import { Settings } from "./collection";
import { skillId } from "./values";

describe("Settings", () => {
	it("starts empty with an epoch updatedAt", () => {
		const settings = Settings.empty();
		expect(settings.size).toBe(0);
		expect(settings.customSkills()).toEqual([]);
	});

	it("add() creates a skill and bumps the file updatedAt", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		const result = Settings.empty().add(
			{ name: "GitHub focus", instruction: "Focus on releases." },
			{ id: skillId("s1"), now },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(1);
			expect(result.value.updatedAt).toBe(now);
			expect(result.value.customSkills()[0].name).toBe("GitHub focus");
		}
	});

	it("add() propagates a validation error without mutating the collection", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		const result = Settings.empty().add(
			{ name: "", instruction: "x" },
			{ id: skillId("s1"), now },
		);
		expect(result.ok).toBe(false);
	});

	it("update() preserves createdAt and only changes patched fields", () => {
		const created = isoTimestamp("2026-01-01T00:00:00Z");
		const added = Settings.empty().add(
			{ name: "Original", instruction: "Explain X." },
			{ id: skillId("s1"), now: created },
		);
		if (!added.ok) throw new Error("fixture failed");

		const updated = created;
		const later = isoTimestamp("2026-02-01T00:00:00Z");
		const result = added.value.update(
			skillId("s1"),
			{ name: "Renamed" },
			later,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const skill = result.value.get(skillId("s1"));
			expect(skill?.name).toBe("Renamed");
			expect(skill?.instruction).toBe("Explain X.");
			expect(skill?.createdAt).toBe(updated);
			expect(skill?.updatedAt).toBe(later);
			expect(result.value.updatedAt).toBe(later);
		}
	});

	it("update() errors for an unknown id", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		const result = Settings.empty().update(skillId("missing"), {}, now);
		expect(result.ok).toBe(false);
	});

	it("setEnabled() toggles the enabled flag", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		const added = Settings.empty().add(
			{ name: "A", instruction: "x", enabled: true },
			{ id: skillId("s1"), now },
		);
		if (!added.ok) throw new Error("fixture failed");

		const later = isoTimestamp("2026-01-02T00:00:00Z");
		const disabled = added.value.setEnabled(skillId("s1"), false, later);
		expect(disabled.ok).toBe(true);
		if (disabled.ok) {
			expect(disabled.value.get(skillId("s1"))?.enabled).toBe(false);
			expect(disabled.value.enabledSkills()).toHaveLength(0);
		}
	});

	it("remove() deletes a skill and is a no-op for an unknown id", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		const added = Settings.empty().add(
			{ name: "A", instruction: "x" },
			{ id: skillId("s1"), now },
		);
		if (!added.ok) throw new Error("fixture failed");

		const later = isoTimestamp("2026-01-02T00:00:00Z");
		const removed = added.value.remove(skillId("s1"), later);
		expect(removed.size).toBe(0);
		expect(removed.updatedAt).toBe(later);

		const noop = removed.remove(skillId("missing"), later);
		expect(noop).toBe(removed);
	});

	it("customSkills() orders most-recently-updated first, deterministically", () => {
		const t1 = isoTimestamp("2026-01-01T00:00:00Z");
		const t2 = isoTimestamp("2026-01-02T00:00:00Z");
		let settings = Settings.empty();
		const first = settings.add(
			{ name: "First", instruction: "x" },
			{ id: skillId("a"), now: t1 },
		);
		if (!first.ok) throw new Error("fixture failed");
		settings = first.value;
		const second = settings.add(
			{ name: "Second", instruction: "x" },
			{ id: skillId("b"), now: t2 },
		);
		if (!second.ok) throw new Error("fixture failed");
		settings = second.value;

		expect(settings.customSkills().map((s) => s.id)).toEqual(["b", "a"]);
	});

	it("enabledSkills() excludes disabled skills", () => {
		const now = isoTimestamp("2026-01-01T00:00:00Z");
		let settings = Settings.empty();
		const a = settings.add(
			{ name: "A", instruction: "x", enabled: true },
			{ id: skillId("a"), now },
		);
		if (!a.ok) throw new Error("fixture failed");
		settings = a.value;
		const b = settings.add(
			{ name: "B", instruction: "x", enabled: false },
			{ id: skillId("b"), now },
		);
		if (!b.ok) throw new Error("fixture failed");
		settings = b.value;

		expect(settings.enabledSkills().map((s) => s.id)).toEqual(["a"]);
	});
});
