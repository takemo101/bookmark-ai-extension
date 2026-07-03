/**
 * Serialize a trusted {@link Settings} collection back into the plain
 * {@link SettingsV1} shape written to `bookmark-ai/settings.json`. The inverse
 * of `parseSettingsV1`.
 */
import type { Settings } from "./collection";
import { serializeCustomSkill } from "./skill";
import { CURRENT_SETTINGS_SCHEMA_VERSION, type SettingsV1 } from "./types";

export function serializeSettings(settings: Settings): SettingsV1 {
	return {
		schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
		updatedAt: settings.updatedAt,
		analysisSkills: {
			custom: settings.customSkills().map(serializeCustomSkill),
		},
	};
}
