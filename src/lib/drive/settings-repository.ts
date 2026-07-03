/**
 * The settings repository: I/O orchestration over a {@link DriveClient} for
 * `bookmark-ai/settings.json`. Mirrors {@link DriveBookmarkRepository}'s
 * bootstrap/load/save shape, but there is no per-record domain merge: this
 * file's conflict policy is file-level `updatedAt` last-writer-wins
 * (docs/ai-analysis-v2.md "Conflict policy for settings") rather than a
 * per-skill merge.
 *
 * Whichever side's `updatedAt` is strictly newer wins wholesale; a tie favors
 * the caller's `desired` value (the fresh explicit write), which mirrors the
 * tie-break direction `bookmarks/collection.ts` already uses for record-vs-
 * tombstone conflicts (docs/design.md "Drive Write and Conflict Strategy"): a
 * fresh explicit write is preferred over merely re-confirming old state. This
 * repository owns no skill-domain decisions beyond that one comparison — CRUD,
 * id uniqueness, and field validation all live in `settings/*`
 * (docs/implementation-principles.md "Repository / Drive client rules").
 *
 * The write path keeps the same conflict-safe retry shape as
 * {@link DriveBookmarkRepository.save}: re-check the file's revision after
 * download and before upload, and retry from the top if it moved, so a
 * concurrent writer is never silently clobbered.
 */
import { compareIsoTimestamp } from "../bookmarks/index";
import {
	Settings,
	type SettingsProblem,
	parseSettingsText,
	serializeSettings,
} from "../settings/index";
import type { DriveClient } from "./drive-client";
import { type RepositoryError, toRepositoryError } from "./errors";
import { type Result, err, ok } from "./result";
import {
	type DriveFileMetadata,
	type DriveFolderMetadata,
	type DriveLocation,
	FOLDER_NAME,
	SETTINGS_FILE_NAME,
} from "./types";

/** A consistent read of the settings store: domain collection + I/O metadata. */
export type SettingsRepositorySnapshot = {
	readonly settings: Settings;
	/** Malformed settings JSON, quarantined rather than dropped. */
	readonly problems: readonly SettingsProblem[];
	readonly file: DriveFileMetadata;
	readonly folder: DriveFolderMetadata;
};

export type DriveSettingsRepositoryOptions = {
	/**
	 * How many times the conflict-safe write re-downloads and re-checks the
	 * Drive revision when it keeps changing under it before giving up. Default 3
	 * — the same default as {@link DriveBookmarkRepository}.
	 */
	maxWriteAttempts?: number;
};

export class DriveSettingsRepository {
	private readonly client: DriveClient;
	private readonly maxWriteAttempts: number;
	private location: DriveLocation | null = null;

	constructor(
		client: DriveClient,
		options: DriveSettingsRepositoryOptions = {},
	) {
		this.client = client;
		this.maxWriteAttempts = Math.max(1, options.maxWriteAttempts ?? 3);
	}

	/**
	 * Ensure `bookmark-ai/settings.json` exists, creating the folder and/or an
	 * empty file as needed. Returns the resolved {@link DriveLocation}.
	 */
	async bootstrap(): Promise<Result<DriveLocation, RepositoryError>> {
		try {
			return ok(await this.ensureLocation());
		} catch (error) {
			return err(toRepositoryError(error));
		}
	}

	/** Download and parse the current settings file into a {@link SettingsRepositorySnapshot}. */
	async load(): Promise<Result<SettingsRepositorySnapshot, RepositoryError>> {
		try {
			const location = await this.ensureLocation();
			const download = await this.client.downloadFile(location.file.id);
			const { settings, problems } = parseSettingsText(download.content);
			this.location = { folder: location.folder, file: download.metadata };
			return ok({
				settings,
				problems,
				file: download.metadata,
				folder: location.folder,
			});
		} catch (error) {
			return err(toRepositoryError(error));
		}
	}

	/**
	 * File-level `updatedAt` last-writer-wins. `desired` is the caller's fully
	 * formed settings value (already mutated through `Settings` CRUD). If the
	 * remote file is strictly newer, it wins wholesale and nothing is uploaded —
	 * the returned snapshot reflects the remote state, and the caller's edit is
	 * intentionally superseded (docs/ai-analysis-v2.md's stated simplification,
	 * not a bug). Otherwise (including a tie) `desired` is uploaded.
	 */
	async save(
		desired: Settings,
	): Promise<Result<SettingsRepositorySnapshot, RepositoryError>> {
		try {
			const location = await this.ensureLocation();
			let lastProblems: readonly SettingsProblem[] = [];

			for (let attempt = 0; attempt < this.maxWriteAttempts; attempt++) {
				const download = await this.client.downloadFile(location.file.id);
				const { settings: remote, problems } = parseSettingsText(
					download.content,
				);
				lastProblems = problems;

				if (compareIsoTimestamp(remote.updatedAt, desired.updatedAt) > 0) {
					// Remote is strictly newer: it wins wholesale, nothing to upload.
					this.location = { folder: location.folder, file: download.metadata };
					return ok({
						settings: remote,
						problems: lastProblems,
						file: download.metadata,
						folder: location.folder,
					});
				}

				// Re-check the revision; if it moved between our download and now,
				// another writer raced us — retry from the top against the newer file
				// rather than clobbering their write.
				const current = await this.client.getFileMetadata(location.file.id);
				if (current.revision !== download.metadata.revision) {
					continue;
				}

				const content = JSON.stringify(serializeSettings(desired));
				const uploaded = await this.client.uploadFile(
					location.file.id,
					content,
				);
				this.location = { folder: location.folder, file: uploaded };
				return ok({
					settings: desired,
					problems: lastProblems,
					file: uploaded,
					folder: location.folder,
				});
			}

			return err({
				kind: "conflict",
				message:
					"Drive settings file kept changing during save; conflict retries exhausted",
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
			(await this.client.findFile(SETTINGS_FILE_NAME, folder.id)) ??
			(await this.client.createFile({
				name: SETTINGS_FILE_NAME,
				parent: folder.id,
				content: "",
			}));
		this.location = { folder, file };
		return this.location;
	}
}
