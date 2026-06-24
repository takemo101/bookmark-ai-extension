/**
 * Concrete {@link DriveClient} backed by the Google Drive v3 REST API.
 *
 * Every Drive HTTP detail lives here and nowhere else: endpoint URLs, the
 * `drive.file`-scoped query strings, multipart upload framing, the `Bearer`
 * auth header, the 401 → invalidate-and-retry dance, and the mapping of HTTP
 * responses onto typed {@link DriveApiError}s. Raw Google response objects are
 * parsed into branded metadata before leaving this file, so no API shape leaks
 * into the repository or UI (docs/implementation-principles.md "Repository /
 * Drive client rules").
 *
 * The OAuth token is read from the injected {@link TokenProvider} and used only
 * to build the `Authorization` header. It is never logged and never written into
 * an error.
 */
import { DriveApiError, classifyStatus } from "./errors";
import type { DriveClient } from "./drive-client";
import type { TokenProvider } from "./token-provider";
import {
	type DriveDownload,
	type DriveFileId,
	type DriveFileMetadata,
	type DriveFolderId,
	type DriveFolderMetadata,
	type DriveRevision,
	FOLDER_MIME_TYPE,
	JSONL_MIME_TYPE,
} from "./types";

const FILES_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const METADATA_FIELDS = "id,name,headRevisionId,version,modifiedTime";
const MULTIPART_BOUNDARY = "bookmark-ai-boundary";

type RawFile = {
	id?: unknown;
	name?: unknown;
	headRevisionId?: unknown;
	version?: unknown;
	modifiedTime?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Pick the first usable revision marker from a Drive file resource. */
function deriveRevision(raw: RawFile): DriveRevision | null {
	for (const candidate of [raw.headRevisionId, raw.version, raw.modifiedTime]) {
		if (typeof candidate === "string" && candidate.length > 0) {
			return candidate as DriveRevision;
		}
	}
	return null;
}

function parseFolderMetadata(raw: unknown): DriveFolderMetadata {
	if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) {
		throw new DriveApiError(
			"malformed-response",
			"Drive folder response is missing an id",
		);
	}
	return {
		id: raw.id as DriveFolderId,
		name: typeof raw.name === "string" ? raw.name : "",
	};
}

function parseFileMetadata(raw: unknown): DriveFileMetadata {
	if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) {
		throw new DriveApiError(
			"malformed-response",
			"Drive file response is missing an id",
		);
	}
	const revision = deriveRevision(raw);
	if (!revision) {
		throw new DriveApiError(
			"malformed-response",
			"Drive file response is missing a revision marker",
		);
	}
	return {
		id: raw.id as DriveFileId,
		name: typeof raw.name === "string" ? raw.name : "",
		revision,
	};
}

/** Build a typed error from a failed response without leaking sensitive data. */
async function toApiError(response: Response): Promise<DriveApiError> {
	let detail = response.statusText;
	try {
		const body = await response.text();
		if (body.length > 0) {
			try {
				const parsed = JSON.parse(body) as { error?: { message?: string } };
				if (parsed.error?.message) {
					detail = parsed.error.message;
				}
			} catch {
				detail = body.slice(0, 200);
			}
		}
	} catch {
		// Body already consumed or unreadable; fall back to statusText.
	}
	return new DriveApiError(
		classifyStatus(response.status),
		`Drive API request failed (${response.status}): ${detail}`,
		response.status,
	);
}

type SendOptions = {
	body?: BodyInit;
	contentType?: string;
};

export type GoogleDriveClientDeps = {
	/** Defaults to the global `fetch`. */
	fetchFn?: typeof fetch;
};

/**
 * Build a {@link DriveClient} over the Drive REST API, authenticating each
 * request through {@link TokenProvider}. `fetch` is injectable so the adapter
 * can be tested with a fake transport and no real network access.
 */
