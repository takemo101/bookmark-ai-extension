/**
 * Branded domain primitives for custom analysis skills.
 *
 * `SkillId` is wrapped for the same reason `BookmarkId` is
 * (docs/implementation-principles.md "Primitive wrapping policy"): it crosses
 * the settings/app/options boundary and should never be confused with a plain
 * string or with a `BookmarkId`.
 *
 * Two entry points, mirroring `bookmarks/values.ts`:
 *   - `parseSkillId` — boundary parser returning a {@link Result}; use on
 *     untrusted external data.
 *   - `skillId()`    — asserting constructor that throws
 *     {@link SettingsInvariantError} on invalid input; use internally where the
 *     value is already known to be valid (e.g. a freshly generated UUID).
 */
import { SettingsInvariantError, type Result, err, ok } from "./result";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SkillId = Brand<string, "SkillId">;

export type ValueError = { readonly field: string; readonly message: string };

function valueError(field: string, message: string): ValueError {
	return { field, message };
}

export function parseSkillId(value: unknown): Result<SkillId, ValueError> {
	if (typeof value !== "string") {
		return err(valueError("id", "id must be a string"));
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return err(valueError("id", "id must not be empty"));
	}
	return ok(trimmed as SkillId);
}

export function skillId(value: string): SkillId {
	const parsed = parseSkillId(value);
	if (!parsed.ok) {
		throw new SettingsInvariantError(parsed.error.message);
	}
	return parsed.value;
}
