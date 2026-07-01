/**
 * Branded domain primitives for bookmarks.
 *
 * High-risk values (ids, URLs, timestamps, genres, tags) are wrapped so they
 * cannot be mixed up by accident and so their invariants are enforced once, at
 * construction. See docs/implementation-principles.md "Primitive wrapping
 * policy".
 *
 * Each value has two entry points:
 *   - `parseX`  — boundary parser returning a {@link Result}; use on untrusted
 *                 external data.
 *   - `x()`     — asserting constructor that throws {@link BookmarkInvariantError}
 *                 on invalid input; use internally where the value is already
 *                 known to be valid.
 *
 * URL primitives (`BookmarkUrl`, `CanonicalUrl`) live here as types but their
 * parsing rules live in ./url.ts to keep normalization logic in one place.
 */
import { BookmarkInvariantError, type Result, err, ok } from "./result";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type BookmarkId = Brand<string, "BookmarkId">;
export type BookmarkUrl = Brand<string, "BookmarkUrl">;
export type CanonicalUrl = Brand<string, "CanonicalUrl">;
export type IsoTimestamp = Brand<string, "IsoTimestamp">;
export type Genre = Brand<string, "Genre">;
export type Tag = Brand<string, "Tag">;

export type ValueError = { readonly field: string; readonly message: string };

function valueError(field: string, message: string): ValueError {
	return { field, message };
}

// --- BookmarkId -----------------------------------------------------------

export function parseBookmarkId(
	value: unknown,
): Result<BookmarkId, ValueError> {
	if (typeof value !== "string") {
		return err(valueError("id", "id must be a string"));
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return err(valueError("id", "id must not be empty"));
	}
	return ok(trimmed as BookmarkId);
}

export function bookmarkId(value: string): BookmarkId {
	const parsed = parseBookmarkId(value);
	if (!parsed.ok) {
		throw new BookmarkInvariantError(parsed.error.message);
	}
	return parsed.value;
}

// --- IsoTimestamp ---------------------------------------------------------

const ISO_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function parseIsoTimestamp(
	value: unknown,
): Result<IsoTimestamp, ValueError> {
	if (typeof value !== "string") {
		return err(valueError("timestamp", "timestamp must be a string"));
	}
	if (!ISO_TIMESTAMP_PATTERN.test(value)) {
		return err(valueError("timestamp", `not an ISO-8601 timestamp: ${value}`));
	}
	if (Number.isNaN(Date.parse(value))) {
		return err(valueError("timestamp", `not a valid date: ${value}`));
	}
	return ok(value as IsoTimestamp);
}

export function isoTimestamp(value: string): IsoTimestamp {
	const parsed = parseIsoTimestamp(value);
	if (!parsed.ok) {
		throw new BookmarkInvariantError(parsed.error.message);
	}
	return parsed.value;
}

export function isoTimestampFromDate(date: Date): IsoTimestamp {
	if (Number.isNaN(date.getTime())) {
		throw new BookmarkInvariantError(
			"cannot build a timestamp from Invalid Date",
		);
	}
	return date.toISOString() as IsoTimestamp;
}

/** Numeric comparison usable with Array.prototype.sort. */
export function compareIsoTimestamp(a: IsoTimestamp, b: IsoTimestamp): number {
	return Date.parse(a) - Date.parse(b);
}

export function maxIsoTimestamp(
	a: IsoTimestamp,
	b: IsoTimestamp,
): IsoTimestamp {
	return compareIsoTimestamp(a, b) >= 0 ? a : b;
}

export function minIsoTimestamp(
	a: IsoTimestamp,
	b: IsoTimestamp,
): IsoTimestamp {
	return compareIsoTimestamp(a, b) <= 0 ? a : b;
}

// --- Genre ----------------------------------------------------------------

export function parseGenre(value: unknown): Result<Genre, ValueError> {
	if (typeof value !== "string") {
		return err(valueError("genre", "genre must be a string"));
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return err(valueError("genre", "genre must not be empty"));
	}
	return ok(trimmed as Genre);
}

export function genre(value: string): Genre {
	const parsed = parseGenre(value);
	if (!parsed.ok) {
		throw new BookmarkInvariantError(parsed.error.message);
	}
	return parsed.value;
}

// --- Tag ------------------------------------------------------------------

export function parseTag(value: unknown): Result<Tag, ValueError> {
	if (typeof value !== "string") {
		return err(valueError("tag", "tag must be a string"));
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return err(valueError("tag", "tag must not be empty"));
	}
	return ok(trimmed as Tag);
}

export function tag(value: string): Tag {
	const parsed = parseTag(value);
	if (!parsed.ok) {
		throw new BookmarkInvariantError(parsed.error.message);
	}
	return parsed.value;
}

/**
 * Parse a list of raw tag values: trims each, drops blanks, removes
 * case-insensitive duplicates while preserving first-seen order. Non-string
 * entries are a reported error rather than silently dropped.
 */
export function parseTags(value: unknown): Result<Tag[], ValueError> {
	if (value === undefined) {
		return ok([]);
	}
	if (!Array.isArray(value)) {
		return err(valueError("tags", "tags must be an array"));
	}
	const seen = new Set<string>();
	const tags: Tag[] = [];
	for (const raw of value) {
		const parsed = parseTag(raw);
		if (!parsed.ok) {
			// A non-string entry is a malformed record, not a blank to skip.
			if (typeof raw !== "string") {
				return err(parsed.error);
			}
			continue;
		}
		const key = parsed.value.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		tags.push(parsed.value);
	}
	return ok(tags);
}
