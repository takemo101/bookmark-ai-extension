/**
 * First-class custom-skill collection.
 *
 * Owns every list/CRUD operation on `bookmark-ai/settings.json`'s
 * `analysisSkills.custom` list, plus the file-level `updatedAt` used for
 * last-writer-wins conflict resolution (docs/ai-analysis-v2.md "Settings
 * file"). Mirrors `bookmarks/collection.ts`'s shape: instances are immutable,
 * every mutating operation returns a new {@link Settings}, and the collection
 * never reads a clock or generates an id — callers inject `now` (and `id` for
 * new skills) so behavior stays deterministic and testable
 * (docs/implementation-principles.md "First-class bookmark collection", "Tell,
 * don't ask").
 */
import {
	type IsoTimestamp,
	compareIsoTimestamp,
	maxIsoTimestamp,
} from "../bookmarks/index";
import { type Result, err, ok } from "./result";
import {
	type CustomSkill,
	type NewCustomSkillInput,
	type SkillError,
	createCustomSkill,
} from "./skill";
import type { SkillId } from "./values";

/**
 * The file-level `updatedAt` of a never-saved default settings value — older
 * than any real save, so the first genuine write always wins a last-writer-wins
 * comparison against it.
 */
const EPOCH = "1970-01-01T00:00:00.000Z" as IsoTimestamp;

function compareId(a: SkillId, b: SkillId): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Default ordering: most recently updated first, fully deterministic. */
function byRecency(a: CustomSkill, b: CustomSkill): number {
	const updated = compareIsoTimestamp(b.updatedAt, a.updatedAt);
	if (updated !== 0) return updated;
	return compareId(a.id, b.id);
}

export class Settings {
	private readonly skills: ReadonlyMap<SkillId, CustomSkill>;
	readonly updatedAt: IsoTimestamp;

	private constructor(
		skills: ReadonlyMap<SkillId, CustomSkill>,
		updatedAt: IsoTimestamp,
	) {
		this.skills = skills;
		this.updatedAt = updatedAt;
	}

	static empty(): Settings {
		return new Settings(new Map(), EPOCH);
	}

	/**
	 * Build from already-valid skills. Later entries win when two share an id.
	 * `updatedAt` defaults to {@link EPOCH} when omitted (e.g. a freshly
	 * bootstrapped settings file with no prior save).
	 */
	static from(
		skills: Iterable<CustomSkill>,
		updatedAt: IsoTimestamp = EPOCH,
	): Settings {
		const byId = new Map<SkillId, CustomSkill>();
		for (const skill of skills) {
			byId.set(skill.id, skill);
		}
		return new Settings(byId, updatedAt);
	}

	get size(): number {
		return this.skills.size;
	}

	get(id: SkillId): CustomSkill | undefined {
		return this.skills.get(id);
	}

	/** All custom skills, most-recently-updated first. */
	customSkills(): CustomSkill[] {
		return [...this.skills.values()].sort(byRecency);
	}

	/** Only the enabled skills, in the same deterministic order. */
	enabledSkills(): CustomSkill[] {
		return this.customSkills().filter((skill) => skill.enabled);
	}

	private with(
		skills: ReadonlyMap<SkillId, CustomSkill>,
		now: IsoTimestamp,
	): Settings {
		return new Settings(skills, maxIsoTimestamp(this.updatedAt, now));
	}

	/** Create a new custom skill. */
	add(
		input: NewCustomSkillInput,
		context: { id: SkillId; now: IsoTimestamp },
	): Result<Settings, SkillError> {
		const created = createCustomSkill(input, context);
		if (!created.ok) {
			return created;
		}
		const next = new Map(this.skills);
		next.set(created.value.id, created.value);
		return ok(this.with(next, context.now));
	}

	/**
	 * Update an existing custom skill in place, preserving `createdAt` and
	 * bumping `updatedAt` to `now`. Only fields present on `patch` replace
	 * existing values. Errs when `id` has no existing skill.
	 */
	update(
		id: SkillId,
		patch: Partial<NewCustomSkillInput>,
		now: IsoTimestamp,
	): Result<Settings, SkillError> {
		const existing = this.skills.get(id);
		if (!existing) {
			return err({ field: "id", message: "no custom skill for that id" });
		}
		const updatedAt = maxIsoTimestamp(existing.updatedAt, now);
		const merged = createCustomSkill(
			{
				name: patch.name ?? existing.name,
				enabled: patch.enabled ?? existing.enabled,
				priority: patch.priority ?? existing.priority,
				domains: patch.domains ?? [...existing.domains],
				urlPatterns: patch.urlPatterns ?? [...existing.urlPatterns],
				instruction: patch.instruction ?? existing.instruction,
			},
			{ id: existing.id, now: updatedAt },
		);
		if (!merged.ok) {
			return merged;
		}
		const next = new Map(this.skills);
		next.set(id, { ...merged.value, createdAt: existing.createdAt });
		return ok(this.with(next, now));
	}

	/** Convenience wrapper over {@link update} for the enable/disable toggle. */
	setEnabled(
		id: SkillId,
		enabled: boolean,
		now: IsoTimestamp,
	): Result<Settings, SkillError> {
		return this.update(id, { enabled }, now);
	}

	/** Delete by id. An unknown id is a no-op, like `Bookmarks.delete`. */
	remove(id: SkillId, now: IsoTimestamp): Settings {
		if (!this.skills.has(id)) {
			return this;
		}
		const next = new Map(this.skills);
		next.delete(id);
		return this.with(next, now);
	}
}
