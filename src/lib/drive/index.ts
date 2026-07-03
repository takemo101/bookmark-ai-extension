/**
 * `drive/*` boundary.
 *
 * Owns Google auth token use, Drive folder/file bootstrap, metadata/revision
 * reads, download, and upload of `bookmark-ai/bookmarks.jsonl`. It is strictly
 * I/O-focused: it must not embed bookmark-domain decisions such as duplicate
 * handling, conflict resolution, or AI status transitions — those are delegated
 * to `bookmarks/*`. See docs/design.md "Google Drive Storage" / "Drive Write and
 * Conflict Strategy" and docs/implementation-principles.md.
 *
 * Surface:
 *   - {@link TokenProvider} + {@link createChromeIdentityTokenProvider} — OAuth
 *     token port and the `chrome.identity` adapter (`drive.file` scope).
 *   - {@link DriveClient} + {@link createGoogleDriveClient} — Drive REST I/O port
 *     and its fetch-based adapter.
 *   - {@link DriveBookmarkRepository} — bootstrap, load, and conflict-safe save,
 *     delegating record merge to {@link Bookmarks}.
 *   - {@link DriveSettingsRepository} — the same bootstrap/load/save shape for
 *     `bookmark-ai/settings.json`, with file-level `updatedAt`
 *     last-writer-wins in place of a per-record merge (MIK-018).
 *   - Typed values, metadata shapes, and the {@link RepositoryError} taxonomy.
 */
export type { Result, Ok, Err } from "./result";
export { ok, err } from "./result";

export {
	type DriveFolderId,
	type DriveFileId,
	type DriveRevision,
	type DriveFolderMetadata,
	type DriveFileMetadata,
	type DriveDownload,
	type DriveLocation,
	FOLDER_NAME,
	FILE_NAME,
	SETTINGS_FILE_NAME,
	FOLDER_MIME_TYPE,
	JSONL_MIME_TYPE,
} from "./types";

export {
	type RepositoryErrorKind,
	type RepositoryError,
	DriveAuthError,
	DriveApiError,
	classifyStatus,
	toRepositoryError,
} from "./errors";

export {
	type TokenProvider,
	type ChromeIdentityApi,
	type LastErrorAccessor,
	type ChromeTokenProviderDeps,
	createChromeIdentityTokenProvider,
} from "./token-provider";

export type { DriveClient } from "./drive-client";

export {
	type GoogleDriveClientDeps,
	createGoogleDriveClient,
} from "./google-drive-client";

export {
	type RepositorySnapshot,
	type DriveBookmarkRepositoryOptions,
	DriveBookmarkRepository,
} from "./repository";

export {
	type SettingsRepositorySnapshot,
	type DriveSettingsRepositoryOptions,
	DriveSettingsRepository,
} from "./settings-repository";