export function createGoogleDriveClient(
	tokenProvider: TokenProvider,
	deps: GoogleDriveClientDeps = {},
): DriveClient {
	const fetchFn = deps.fetchFn ?? fetch;

	async function fetchOnce(
		method: string,
		url: string,
		token: string,
		options: SendOptions,
	): Promise<Response> {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
		};
		if (options.contentType) {
			headers["Content-Type"] = options.contentType;
		}
		return fetchFn(url, { method, headers, body: options.body });
	}

	/** Auth + one 401 retry with a refreshed token + ok-check. */
	async function send(
		method: string,
		url: string,
		options: SendOptions = {},
	): Promise<Response> {
		let token = await tokenProvider.getToken();
		let response = await fetchOnce(method, url, token, options);
		if (response.status === 401) {
			// The cached token was rejected; drop it and mint a fresh one once.
			await tokenProvider.invalidateToken(token);
			token = await tokenProvider.getToken();
			response = await fetchOnce(method, url, token, options);
		}
		if (!response.ok) {
			throw await toApiError(response);
		}
		return response;
	}

	async function findOne(query: string): Promise<RawFile | null> {
		const url =
			`${FILES_API}?q=${encodeURIComponent(query)}` +
			`&spaces=drive&pageSize=1&fields=${encodeURIComponent(`files(${METADATA_FIELDS})`)}`;
		const response = await send("GET", url);
		const json = (await response.json()) as { files?: unknown };
		if (!Array.isArray(json.files) || json.files.length === 0) {
			return null;
		}
		return json.files[0] as RawFile;
	}

	return {
		async findFolder(name: string): Promise<DriveFolderMetadata | null> {
			const escaped = name.replace(/'/g, "\\'");
			const query = `name = '${escaped}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`;
			const raw = await findOne(query);
			return raw ? parseFolderMetadata(raw) : null;
		},

		async createFolder(name: string): Promise<DriveFolderMetadata> {
			const url = `${FILES_API}?fields=${encodeURIComponent(METADATA_FIELDS)}`;
			const response = await send("POST", url, {
				contentType: "application/json",
				body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE }),
			});
			return parseFolderMetadata(await response.json());
		},

		async findFile(
			name: string,
			parent: DriveFolderId,
		): Promise<DriveFileMetadata | null> {
			const escaped = name.replace(/'/g, "\\'");
			const query = `name = '${escaped}' and '${parent}' in parents and trashed = false`;
			const raw = await findOne(query);
			return raw ? parseFileMetadata(raw) : null;
		},

		async createFile(input: {
			name: string;
			parent: DriveFolderId;
			content: string;
		}): Promise<DriveFileMetadata> {
			const metadata = {
				name: input.name,
				parents: [input.parent],
				mimeType: JSONL_MIME_TYPE,
			};
			const body =
				`--${MULTIPART_BOUNDARY}\r\n` +
				"Content-Type: application/json; charset=UTF-8\r\n\r\n" +
				`${JSON.stringify(metadata)}\r\n` +
				`--${MULTIPART_BOUNDARY}\r\n` +
				`Content-Type: ${JSONL_MIME_TYPE}\r\n\r\n` +
				`${input.content}\r\n` +
				`--${MULTIPART_BOUNDARY}--`;
			const url = `${UPLOAD_API}?uploadType=multipart&fields=${encodeURIComponent(METADATA_FIELDS)}`;
			const response = await send("POST", url, {
				contentType: `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
				body,
			});
			return parseFileMetadata(await response.json());
		},

		async getFileMetadata(fileId: DriveFileId): Promise<DriveFileMetadata> {
			const url = `${FILES_API}/${fileId}?fields=${encodeURIComponent(METADATA_FIELDS)}`;
			const response = await send("GET", url);
			return parseFileMetadata(await response.json());
		},

		async downloadFile(fileId: DriveFileId): Promise<DriveDownload> {
			const contentResponse = await send(
				"GET",
				`${FILES_API}/${fileId}?alt=media`,
			);
			const content = await contentResponse.text();
			const metaResponse = await send(
				"GET",
				`${FILES_API}/${fileId}?fields=${encodeURIComponent(METADATA_FIELDS)}`,
			);
			const metadata = parseFileMetadata(await metaResponse.json());
			return { content, metadata };
		},

		async uploadFile(
			fileId: DriveFileId,
			content: string,
		): Promise<DriveFileMetadata> {
			const url =
				`${UPLOAD_API}/${fileId}?uploadType=media` +
				`&fields=${encodeURIComponent(METADATA_FIELDS)}`;
			const response = await send("PATCH", url, {
				contentType: JSONL_MIME_TYPE,
				body: content,
			});
			return parseFileMetadata(await response.json());
		},
	};
}
