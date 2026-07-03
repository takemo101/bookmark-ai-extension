/**
 * Boundary parser for `bookmark-ai/settings.json`.
 *
 * Parsing is total and never throws: a missing/empty file, malformed JSON, or
 * an invalid top-level shape all bootstrap to the empty {@link Settings}
 * (default empty custom skills) rather than aborting or corrupting anything
 * else. Individual malformed skill entries are quarantined as
 * {@link SettingsProblem}s so one bad entry cannot cost the rest of the file
 * (mirrors `bookmarks/jsonl.ts`'s per-line quarantine; see
 * docs/implementation-principles.md "Parse, don't validate").
 */
import { parseIsoTimestamp } from "../bookmarks/index";
import { Settings } from "./collection";
import { type CustomSkill, parseCustomSkill } from "./skill";
import { CURRENT_SETTINGS_SCHEMA_VERSION } from "./types";

export type SettingsProblemKind =
	| "malformed-json"
	| "not-an-object"
	| "unsupported-schema"
	| "invalid-field";

export type SettingsProblem = {
	readonly kind: SettingsProblemKind;
	readonly message: string;
	/** Index into `analysisSkills.custom`, when the problem is one bad entry. */
	readonly index?: number;
};

export type SettingsParseResult = {
	readonly settings: Settings;
	readonly problems: readonly SettingsProblem[];
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse an already-decoded JSON value into an always-valid settings snapshot. */
export function parseSettingsV1(value: unknown): SettingsParseResult {
	const problems: SettingsProblem[] = [];

	if (!isObject(value)) {
		problems.push({
			kind: "not-an-object",
			message: "settings is not an object",
		});
		return { settings: Settings.empty(), problems };
	}

	if (value.schemaVersion !== CURRENT_SETTINGS_SCHEMA_VERSION) {
		problems.push({
			kind: "unsupported-schema",
			message: `unsupported settings schemaVersion: ${JSON.stringify(value.schemaVersion)}`,
		});
		return { settings: Settings.empty(), problems };
	}

	const updatedAt = parseIsoTimestamp(value.updatedAt);
	if (!updatedAt.ok) {
		problems.push({
			kind: "invalid-field",
			message: `updatedAt: ${updatedAt.error.message}`,
		});
		return { settings: Settings.empty(), problems };
	}

	const analysisSkills = value.analysisSkills;
	const rawCustom = isObject(analysisSkills)
		? analysisSkills.custom
		: undefined;
	const custom: CustomSkill[] = [];
	if (rawCustom !== undefined) {
		if (!Array.isArray(rawCustom)) {
			problems.push({
				kind: "invalid-field",
				message: "analysisSkills.custom must be an array",
			});
		} else {
			rawCustom.forEach((entry, index) => {
				const parsed = parseCustomSkill(entry);
				if (!parsed.ok) {
					// Quarantine the bad entry; the rest of the settings file survives.
					problems.push({
						kind: "invalid-field",
						message: `${parsed.error.field}: ${parsed.error.message}`,
						index,
					});
					return;
				}
				custom.push(parsed.value);
			});
		}
	}

	return { settings: Settings.from(custom, updatedAt.value), problems };
}

/**
 * Parse the raw text of `bookmark-ai/settings.json`. Empty/whitespace-only
 * text (a freshly bootstrapped file) is treated as valid empty settings, not a
 * parse failure — mirrors `bookmarks/jsonl.ts` treating a blank line as
 * nothing rather than a problem, and satisfies "a missing settings file
 * bootstraps safely to default empty custom skills".
 */
export function parseSettingsText(text: string): SettingsParseResult {
	if (text.trim().length === 0) {
		return { settings: Settings.empty(), problems: [] };
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(text);
	} catch {
		return {
			settings: Settings.empty(),
			problems: [
				{ kind: "malformed-json", message: "settings file is not valid JSON" },
			],
		};
	}
	return parseSettingsV1(decoded);
}
