/**
 * Serialize a trusted {@link SettingsCacheState} back into the loose
 * {@link CachedSettingsStateV1} shape persisted in `chrome.storage.local`. The
 * inverse of `parseCachedSettingsState`.
 */
import { serializeCustomSkill } from "../settings/index";
import {
	SETTINGS_CACHE_SCHEMA_VERSION,
	type CachedSettingsStateV1,
	type SettingsCacheState,
} from "./settings-types";

export function serializeSettingsCacheState(
	state: SettingsCacheState,
): CachedSettingsStateV1 {
	const serialized: CachedSettingsStateV1 = {
		schemaVersion: SETTINGS_CACHE_SCHEMA_VERSION,
		updatedAt: state.settings.updatedAt,
		customSkills: state.settings.customSkills().map(serializeCustomSkill),
		sync: {
			status: state.sync.status,
		},
	};

	if (state.sync.lastSyncedAt !== undefined) {
		serialized.sync.lastSyncedAt = state.sync.lastSyncedAt;
	}
	if (state.sync.error !== undefined) {
		serialized.sync.error = state.sync.error;
	}
	if (state.sync.pending === true) {
		serialized.sync.pending = true;
	}

	if (state.location !== undefined) {
		serialized.drive = {
			folderId: state.location.folder.id,
			folderName: state.location.folder.name,
			fileId: state.location.file.id,
			fileName: state.location.file.name,
			revision: state.location.file.revision,
		};
	}

	return serialized;
}
