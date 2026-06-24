/**
 * Bookmark record types, smart constructor, parser, and serializer.
 *
 * Two shapes exist on purpose:
 *   - {@link BookmarkRecordV1} is the on-the-wire JSONL shape: plain JSON with
 *     primitive strings. It is what we read from / write to Drive.
 *   - {@link BookmarkRecord} is the always-valid in-memory domain value with
 *     branded primitives. It can only be produced through {@link parseBookmarkRecord}
 *     or {@link createBookmarkRecord}, so invalid external data never leaks
 *     inward. See docs/implementation-principles.md "Always-valid bookmark
 *     records".
 *
 * Raw page excerpts are deliberately absent from both shapes. The parser keeps
 * only known fields, so an excerpt present in external JSON is dropped and can
 * never be stored.
 */
import { canonicalizeUrl, parseBookmarkUrl, parseCanonicalUrl } from "./url";
import { type Result, err, ok } from "./result";
import {
	type BookmarkId,
	type BookmarkUrl,
	type CanonicalUrl,
	type Genre,
	type IsoTimestamp,
	type Tag,
	compareIsoTimestamp,
	parseBookmarkId,
	parseGenre,
	parseIsoTimestamp,
	parseTags,
} from "./values";

export const AI_STATUSES = [
	"pending",
	"ready",
	"unavailable",
	"failed",
] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const AI_MODEL = "chrome-prompt-api";
export type AiModel = typeof AI_MODEL;

export const CURRENT_SCHEMA_VERSION = 1;

/** Serialized (JSONL) shape. Plain JSON, no brands. */
export type BookmarkRecordV1 = {
	schemaVersion: 1;
	id: string;
	canonicalUrl: string;
	url: string;
	title: string;
	description?: string;
	genre?: string;
	tags: string[];
	aiStatus: AiStatus;
	aiModel?: AiModel;
	aiError?: string;
	createdAt: string;
	updatedAt: string;
	lastAnalyzedAt?: string;
};

/** Always-valid in-memory domain value. */
export type BookmarkRecord = {
	readonly schemaVersion: 1;
	readonly id: BookmarkId;
	readonly canonicalUrl: CanonicalUrl;
	readonly url: BookmarkUrl;
	readonly title: string;
	readonly description?: string;
	readonly genre?: Genre;
	readonly tags: readonly Tag[];
	readonly aiStatus: AiStatus;
	readonly aiModel?: AiModel;
	readonly aiError?: string;
	readonly createdAt: IsoTimestamp;
	readonly updatedAt: IsoTimestamp;
	readonly lastAnalyzedAt?: IsoTimestamp;
};

export type RecordError = { readonly field: string; readonly message: string };

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAiStatus(value: unknown): value is AiStatus {
	return (
		typeof value === "string" && (AI_STATUSES as readonly string[]).includes(value)
	);
}

function fieldError(field: string, message: string): RecordError {
	return { field, message };
}

/**
 * Parse arbitrary external data (one decoded JSONL object) into an always-valid
 * {@link BookmarkRecord}. Unknown fields, including any `excerpt`, are dropped.
 */
