import { describe, expect, it } from "vitest";

import {
	Bookmarks,
	bookmarkId,
	isoTimestamp,
	parseJsonl,
	serializeJsonl,
} from "../bookmarks/index";
import { DriveApiError, DriveAuthError } from "./errors";
import type { DriveClient } from "./drive-client";
import { DriveBookmarkRepository } from "./repository";
import type {
	DriveDownload,
	DriveFileId,
	DriveFileMetadata,
	DriveFolderId,
	DriveFolderMetadata,
	DriveRevision,
} from "./types";

/**
 * The repository is driven entirely by an in-memory fake {@link DriveClient}, so
 * no real Drive call happens. The fake exposes *only* I/O operations — it has no
 * merge/upsert method — which is itself the structural proof that bookmark merge
 * behavior lives in `bookmarks/*`, not in the Drive layer. The conflict test
 * additionally asserts the uploaded JSONL is byte-identical to what
 * {@link Bookmarks.mergeRemote} produces.
 */

function makeBookmarks(
	entries: Array<{ url: string; title: string; now: string; id: string }>,
): Bookmarks {
	let bookmarks = Bookmarks.empty();
	for (const entry of entries) {
		const result = bookmarks.upsert(
			{ url: entry.url, title: entry.title },
			{ id: bookmarkId(entry.id), now: isoTimestamp(entry.now) },
		);
		if (!result.ok) {
			throw new Error(`fixture upsert failed: ${JSON.stringify(result.error)}`);
		}
		bookmarks = result.value;
	}
	return bookmarks;
}

function jsonlOf(bookmarks: Bookmarks): string {
	return serializeJsonl(bookmarks.sortedByCreated("asc"));
}

function urlsIn(content: string): string[] {
	return parseJsonl(content)
		.records.map((record) => record.url)
		.sort();
}

/** In-memory Drive file with a queue of "external" edits to simulate races. */
class FakeDriveClient implements DriveClient {
	folder: DriveFolderMetadata | null;
	file: { content: string; meta: DriveFileMetadata } | null;
	private revision = 1;
	externalEdits: string[] = [];
	log = {
		findFolder: 0,
		findFile: 0,
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
				? { content: init.content, meta: this.nextMeta(init.content) }
				: null;
	}

	private nextMeta(_content: string): DriveFileMetadata {
		return {
			id: (this.file?.meta.id ?? "file-1") as DriveFileId,
			name: "bookmarks.jsonl",
			revision: `rev-${this.revision++}` as DriveRevision,
		};
	}

	private writeFile(content: string): DriveFileMetadata {
		const meta = this.nextMeta(content);
		this.file = { content, meta };
		return meta;
	}

	async findFolder(_name: string): Promise<DriveFolderMetadata | null> {
		this.log.findFolder += 1;
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
		this.log.findFile += 1;
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
		// A queued external edit lands here, between a caller's download and its
		// pre-upload revision check — exactly the conflict window.
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

describe("DriveBookmarkRepository", () => {
	describe("bootstrap", () => {
		it("creates the folder and file when neither exists", async () => {
			const client = new FakeDriveClient();
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.bootstrap();

			expect(result.ok).toBe(true);
			expect(client.log.createdFolder).toBe(true);
			expect(client.log.createdFile).toBe(true);
			if (result.ok) {
				expect(result.value.file.name).toBe("bookmarks.jsonl");
				expect(result.value.folder.name).toBe("bookmark-ai");
			}
		});

		it("reuses an existing folder and file without creating", async () => {
			const client = new FakeDriveClient({ folderId: "folder-1", content: "" });
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.bootstrap();

			expect(result.ok).toBe(true);
			expect(client.log.createdFolder).toBe(false);
			expect(client.log.createdFile).toBe(false);
		});
	});

	describe("load", () => {
		it("parses JSONL into a Bookmarks collection and reports problems", async () => {
			const remote = makeBookmarks([
				{
					url: "https://a.test/",
					title: "A",
					now: "2026-01-01T00:00:00Z",
					id: "a",
				},
			]);
			const content = `${jsonlOf(remote)}{ not json }\n`;
			const client = new FakeDriveClient({ folderId: "folder-1", content });
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.load();

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.bookmarks.size).toBe(1);
				expect(result.value.problems).toHaveLength(1);
				expect(result.value.file.revision).toBeDefined();
			}
		});

		it("maps a Drive API failure onto a typed repository error", async () => {
			const client = new FakeDriveClient({ folderId: "folder-1", content: "" });
			client.downloadFile = async () => {
				throw new DriveApiError("not-found", "gone", 404);
			};
			const repo = new DriveBookmarkRepository(client);

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
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.load();

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("auth");
			}
		});
	});

	describe("save", () => {
		it("merges local with remote and uploads once when no conflict occurs", async () => {
			const remote = makeBookmarks([
				{
					url: "https://remote.test/",
					title: "R",
					now: "2026-01-01T00:00:00Z",
					id: "r",
				},
			]);
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: jsonlOf(remote),
			});
			const local = makeBookmarks([
				{
					url: "https://local.test/",
					title: "L",
					now: "2026-02-01T00:00:00Z",
					id: "l",
				},
			]);
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.save(local);

			expect(result.ok).toBe(true);
			expect(client.log.uploads).toHaveLength(1);
			expect(client.log.downloads).toBe(1);
			expect(urlsIn(client.log.uploads[0])).toEqual([
				"https://local.test/",
				"https://remote.test/",
			]);
		});

