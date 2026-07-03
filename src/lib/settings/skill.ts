/**
 * Custom analysis skill: the domain value for one user-defined entry in
 * `bookmark-ai/settings.json`'s `analysisSkills.custom` list
 * (docs/ai-analysis-v2.md "Settings file"). Built-in skills are fixed in code
 * (`ai/profile.ts`) and never appear here.
 *
 * Two shapes mirror `bookmarks/record.ts`:
 *   - {@link AnalysisSkillV1} is the on-the-wire JSON shape: plain JSON with
 *     primitive strings/numbers/booleans.
 *   - {@link CustomSkill} is the always-valid in-memory domain value with
 *     branded primitives, producible only through {@link parseCustomSkill} or
 *     {@link createCustomSkill}.
 *
 * A raw page excerpt could never appear here: the shape has no such field, and
 * the parser only ever copies known fields onto the result.
 */
import {
	type IsoTimestamp,
	compareIsoTimestamp,
	parseIsoTimestamp,
} from "../bookmarks/index";
import { type Result, err, ok } from "./result";
import { type SkillId, type ValueError, parseSkillId } from "./values";

/** Serialized (JSON) shape. Plain JSON, no brands. */
export type AnalysisSkillV1 = {
	id: string;
	name: string;
	enabled: boolean;
	priority: number;
	domains: string[];
	urlPatterns: string[];
	instruction: string;
	createdAt: string;
	updatedAt: string;
};

/** Always-valid in-memory domain value. */
export type CustomSkill = {
	readonly id: SkillId;
	readonly name: string;
	readonly enabled: boolean;
	readonly priority: number;
	readonly domains: readonly string[];
	readonly urlPatterns: readonly string[];
	readonly instruction: string;
	readonly createdAt: IsoTimestamp;
	readonly updatedAt: IsoTimestamp;
};

export type SkillError = ValueError;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldError(field: string, message: string): SkillError {
	return { field, message };
}

/**
 * Parse a raw `domains` or `urlPatterns` list: trims each entry and drops
 * blanks. A non-string entry is a malformed record, not a blank to skip
 * (mirrors `bookmarks/values.ts`'s `parseTags`).
 */
function parseStringList(
	value: unknown,
	field: string,
): Result<string[], SkillError> {
	if (value === undefined) {
		return ok([]);
	}
	if (!Array.isArray(value)) {
		return err(fieldError(field, `${field} must be an array`));
	}
	const items: string[] = [];
	for (const raw of value) {
		if (typeof raw !== "string") {
			return err(fieldError(field, `${field} entries must be strings`));
		}
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			continue;
		}
		items.push(trimmed);
	}
	return ok(items);
}

/**
 * Parse arbitrary external data (one decoded `analysisSkills.custom` entry)
 * into an always-valid {@link CustomSkill}. Unknown fields are dropped.
 */
export function parseCustomSkill(
	value: unknown,
): Result<CustomSkill, SkillError> {
	if (!isObject(value)) {
		return err(fieldError("skill", "skill must be a JSON object"));
	}

	const id = parseSkillId(value.id);
	if (!id.ok) {
		return err(id.error);
	}

	if (typeof value.name !== "string" || value.name.trim().length === 0) {
		return err(fieldError("name", "name must be a non-empty string"));
	}
	const name = value.name.trim();

	if (typeof value.enabled !== "boolean") {
		return err(fieldError("enabled", "enabled must be a boolean"));
	}

	if (typeof value.priority !== "number" || !Number.isFinite(value.priority)) {
		return err(fieldError("priority", "priority must be a finite number"));
	}

	const domains = parseStringList(value.domains, "domains");
	if (!domains.ok) {
		return err(domains.error);
	}

	const urlPatterns = parseStringList(value.urlPatterns, "urlPatterns");
	if (!urlPatterns.ok) {
		return err(urlPatterns.error);
	}

	if (
		typeof value.instruction !== "string" ||
		value.instruction.trim().length === 0
	) {
		return err(
			fieldError("instruction", "instruction must be a non-empty string"),
		);
	}
	const instruction = value.instruction.trim();

	const createdAt = parseIsoTimestamp(value.createdAt);
	if (!createdAt.ok) {
		return err(fieldError("createdAt", createdAt.error.message));
	}

	const updatedAt = parseIsoTimestamp(value.updatedAt);
	if (!updatedAt.ok) {
		return err(fieldError("updatedAt", updatedAt.error.message));
	}

	if (compareIsoTimestamp(updatedAt.value, createdAt.value) < 0) {
		return err(
			fieldError("updatedAt", "updatedAt must not be earlier than createdAt"),
		);
	}

	return ok({
		id: id.value,
		name,
		enabled: value.enabled,
		priority: value.priority,
		domains: domains.value,
		urlPatterns: urlPatterns.value,
		instruction,
		createdAt: createdAt.value,
		updatedAt: updatedAt.value,
	});
}

/** Serialize a domain skill back into its plain JSON shape. */
export function serializeCustomSkill(skill: CustomSkill): AnalysisSkillV1 {
	return {
		id: skill.id,
		name: skill.name,
		enabled: skill.enabled,
		priority: skill.priority,
		domains: [...skill.domains],
		urlPatterns: [...skill.urlPatterns],
		instruction: skill.instruction,
		createdAt: skill.createdAt,
		updatedAt: skill.updatedAt,
	};
}

/**
 * Input accepted by the smart constructor and by {@link Settings} CRUD. All
 * validation happens inside `createCustomSkill`; callers pass raw values.
 */
export type NewCustomSkillInput = {
	name: string;
	enabled?: boolean;
	priority?: number;
	domains?: string[];
	urlPatterns?: string[];
	instruction: string;
};

/**
 * Build a brand-new always-valid custom skill. `id` and timestamps are
 * injected so the domain stays free of Chrome/clock dependencies. Defaults:
 * `enabled` to `true`, `priority` to `10` (between the generic built-in's `0`
 * and the specific built-ins' `20`, so a fresh custom skill outranks the
 * generic fallback but does not silently outrank every built-in).
 */
export function createCustomSkill(
	input: NewCustomSkillInput,
	context: { id: SkillId; now: IsoTimestamp },
): Result<CustomSkill, SkillError> {
	return parseCustomSkill({
		id: context.id,
		name: input.name,
		enabled: input.enabled ?? true,
		priority: input.priority ?? 10,
		domains: input.domains ?? [],
		urlPatterns: input.urlPatterns ?? [],
		instruction: input.instruction,
		createdAt: context.now,
		updatedAt: context.now,
	});
}