export function parseBookmarkRecord(
	value: unknown,
): Result<BookmarkRecord, RecordError> {
	if (!isObject(value)) {
		return err(fieldError("record", "record must be a JSON object"));
	}

	if (value.schemaVersion !== CURRENT_SCHEMA_VERSION) {
		return err(
			fieldError(
				"schemaVersion",
				`unsupported schemaVersion: ${JSON.stringify(value.schemaVersion)}`,
			),
		);
	}

	const id = parseBookmarkId(value.id);
	if (!id.ok) {
		return err(id.error);
	}

	const url = parseBookmarkUrl(value.url);
	if (!url.ok) {
		return err(url.error);
	}

	// Trust a stored canonicalUrl if valid; otherwise derive it from `url`.
	let canonicalUrl: CanonicalUrl;
	if (value.canonicalUrl === undefined) {
		const derived = canonicalizeUrl(value.url);
		if (!derived.ok) {
			return err(derived.error);
		}
		canonicalUrl = derived.value;
	} else {
		const parsed = parseCanonicalUrl(value.canonicalUrl);
		if (!parsed.ok) {
			return err(parsed.error);
		}
		canonicalUrl = parsed.value;
	}

	if (typeof value.title !== "string") {
		return err(fieldError("title", "title must be a string"));
	}
	const title = value.title.trim().length > 0 ? value.title.trim() : url.value;

	if (value.description !== undefined && typeof value.description !== "string") {
		return err(fieldError("description", "description must be a string"));
	}
	const description =
		typeof value.description === "string" && value.description.trim().length > 0
			? value.description.trim()
			: undefined;

	let genre: Genre | undefined;
	if (value.genre !== undefined) {
		const parsed = parseGenre(value.genre);
		if (!parsed.ok) {
			return err(parsed.error);
		}
		genre = parsed.value;
	}

	const tags = parseTags(value.tags);
	if (!tags.ok) {
		return err(tags.error);
	}

	if (!isAiStatus(value.aiStatus)) {
		return err(
			fieldError("aiStatus", `unknown aiStatus: ${JSON.stringify(value.aiStatus)}`),
		);
	}

	if (value.aiModel !== undefined && value.aiModel !== AI_MODEL) {
		return err(
			fieldError("aiModel", `unknown aiModel: ${JSON.stringify(value.aiModel)}`),
		);
	}

	if (value.aiError !== undefined && typeof value.aiError !== "string") {
		return err(fieldError("aiError", "aiError must be a string"));
	}

	const createdAt = parseIsoTimestamp(value.createdAt);
	if (!createdAt.ok) {
		return err(fieldError("createdAt", createdAt.error.message));
	}

	const updatedAt = parseIsoTimestamp(value.updatedAt);
	if (!updatedAt.ok) {
		return err(fieldError("updatedAt", updatedAt.error.message));
	}

	if (compareIsoTimestamp(updatedAt.value, createdAt.value) < 0) {
		return err(
			fieldError("updatedAt", "updatedAt must not be earlier than createdAt"),
		);
	}

	let lastAnalyzedAt: IsoTimestamp | undefined;
	if (value.lastAnalyzedAt !== undefined) {
		const parsed = parseIsoTimestamp(value.lastAnalyzedAt);
		if (!parsed.ok) {
			return err(fieldError("lastAnalyzedAt", parsed.error.message));
		}
		lastAnalyzedAt = parsed.value;
	}

	return ok({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: id.value,
		canonicalUrl,
		url: url.value,
		title,
		description,
		genre,
		tags: tags.value,
		aiStatus: value.aiStatus,
		aiModel: value.aiModel,
		aiError: value.aiError,
		createdAt: createdAt.value,
		updatedAt: updatedAt.value,
		lastAnalyzedAt,
	});
}

/** Serialize a domain record back into its plain JSONL shape. */
export function serializeBookmarkRecord(
	record: BookmarkRecord,
): BookmarkRecordV1 {
	const serialized: BookmarkRecordV1 = {
		schemaVersion: record.schemaVersion,
		id: record.id,
		canonicalUrl: record.canonicalUrl,
		url: record.url,
		title: record.title,
		tags: [...record.tags],
		aiStatus: record.aiStatus,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
	if (record.description !== undefined) serialized.description = record.description;
	if (record.genre !== undefined) serialized.genre = record.genre;
	if (record.aiModel !== undefined) serialized.aiModel = record.aiModel;
	if (record.aiError !== undefined) serialized.aiError = record.aiError;
	if (record.lastAnalyzedAt !== undefined)
		serialized.lastAnalyzedAt = record.lastAnalyzedAt;
	return serialized;
}

/**
 * Input accepted by the smart constructor and by collection upsert. All URL,
 * tag, and status validation happens inside; callers pass raw values.
 */
export type NewBookmarkInput = {
	url: string;
	title?: string;
	description?: string;
	genre?: string;
	tags?: string[];
	aiStatus?: AiStatus;
	aiModel?: AiModel;
	aiError?: string;
	lastAnalyzedAt?: string;
};

/**
 * Build a brand-new always-valid record. `id` and timestamps are injected so
 * the domain stays free of Chrome/clock dependencies. Defaults: title falls
 * back to the URL, tags to empty, aiStatus to `pending`.
 */
export function createBookmarkRecord(
	input: NewBookmarkInput,
	context: { id: BookmarkId; now: IsoTimestamp },
): Result<BookmarkRecord, RecordError> {
	const draft: Record<string, unknown> = {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: context.id,
		url: input.url,
		title: input.title,
		description: input.description,
		genre: input.genre,
		tags: input.tags ?? [],
		aiStatus: input.aiStatus ?? "pending",
		aiModel: input.aiModel,
		aiError: input.aiError,
		createdAt: context.now,
		updatedAt: context.now,
		lastAnalyzedAt: input.lastAnalyzedAt,
	};
	// title is optional on input but required by the parser; fall back to URL.
	if (draft.title === undefined) {
		draft.title = input.url;
	}
	return parseBookmarkRecord(draft);
}