		it("re-downloads and re-merges when the revision changed before upload", async () => {
			const remote0 = makeBookmarks([
				{
					url: "https://remote.test/",
					title: "R",
					now: "2026-01-01T00:00:00Z",
					id: "r",
				},
			]);
			const remote1 = makeBookmarks([
				{
					url: "https://remote.test/",
					title: "R",
					now: "2026-01-01T00:00:00Z",
					id: "r",
				},
				{
					url: "https://other-pc.test/",
					title: "O",
					now: "2026-01-15T00:00:00Z",
					id: "o",
				},
			]);
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: jsonlOf(remote0),
			});
			// One concurrent write lands during the first attempt's revision check.
			client.externalEdits = [jsonlOf(remote1)];

			const local = makeBookmarks([
				{
					url: "https://local.test/",
					title: "L",
					now: "2026-02-01T00:00:00Z",
					id: "l",
				},
			]);
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.save(local);

			expect(result.ok).toBe(true);
			// Two downloads: the initial read, then the re-read after the conflict.
			expect(client.log.downloads).toBe(2);
			expect(client.log.uploads).toHaveLength(1);
			// The other PC's write survives the merge alongside the local one.
			expect(urlsIn(client.log.uploads[0])).toEqual([
				"https://local.test/",
				"https://other-pc.test/",
				"https://remote.test/",
			]);

			// Delegation proof: the uploaded bytes equal exactly what the bookmark
			// domain's mergeRemote produces — the repository invents no merge of its
			// own.
			const expected = local.mergeRemote(remote0).mergeRemote(remote1);
			expect(client.log.uploads[0]).toBe(jsonlOf(expected));
		});

		it("resolves a same-URL conflict by the bookmark domain's rules", async () => {
			// Same canonical URL on both sides with different updatedAt: the newer
			// one must win, which is mergeRemote's contract, not the repo's.
			const remote = makeBookmarks([
				{
					url: "https://dup.test/",
					title: "old",
					now: "2026-01-01T00:00:00Z",
					id: "d",
				},
			]);
			const local = makeBookmarks([
				{
					url: "https://dup.test/",
					title: "new",
					now: "2026-03-01T00:00:00Z",
					id: "d",
				},
			]);
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: jsonlOf(remote),
			});
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.save(local);

			expect(result.ok).toBe(true);
			const expected = local.mergeRemote(remote);
			expect(client.log.uploads[0]).toBe(jsonlOf(expected));
			const uploaded = parseJsonl(client.log.uploads[0]).records;
			expect(uploaded).toHaveLength(1);
			expect(uploaded[0].title).toBe("new");
		});

		it("propagates a deletion: writes a tombstone and drops the record from Drive", async () => {
			// Drive still holds the record this device deleted locally.
			const remote = makeBookmarks([
				{
					url: "https://gone.test/",
					title: "G",
					now: "2026-01-01T00:00:00Z",
					id: "g",
				},
			]);
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: jsonlOf(remote),
			});
			const canonicalUrl = remote.toArray()[0].canonicalUrl;
			// Deleted after the record's updatedAt, so the tombstone wins the merge.
			const local = remote.delete(
				canonicalUrl,
				isoTimestamp("2026-02-01T00:00:00Z"),
			);
			const repo = new DriveBookmarkRepository(client);

			const result = await repo.save(local);

			expect(result.ok).toBe(true);
			// The uploaded file no longer carries the live record...
			const uploaded = parseJsonl(client.log.uploads[0]);
			expect(uploaded.records).toHaveLength(0);
			// ...but does carry a tombstone, so another device cannot resurrect it.
			expect(uploaded.tombstones.map((t) => t.canonicalUrl)).toEqual([
				canonicalUrl,
			]);

			// A second device loading this Drive state sees the record gone.
			const otherClient = new FakeDriveClient({
				folderId: "folder-1",
				content: client.log.uploads[0],
			});
			const otherRepo = new DriveBookmarkRepository(otherClient);
			const loaded = await otherRepo.load();
			expect(loaded.ok).toBe(true);
			if (loaded.ok) {
				expect(loaded.value.bookmarks.size).toBe(0);
				expect(loaded.value.bookmarks.get(canonicalUrl)).toBeUndefined();
			}
		});

		it("gives up with a conflict error when the revision never settles", async () => {
			const remote = makeBookmarks([
				{
					url: "https://remote.test/",
					title: "R",
					now: "2026-01-01T00:00:00Z",
					id: "r",
				},
			]);
			const client = new FakeDriveClient({
				folderId: "folder-1",
				content: jsonlOf(remote),
			});
			// Every revision check sees a fresh external write — never stable.
			client.externalEdits = [
				jsonlOf(remote),
				jsonlOf(remote),
				jsonlOf(remote),
				jsonlOf(remote),
			];
			const local = makeBookmarks([
				{
					url: "https://local.test/",
					title: "L",
					now: "2026-02-01T00:00:00Z",
					id: "l",
				},
			]);
			const repo = new DriveBookmarkRepository(client, { maxWriteAttempts: 2 });

			const result = await repo.save(local);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("conflict");
			}
			expect(client.log.uploads).toHaveLength(0);
		});
	});
});
