/**
 * The Drive client port: a strictly I/O-focused interface over Google Drive.
 *
 * Every method maps to one Drive REST operation and speaks only in branded ids,
 * metadata, and raw text. There is deliberately *no* bookmark-domain method
 * here (no `upsertBookmark`, no merge): duplicate handling, conflict resolution,
 * and AI-status decisions live in `bookmarks/*` and the repository, never in the
 * client. See docs/implementation-principles.md "Repository / Drive client
 * rules".
 *
 * The repository depends on this port, so it can be driven entirely by a fake in
 * tests. {@link createGoogleDriveClient} is the one concrete implementation.
 */
import type {
	DriveDownload,
	DriveFileId,
	DriveFileMetadata,
	DriveFolderId,
	DriveFolderMetadata,
} from "./types";

export interface DriveClient {
	/** Find the named folder the app owns, or `null` if it does not exist yet. */
	findFolder(name: string): Promise<DriveFolderMetadata | null>;
	/** Create a folder with the given name. */
	createFolder(name: string): Promise<DriveFolderMetadata>;
	/** Find a named file inside a parent folder, or `null` if absent. */
	findFile(
		name: string,
		parent: DriveFolderId,
	): Promise<DriveFileMetadata | null>;
	/** Create a file with initial text content inside a parent folder. */
	createFile(input: {
		name: string;
		parent: DriveFolderId;
		content: string;
	}): Promise<DriveFileMetadata>;
	/** Read just the metadata (including the conflict revision) for a file. */
	getFileMetadata(fileId: DriveFileId): Promise<DriveFileMetadata>;
	/** Download a file's text content together with its current metadata. */
	downloadFile(fileId: DriveFileId): Promise<DriveDownload>;
	/** Replace a file's content, returning the post-write metadata. */
	uploadFile(fileId: DriveFileId, content: string): Promise<DriveFileMetadata>;
}
