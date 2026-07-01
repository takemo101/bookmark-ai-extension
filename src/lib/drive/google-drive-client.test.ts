import { describe, expect, it } from "vitest";

import { DriveApiError } from "./errors";
import { createGoogleDriveClient } from "./google-drive-client";
import type { TokenProvider } from "./token-provider";
import type { DriveFileId, DriveFolderId } from "./types";

/**
 * The adapter is exercised with a fake `fetch` and a fake {@link TokenProvider},
 * so no real network or Google call happens. Tests assert request shaping, the
 * `Bearer` header, response parsing, the 401 retry, HTTP error mapping, and the
 * security invariant that the token never reaches a thrown error.
 */

type CapturedRequest = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: unknown;
};

const SECRET_TOKEN = "ya29.secret-token-value";

function fakeTokenProvider(tokens: string[] = [SECRET_TOKEN]): {
	provider: TokenProvider;
	calls: { get: number; invalidated: string[] };
} {
	let index = 0;
	const calls = { get: 0, invalidated: [] as string[] };
	return {
		calls,
		provider: {
			async getToken() {
				calls.get += 1;
				return tokens[Math.min(index++, tokens.length - 1)];
			},
			async invalidateToken(token: string) {
				calls.invalidated.push(token);
			},
		},
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** A fetch fake that records every request and replays a queue of responses. */
function recordingFetch(responses: Array<() => Response>): {
	fetchFn: typeof fetch;
	requests: CapturedRequest[];
} {
	const requests: CapturedRequest[] = [];
	let i = 0;
	const fetchFn = (async (url: string | URL, init?: RequestInit) => {
		requests.push({
			url: String(url),
			method: init?.method ?? "GET",
			headers: (init?.headers as Record<string, string>) ?? {},
			body: init?.body,
		});
		const make = responses[Math.min(i++, responses.length - 1)];
		return make();
	}) as unknown as typeof fetch;
	return { fetchFn, requests };
}

const FILE = { id: "file-1", name: "bookmarks.jsonl", headRevisionId: "rev-1" };

describe("createGoogleDriveClient", () => {
	it("sends a bearer token and parses a folder lookup", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn, requests } = recordingFetch([
			() => jsonResponse({ files: [{ id: "folder-1", name: "bookmark-ai" }] }),
		]);
		const client = createGoogleDriveClient(provider, { fetchFn });

		const folder = await client.findFolder("bookmark-ai");

		expect(folder).toEqual({ id: "folder-1", name: "bookmark-ai" });
		expect(requests[0].headers.Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
		expect(requests[0].url).toContain("mimeType");
		expect(requests[0].url).toContain("trashed");
	});

	it("returns null when a folder lookup is empty", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn } = recordingFetch([() => jsonResponse({ files: [] })]);
		const client = createGoogleDriveClient(provider, { fetchFn });
		expect(await client.findFolder("bookmark-ai")).toBeNull();
	});

	it("creates a folder with the folder mime type", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn, requests } = recordingFetch([
			() => jsonResponse({ id: "folder-9", name: "bookmark-ai" }),
		]);
		const client = createGoogleDriveClient(provider, { fetchFn });

		const folder = await client.createFolder("bookmark-ai");

		expect(folder.id).toBe("folder-9");
		expect(requests[0].method).toBe("POST");
		expect(String(requests[0].body)).toContain(
			"application/vnd.google-apps.folder",
		);
	});

	it("creates a file as a multipart upload with content", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn, requests } = recordingFetch([() => jsonResponse(FILE)]);
		const client = createGoogleDriveClient(provider, { fetchFn });

		const file = await client.createFile({
			name: "bookmarks.jsonl",
			parent: "folder-1" as DriveFolderId,
			content: "line-1\n",
		});

		expect(file).toEqual({
			id: "file-1",
			name: "bookmarks.jsonl",
			revision: "rev-1",
		});
		expect(requests[0].url).toContain("uploadType=multipart");
		expect(String(requests[0].body)).toContain("line-1");
		expect(requests[0].headers["Content-Type"]).toContain("multipart/related");
	});

	it("downloads content and metadata in two requests", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn, requests } = recordingFetch([
			() => new Response("a\nb\n", { status: 200 }),
			() => jsonResponse(FILE),
		]);
		const client = createGoogleDriveClient(provider, { fetchFn });

		const download = await client.downloadFile("file-1" as DriveFileId);

		expect(download.content).toBe("a\nb\n");
		expect(download.metadata.revision).toBe("rev-1");
		expect(requests[0].url).toContain("alt=media");
		expect(requests[1].url).toContain("fields=");
	});

	it("uploads new content with a PATCH media request", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn, requests } = recordingFetch([
			() => jsonResponse({ ...FILE, headRevisionId: "rev-2" }),
		]);
		const client = createGoogleDriveClient(provider, { fetchFn });

		const meta = await client.uploadFile("file-1" as DriveFileId, "new\n");

		expect(meta.revision).toBe("rev-2");
		expect(requests[0].method).toBe("PATCH");
		expect(requests[0].url).toContain("uploadType=media");
		expect(String(requests[0].body)).toBe("new\n");
	});

	it("derives the revision from version when headRevisionId is absent", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn } = recordingFetch([
			() => jsonResponse({ id: "file-1", name: "x", version: "42" }),
		]);
		const client = createGoogleDriveClient(provider, { fetchFn });
		const meta = await client.getFileMetadata("file-1" as DriveFileId);
		expect(meta.revision).toBe("42");
	});

	it("refreshes the token and retries once on 401", async () => {
		const { provider, calls } = fakeTokenProvider(["stale", "fresh"]);
		const { fetchFn, requests } = recordingFetch([
			() => jsonResponse({ error: { message: "invalid token" } }, 401),
			() => jsonResponse(FILE),
		]);
		const client = createGoogleDriveClient(provider, { fetchFn });

		const meta = await client.getFileMetadata("file-1" as DriveFileId);

		expect(meta.revision).toBe("rev-1");
		expect(calls.invalidated).toEqual(["stale"]);
		expect(calls.get).toBe(2);
		expect(requests[0].headers.Authorization).toBe("Bearer stale");
		expect(requests[1].headers.Authorization).toBe("Bearer fresh");
	});

	it("maps HTTP statuses onto typed Drive errors", async () => {
		const cases: Array<[number, string]> = [
			[404, "not-found"],
			[429, "rate-limit"],
			[500, "server"],
			[403, "permission"],
		];
		for (const [status, kind] of cases) {
			const { provider } = fakeTokenProvider();
			const { fetchFn } = recordingFetch([
				() => jsonResponse({ error: { message: "boom" } }, status),
			]);
			const client = createGoogleDriveClient(provider, { fetchFn });
			try {
				await client.getFileMetadata("file-1" as DriveFileId);
				throw new Error(`expected ${status} to throw`);
			} catch (error) {
				expect(error).toBeInstanceOf(DriveApiError);
				expect((error as DriveApiError).kind).toBe(kind);
				expect((error as DriveApiError).status).toBe(status);
			}
		}
	});

	it("throws malformed-response when the id is missing", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn } = recordingFetch([() => jsonResponse({ name: "x" })]);
		const client = createGoogleDriveClient(provider, { fetchFn });
		await expect(
			client.getFileMetadata("file-1" as DriveFileId),
		).rejects.toMatchObject({ kind: "malformed-response" });
	});

	it("never leaks the token into a thrown API error", async () => {
		const { provider } = fakeTokenProvider();
		const { fetchFn } = recordingFetch([
			() => jsonResponse({ error: { message: "denied" } }, 500),
		]);
		const client = createGoogleDriveClient(provider, { fetchFn });
		try {
			await client.getFileMetadata("file-1" as DriveFileId);
			throw new Error("expected to throw");
		} catch (error) {
			expect(
				JSON.stringify({ m: String(error), s: (error as Error).stack }),
			).not.toContain(SECRET_TOKEN);
		}
	});
});
