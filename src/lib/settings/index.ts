/**
 * `settings/*` boundary.
 *
 * Owns the custom analysis-skill domain: the branded `SkillId`, the always-valid
 * `CustomSkill` value, JSON parse/serialize for `bookmark-ai/settings.json`, and
 * the first-class `Settings` collection (add/update/remove/enable CRUD, all
 * "tell, don't ask"). Pure logic — no Chrome, Drive, or Prompt API I/O, and no
 * dependency on `ai/*`: the built-in-profile converter lives in
 * `ai/custom-profile.ts` instead, so this module never has to know about
 * `AnalysisProfile` or profile selection. See docs/ai-analysis-v2.md "Settings
 * file" and docs/implementation-principles.md.
 *
 * Surface:
 *   - {@link Settings}            — the first-class custom-skill collection.
 *   - {@link parseSettingsText} / {@link parseSettingsV1} / {@link serializeSettings}
 *                                  — the boundary parser/serializer.
 *   - {@link CustomSkill}, {@link parseCustomSkill}, {@link createCustomSkill}
 *                                  — the always-valid skill value and its constructors.
 */
export {
	type Result,
	type Ok,
	type Err,
	ok,
	err,
	SettingsInvariantError,
} from "./result";

export {
	type SkillId,
	type ValueError,
	parseSkillId,
	skillId,
} from "./values";

export {
	type AnalysisSkillV1,
	type CustomSkill,
	type SkillError,
	type NewCustomSkillInput,
	parseCustomSkill,
	serializeCustomSkill,
	createCustomSkill,
} from "./skill";

export {
	type SettingsV1,
	CURRENT_SETTINGS_SCHEMA_VERSION,
} from "./types";

export {
	type SettingsProblemKind,
	type SettingsProblem,
	type SettingsParseResult,
	parseSettingsV1,
	parseSettingsText,
} from "./parse";

export { serializeSettings } from "./serialize";

export { Settings } from "./collection";
