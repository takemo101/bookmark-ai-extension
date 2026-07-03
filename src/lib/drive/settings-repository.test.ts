import { describe, expect, it } from "vitest";

import { isoTimestamp } from "../bookmarks/index";
import {
	Settings,
	parseSettingsText,
	serializeSettings,
	skillId,
} from "../settings/index";
import { DriveApiError, DriveAuthError } from "./errors";
import type { DriveClient } from "./drive-client";
import { DriveSettingsRepository } from "./settings-repository";
import type {
	DriveDownload,
	DriveFileId,
	DriveFileMetadata,
	DriveFolderId,
	DriveFolderMetadata,
	DriveRevision,
} from "./types";

/**
 * The repository is driven entirely by an in-memory fake {@link DriveClient},
 * exactly like `repository.test.ts`. No real Drive call happens.
 */

function settingsWith(opts: {
	name: string;
	updatedAt: string;
	id?: string;
}): Settings {
	const now = isoTimestamp(opts.updatedAt);
	const result = Settings.empty().add(
		{ name: opts.name, instruction: "Focus on X." },
		{ id: skillId(opts.id ?? "s1"), now },
	);
	if (!result.ok) {
		throw new Error(`fixture add failed: ${JSON.stringify(result.error)}`);
	}
	return result.value;
}

/** In-memory Drive file with a queue of "external" edits to simulate races. */
class FakeDriveClient implements DriveClient {
	folder: DriveFolderMetadata | null;
	file: { content: string; meta: DriveFileMetadata } | null;
	private revision = 1;
	externalEdits: string[] = [];
	log = {
		createdFolder: false,
		createdFile: false,
		downloads: 0,
		metadataChecks: 0,
		uploads: [] as string[],
	};

	constructor(init: { folderId?: string; content?: string } = {}) {
		this.folder = init.folderId
			? { id: init.folderId as DriveFolderId, name: "bookmark-ai" }
			: null;
		this.file =
			init.content !== undefined
				? { content: init.content, meta: this.nextMeta() }
				: null;
	}

	private nextMeta(): DriveFileMetadata {
		return {
			id: (this.file?.meta.id ?? "file-1") as DriveFileId,
			name: "settings.json",
			revision: `rev-${this.revision++}` as DriveRevision,
		};
	}

	private writeFile(content: string): DriveFileMetadata {
		const meta = this.nextMeta();
		this.file = { content, meta };
		return meta;
	}

	async findFolder(_name: string): Promise<DriveFolderMetadata | null> {
		return this.folder;
	}

	async createFolder(name: string): Promise<DriveFolderMetadata> {
		this.log.createdFolder = true;
		this.folder = { id: "folder-1" as DriveFolderId, name };
		return this.folder;
	}

	async findFile(
		_name: string,
		_parent: DriveFolderId,
	): Promise<DriveFileMetadata | null> {
		return this.file?.meta ?? null;
	}

	async createFile(input: {
		name: string;
		parent: DriveFolderId;
		content: string;
	}): Promise<DriveFileMetadata> {
		this.log.createdFile = true;
		return this.writeFile(input.content);
	}

	async getFileMetadata(_fileId: DriveFileId): Promise<DriveFileMetadata> {
		this.log.metadataChecks += 1;
		const edit = this.externalEdits.shift();
		if (edit !== undefined) {
			this.writeFile(edit);
		}
		if (!this.file) {
			throw new DriveApiError("not-found", "no file");
		}
		return this.file.meta;
	}

	async downloadFile(_fileId: DriveFileId): Promise<DriveDownload> {
		this.log.downloads += 1;
		if (!this.file) {
			throw new DriveApiError("not-found", "no file");
		}
		return { content: this.file.content, metadata: this.file.meta };
	}

	async uploadFile(
		_fileId: DriveFileId,
		content: string,
	): Promise<DriveFileMetadata> {
		this.log.uploads.push(content);
		return this.writeFile(content);
	}
}

