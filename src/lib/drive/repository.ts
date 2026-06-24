/**
 * The bookmark repository: I/O orchestration over a {@link DriveClient}.
 *
 * This is the seam between the Drive I/O layer and the bookmark domain. It owns
 * folder/file bootstrap, JSONL read/write, conflict detection by revision, and
 * mapping every failure onto a typed {@link RepositoryError}. It owns *no*
 * bookmark behavior: parsing JSONL, building the collection, and — critically —
 * merging local and remote records are all delegated to `bookmarks/*`
 * (`parseJsonl`, `serializeJsonl`, `Bookmarks.mergeRemote`). The repository never
 * inspects or resolves a record conflict itself. See
 * docs/implementation-principles.md "Repository / Drive client rules" and
 * docs/design.md "Drive Write and Conflict Strategy".
 *
 * Conflict-safe write: download → merge via the domain → re-check the revision;
 * if the file changed under us, re-download and merge again before uploading the
 * full JSONL. This is the lightweight protection the MVP calls for, not an
 * append-only event log.
 */
import {
	Bookmarks,
	type JsonlProblem,
	parseJsonl,
	serializeJsonl,
} from "../bookmarks/index";
import type { DriveClient } from "./drive-client";
import {
	type RepositoryError,
	toRepositoryError,
} from "./errors";
import { type Result, err, ok } from "./result";
import {
	type DriveFileMetadata,
	type DriveFolderMetadata,
	type DriveLocation,
	FILE_NAME,
	FOLDER_NAME,
} from "./types";

/** A consistent read of the store: domain collection + I/O metadata. */
export type RepositorySnapshot = {
	readonly bookmarks: Bookmarks;
	/** Malformed JSONL lines from Drive, quarantined rather than dropped. */
	readonly problems: readonly JsonlProblem[];
	readonly file: DriveFileMetadata;
	readonly folder: DriveFolderMetadata;
};

export type DriveBookmarkRepositoryOptions = {
	/**
	 * How many times the conflict-safe write re-downloads and re-merges when the
	 * Drive revision keeps changing under it before giving up. Default 3.
	 */
	maxWriteAttempts?: number;
};

export class DriveBookmarkRepository {
	private readonly client: DriveClient;
	private readonly maxWriteAttempts: number;
	private location: DriveLocation | null = null;

	constructor(client: DriveClient, options: DriveBookmarkRepositoryOptions = {}) {
		this.client = client;
		this.maxWriteAttempts = Math.max(1, options.maxWriteAttempts ?? 3);
	}

	/**
	 * Ensure `bookmark-ai/bookmarks.jsonl` exists, creating the folder and/or an
	 * empty file as needed. Returns the resolved {@link DriveLocation}.
	 */
	async bootstrap(): Promise<Result<DriveLocation, RepositoryError>> {
		try {
			return ok(await this.ensureLocation());
		} catch (error) {
			return err(toRepositoryError(error));
		}
	}

	/** Download and parse the current store into a {@link RepositorySnapshot}. */
	async load(): Promise<Result<RepositorySnapshot, RepositoryError>> {
		try {
			const location = await this.ensureLocation();
			const download = await this.client.downloadFile(location.file.id);
			const { records, problems } = parseJsonl(download.content);
			this.location = { folder: location.folder, file: download.metadata };
			return ok({
				bookmarks: Bookmarks.from(records),
				problems,
				file: download.metadata,
				folder: location.folder,
			});
		} catch (error) {
			return err(toRepositoryError(error));
		}
	}

	/**
	 * Conflict-safe write. `local` is the desired collection (the caller has
	 * already applied its upsert/AI changes through `bookmarks/*`). The merge of
	 * `local` with whatever is currently in Drive is delegated to
	 * {@link Bookmarks.mergeRemote}; this method only decides *when* it is safe to
	 * upload.
	 */
	async save(
		local: Bookmarks,
	): Promise<Result<RepositorySnapshot, RepositoryError>> {
		try {
			const location = await this.ensureLocation();
			let base = local;
			let lastProblems: readonly JsonlProblem[] = [];

			for (let attempt = 0; attempt < this.maxWriteAttempts; attempt++) {
				const download = await this.client.downloadFile(location.file.id);
				const { records, problems } = parseJsonl(download.content);
				lastProblems = problems;

				// Merge belongs to the bookmark domain, not to this I/O layer.
				const merged = base.mergeRemote(Bookmarks.from(records));

				// Re-check the revision; if it moved between our download and now,
				// another writer raced us — carry the merge forward and retry against
				// the newer file rather than clobbering their write.
				const current = await this.client.getFileMetadata(location.file.id);
				if (current.revision !== download.metadata.revision) {
					base = merged;
					continue;
				}

				const content = serializeJsonl(merged.sortedByCreated("asc"));
				const uploaded = await this.client.uploadFile(
					location.file.id,
					content,
				);
				this.location = { folder: location.folder, file: uploaded };
				return ok({
					bookmarks: merged,
					problems: lastProblems,
					file: uploaded,
					folder: location.folder,
				});
			}

			return err({
				kind: "conflict",
				message:
					"Drive file kept changing during save; conflict retries exhausted",
			});
		} catch (error) {
			return err(toRepositoryError(error));
		}
	}

	private async ensureLocation(): Promise<DriveLocation> {
		if (this.location) {
			return this.location;
		}
		const folder =
			(await this.client.findFolder(FOLDER_NAME)) ??
			(await this.client.createFolder(FOLDER_NAME));
		const file =
			(await this.client.findFile(FILE_NAME, folder.id)) ??
			(await this.client.createFile({
				name: FILE_NAME,
				parent: folder.id,
				content: "",
			}));
		this.location = { folder, file };
		return this.location;
	}
}
