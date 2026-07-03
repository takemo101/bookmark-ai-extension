/**
 * On-the-wire shape of `bookmark-ai/settings.json` (docs/ai-analysis-v2.md
 * "Settings file"). Built-in skills never appear here; only user-defined
 * custom skills are persisted.
 */
import type { AnalysisSkillV1 } from "./skill";

export const CURRENT_SETTINGS_SCHEMA_VERSION = 1;

export type SettingsV1 = {
	schemaVersion: 1;
	updatedAt: string;
	analysisSkills: { custom: AnalysisSkillV1[] };
};