describe("DriveSettingsRepository", () => {
	describe("bootstrap", () => {
		it("creates the folder and file when neither exists", async () => {
			const client = new FakeDriveClient();
			const repo = new DriveSettingsRepository(client);

			const result = await repo.bootstrap();

			expect(result.ok).toBe(true);
			expect(client.log.createdFolder).toBe(true);
			expect(client.log.createdFile).toBe(true);
			if (result.ok) {
				expect(result.value.file.name).toBe("settings.json");
				expect(result.value.folder.name).toBe("bookmark-ai");
			}
		});

		it("reuses an existing folder and file without creating", async () => {
			const client = new FakeDriveClient({ folderId: "folder-1", content: "" });
			const repo = new DriveSettingsRepository(client);

			const result = await repo.bootstrap();

			expect(result.ok).toBe(true);
			expect(client.log.createdFolder).toBe(false);
			expect(client.log.createdFile).toBe(false);
		});
	});

	describe("load", () => {
		it("bootstraps missing/empty content to default empty settings", async () => {
			const client = new FakeDriveClient({ folderId: "folder-1", content: "" });
			const repo = new DriveSettingsRepository(client);

			const result = await repo.load();

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.settings.size).toBe(0);
				expect(result.value.problems).toHaveLength(0);
			}
		});

		it("parses valid settings JSON and quarantines invalid JSON as a safe problem", async () => {
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: "{ not json",
			});
			const repo = new DriveSettingsRepository(client);

			const result = await repo.load();

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.settings.size).toBe(0);
				expect(result.value.problems).toHaveLength(1);
				expect(result.value.problems[0].kind).toBe("malformed-json");
			}
		});

		it("maps a Drive API failure onto a typed repository error", async () => {
			const client = new FakeDriveClient({ folderId: "folder-1", content: "" });
			client.downloadFile = async () => {
				throw new DriveApiError("not-found", "gone", 404);
			};
			const repo = new DriveSettingsRepository(client);

			const result = await repo.load();

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not-found");
				expect(result.error.status).toBe(404);
			}
		});

		it("maps an auth failure onto kind 'auth'", async () => {
			const client = new FakeDriveClient({ folderId: "folder-1", content: "" });
			client.downloadFile = async () => {
				throw new DriveAuthError("not signed in");
			};
			const repo = new DriveSettingsRepository(client);

			const result = await repo.load();

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("auth");
			}
		});
	});

	describe("save", () => {
		it("uploads desired when desired.updatedAt is strictly newer than remote (tie also favors desired)", async () => {
			const remote = settingsWith({
				name: "old",
				updatedAt: "2026-01-01T00:00:00Z",
			});
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: JSON.stringify(serializeSettings(remote)),
			});
			const desired = settingsWith({
				name: "new",
				updatedAt: "2026-02-01T00:00:00Z",
				id: "s2",
			});
			const repo = new DriveSettingsRepository(client);

			const result = await repo.save(desired);

			expect(result.ok).toBe(true);
			expect(client.log.uploads).toHaveLength(1);
			if (result.ok) {
				expect(result.value.settings.customSkills()[0]?.name).toBe("new");
			}
		});

		it("remote wins wholesale when strictly newer than desired, uploading nothing", async () => {
			const remote = settingsWith({
				name: "remote-newer",
				updatedAt: "2026-03-01T00:00:00Z",
			});
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: JSON.stringify(serializeSettings(remote)),
			});
			const desired = settingsWith({
				name: "local-older",
				updatedAt: "2026-01-01T00:00:00Z",
				id: "s2",
			});
			const repo = new DriveSettingsRepository(client);

			const result = await repo.save(desired);

			expect(result.ok).toBe(true);
			expect(client.log.uploads).toHaveLength(0);
			if (result.ok) {
				expect(result.value.settings.customSkills()[0]?.name).toBe(
					"remote-newer",
				);
			}
		});

		it("a tie in updatedAt favors desired (the fresh explicit write)", async () => {
			const tie = "2026-01-01T00:00:00Z";
			const remote = settingsWith({ name: "remote", updatedAt: tie });
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: JSON.stringify(serializeSettings(remote)),
			});
			const desired = settingsWith({
				name: "desired",
				updatedAt: tie,
				id: "s2",
			});
			const repo = new DriveSettingsRepository(client);

			const result = await repo.save(desired);

			expect(result.ok).toBe(true);
			expect(client.log.uploads).toHaveLength(1);
			if (result.ok) {
				expect(result.value.settings.customSkills()[0]?.name).toBe("desired");
			}
		});

		it("re-downloads and re-checks when the revision changed before upload", async () => {
			const remote0 = settingsWith({
				name: "r0",
				updatedAt: "2026-01-01T00:00:00Z",
			});
			const remote1 = settingsWith({
				name: "r1",
				updatedAt: "2026-01-05T00:00:00Z",
			});
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: JSON.stringify(serializeSettings(remote0)),
			});
			// One concurrent write lands during the first attempt's revision check.
			client.externalEdits = [JSON.stringify(serializeSettings(remote1))];

			const desired = settingsWith({
				name: "desired",
				updatedAt: "2026-02-01T00:00:00Z",
				id: "s2",
			});
			const repo = new DriveSettingsRepository(client);

			const result = await repo.save(desired);

			expect(result.ok).toBe(true);
			// Initial download + re-download after the conflict.
			expect(client.log.downloads).toBe(2);
			expect(client.log.uploads).toHaveLength(1);
			const uploaded = parseSettingsText(client.log.uploads[0]);
			expect(uploaded.settings.customSkills()[0]?.name).toBe("desired");
		});

		it("gives up with a conflict error when the revision never settles", async () => {
			const remote = settingsWith({
				name: "r",
				updatedAt: "2026-01-01T00:00:00Z",
			});
			const content = JSON.stringify(serializeSettings(remote));
			const client = new FakeDriveClient({ folderId: "folder-1", content });
			client.externalEdits = [content, content, content, content];
			const desired = settingsWith({
				name: "desired",
				updatedAt: "2026-02-01T00:00:00Z",
				id: "s2",
			});
			const repo = new DriveSettingsRepository(client, {
				maxWriteAttempts: 2,
			});

			const result = await repo.save(desired);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("conflict");
			}
			expect(client.log.uploads).toHaveLength(0);
		});
	});
});
