/**
 * Branded Drive identifiers, file/folder metadata shapes, and the fixed store
 * location.
 *
 * Drive ids and revisions are wrapped so a folder id can never be passed where a
 * file id is expected, and so a content revision marker can never be confused
 * with a plain string. See docs/implementation-principles.md "Primitive wrapping
 * policy". The metadata shapes here are the *only* Drive data that crosses out
 * of the I/O layer — raw Google API response objects never escape the adapter
 * (see "Repository / Drive client rules").
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DriveFolderId = Brand<string, "DriveFolderId">;
export type DriveFileId = Brand<string, "DriveFileId">;
/**
 * Opaque content-revision marker used for conflict detection. The adapter
 * derives it from the best available Drive field (`headRevisionId`, falling back
 * to `version` then `modifiedTime`); callers only ever compare two revisions for
 * equality and never interpret the contents.
 */
export type DriveRevision = Brand<string, "DriveRevision">;

/** Fixed, user-visible Drive location for the bookmark store (docs/design.md). */
export const FOLDER_NAME = "bookmark-ai";
export const FILE_NAME = "bookmarks.jsonl";
/**
 * Fixed, user-visible Drive location for custom analysis-skill settings, in
 * the same `bookmark-ai/` folder as {@link FILE_NAME}
 * (docs/ai-analysis-v2.md "Settings file").
 */
export const SETTINGS_FILE_NAME = "settings.json";

/** Google Drive mime type for a folder. */
export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
/** Mime type stored for the JSONL file. */
export const JSONL_MIME_TYPE = "application/x-ndjson";

/** Metadata for the `bookmark-ai/` folder. */
export type DriveFolderMetadata = {
	readonly id: DriveFolderId;
	readonly name: string;
};

/** Metadata for the `bookmarks.jsonl` file, including its conflict revision. */
export type DriveFileMetadata = {
	readonly id: DriveFileId;
	readonly name: string;
	readonly revision: DriveRevision;
};

/** A downloaded file: its text content plus the metadata read alongside it. */
export type DriveDownload = {
	readonly content: string;
	readonly metadata: DriveFileMetadata;
};

/** Resolved store location after folder/file bootstrap. */
export type DriveLocation = {
	readonly folder: DriveFolderMetadata;
	readonly file: DriveFileMetadata;
};
