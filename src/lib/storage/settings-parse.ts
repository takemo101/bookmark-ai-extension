/**
 * Boundary parser for the persisted settings-cache blob (chrome.storage.local
 * key {@link SETTINGS_CACHE_KEY}). Mirrors `storage/parse.ts`'s posture: a
 * corrupt/absent payload always resolves to the empty settings state, never an
 * error, since Drive remains the source of truth for
 * `bookmark-ai/settings.json` (docs/implementation-principles.md "Parse,
 * don't validate").
 */
import { parseIsoTimestamp } from "../bookmarks/index";
import type {
	DriveFileId,
	DriveFolderId,
	DriveLocation,
	DriveRevision,
} from "../drive/index";
import {
	Settings,
	type CustomSkill,
	parseCustomSkill,
} from "../settings/index";
import {
	SETTINGS_CACHE_SCHEMA_VERSION,
	type SettingsCacheParseResult,
	type SettingsCacheProblem,
	type SettingsCacheState,
} from "./settings-types";
import type { SyncError, SyncState, SyncStatus } from "./types";

const SYNC_STATUSES: readonly SyncStatus[] = [
	"idle",
	"syncing",
	"synced",
	"error",
];

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** The empty, never-synced settings cache. Returned when nothing usable is persisted. */
export function emptySettingsCacheState(): SettingsCacheState {
	return { settings: Settings.empty(), sync: { status: "idle" } };
}

function parseCustomSkills(
	value: unknown,
	problems: SettingsCacheProblem[],
): CustomSkill[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		problems.push({
			kind: "invalid-skill",
			message: "cached custom skills is not an array",
		});
		return [];
	}
	const skills: CustomSkill[] = [];
	for (const entry of value) {
		const parsed = parseCustomSkill(entry);
		if (!parsed.ok) {
			// Quarantine the bad entry; the rest of the cached snapshot survives.
			problems.push({
				kind: "invalid-skill",
				message: `${parsed.error.field}: ${parsed.error.message}`,
			});
			continue;
		}
		skills.push(parsed.value);
	}
	return skills;
}

function parseLocation(
	value: unknown,
	problems: SettingsCacheProblem[],
): DriveLocation | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isObject(value)) {
		problems.push({
			kind: "invalid-location",
			message: "cached drive location is not an object",
		});
		return undefined;
	}
	const folderId = nonEmptyString(value.folderId);
	const fileId = nonEmptyString(value.fileId);
	const revision = nonEmptyString(value.revision);
	if (
		folderId === undefined ||
		fileId === undefined ||
		revision === undefined
	) {
		problems.push({
			kind: "invalid-location",
			message: "cached drive location is missing folderId, fileId, or revision",
		});
		return undefined;
	}
	const folderName = nonEmptyString(value.folderName) ?? "bookmark-ai";
	const fileName = nonEmptyString(value.fileName) ?? "settings.json";
	return {
		folder: { id: folderId as DriveFolderId, name: folderName },
		file: {
			id: fileId as DriveFileId,
			name: fileName,
			revision: revision as DriveRevision,
		},
	};
}

function parseSyncError(value: unknown): SyncError | undefined {
	if (!isObject(value)) {
		return undefined;
	}
	const message = nonEmptyString(value.message);
	if (message === undefined) {
		return undefined;
	}
	const kind = nonEmptyString(value.kind) ?? "unknown";
	return { kind, message };
}

function parseSync(
	value: unknown,
	problems: SettingsCacheProblem[],
): SyncState {
	if (!isObject(value)) {
		problems.push({
			kind: "invalid-sync",
			message: "cached sync state is not an object",
		});
		return { status: "idle" };
	}
	const status = (SYNC_STATUSES as readonly unknown[]).includes(value.status)
		? (value.status as SyncStatus)
		: "idle";

	let lastSyncedAt: SyncState["lastSyncedAt"];
	if (value.lastSyncedAt !== undefined) {
		const parsed = parseIsoTimestamp(value.lastSyncedAt);
		if (parsed.ok) {
			lastSyncedAt = parsed.value;
		} else {
			problems.push({
				kind: "invalid-sync",
				message: `lastSyncedAt: ${parsed.error.message}`,
			});
		}
	}

	const error = parseSyncError(value.error);
	const pending = value.pending === true ? true : undefined;
	return { status, lastSyncedAt, error, pending };
}

/**
 * Parse arbitrary decoded `chrome.storage.local` data into an always-valid
 * {@link SettingsCacheState}. Unknown schema versions, non-objects, and
 * malformed pieces are reported and discarded; the returned state is always
 * safe to use.
 */
export function parseCachedSettingsState(
	value: unknown,
): SettingsCacheParseResult {
	const problems: SettingsCacheProblem[] = [];

	if (!isObject(value)) {
		problems.push({
			kind: "not-an-object",
			message: "cached settings state is not an object",
		});
		return { state: emptySettingsCacheState(), problems };
	}

	if (value.schemaVersion !== SETTINGS_CACHE_SCHEMA_VERSION) {
		problems.push({
			kind: "unsupported-schema",
			message: `unsupported settings cache schemaVersion: ${JSON.stringify(value.schemaVersion)}`,
		});
		return { state: emptySettingsCacheState(), problems };
	}

	let fileUpdatedAt: ReturnType<typeof parseIsoTimestamp> | undefined;
	if (value.updatedAt !== undefined) {
		fileUpdatedAt = parseIsoTimestamp(value.updatedAt);
		if (!fileUpdatedAt.ok) {
			problems.push({
				kind: "invalid-field",
				message: `updatedAt: ${fileUpdatedAt.error.message}`,
			});
		}
	}

	const skills = parseCustomSkills(value.customSkills, problems);
	const location = parseLocation(value.drive, problems);
	const sync = parseSync(value.sync, problems);

	return {
		state: {
			settings: Settings.from(
				skills,
				fileUpdatedAt?.ok ? fileUpdatedAt.value : undefined,
			),
			location,
			sync,
		},
		problems,
	};
}
