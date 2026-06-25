/**
 * Deletion tombstones.
 *
 * A tombstone marks a canonical URL as deleted at a point in time so the
 * deletion can survive a merge. Without it, the union merge in
 * {@link Bookmarks.mergeRemote} re-adds any record that still exists on another
 * device — the "delete resurrection" bug (docs/design.md "Drive Write and
 * Conflict Strategy"). On merge a tombstone competes with a live record by
 * timestamp: the documented delete-vs-update rule lives in
 * {@link Bookmarks.mergeRemote}.
 *
 * Two shapes mirror {@link BookmarkRecord}:
 *   - {@link TombstoneV1} is the on-the-wire JSONL/cache shape (plain JSON,
 *     discriminated from a live record by `kind: "tombstone"`).
 *   - {@link Tombstone} is the always-valid in-memory value with branded
 *     primitives, producible only through {@link parseTombstone} or
 *     {@link createTombstone}, so invalid external data never leaks inward
 *     (docs/implementation-principles.md "Parse, don't validate").
 */
import { CURRENT_SCHEMA_VERSION, type RecordError } from "./record";
import { type Result, err, ok } from "./result";
import { parseCanonicalUrl } from "./url";
import {
	type CanonicalUrl,
	type IsoTimestamp,
	parseIsoTimestamp,
} from "./values";

/** Discriminator written on a tombstone line; absent on live record lines. */
export const TOMBSTONE_KIND = "tombstone";

/** Serialized (JSONL / cache) tombstone shape. Plain JSON, no brands. */
export type TombstoneV1 = {
	schemaVersion: 1;
	kind: typeof TOMBSTONE_KIND;
	canonicalUrl: string;
	deletedAt: string;
};

/** Always-valid in-memory tombstone keyed, like a record, by canonical URL. */
export type Tombstone = {
	readonly kind: typeof TOMBSTONE_KIND;
	readonly canonicalUrl: CanonicalUrl;
	readonly deletedAt: IsoTimestamp;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldError(field: string, message: string): RecordError {
	return { field, message };
}

/**
 * Whether a decoded JSONL/cache object claims to be a tombstone. Used by the
 * parsers to route a line to {@link parseTombstone} rather than to the live
 * record parser, which would (correctly) reject a tombstone for missing fields.
 */
export function isTombstoneShape(value: unknown): boolean {
	return isObject(value) && value.kind === TOMBSTONE_KIND;
}

/** Parse arbitrary external data into an always-valid {@link Tombstone}. */
export function parseTombstone(value: unknown): Result<Tombstone, RecordError> {
	if (!isObject(value)) {
		return err(fieldError("record", "tombstone must be a JSON object"));
	}
	if (value.schemaVersion !== CURRENT_SCHEMA_VERSION) {
		return err(
			fieldError(
				"schemaVersion",
				`unsupported schemaVersion: ${JSON.stringify(value.schemaVersion)}`,
			),
		);
	}
	if (value.kind !== TOMBSTONE_KIND) {
		return err(fieldError("kind", `not a tombstone: ${JSON.stringify(value.kind)}`));
	}
	const canonicalUrl = parseCanonicalUrl(value.canonicalUrl);
	if (!canonicalUrl.ok) {
		return err(canonicalUrl.error);
	}
	const deletedAt = parseIsoTimestamp(value.deletedAt);
	if (!deletedAt.ok) {
		return err(fieldError("deletedAt", deletedAt.error.message));
	}
	return ok({
		kind: TOMBSTONE_KIND,
		canonicalUrl: canonicalUrl.value,
		deletedAt: deletedAt.value,
	});
}

/** Serialize a domain tombstone back into its plain JSONL/cache shape. */
export function serializeTombstone(tombstone: Tombstone): TombstoneV1 {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		kind: TOMBSTONE_KIND,
		canonicalUrl: tombstone.canonicalUrl,
		deletedAt: tombstone.deletedAt,
	};
}

/** Build a tombstone from already-valid branded values. */
export function createTombstone(
	canonicalUrl: CanonicalUrl,
	deletedAt: IsoTimestamp,
): Tombstone {
	return { kind: TOMBSTONE_KIND, canonicalUrl, deletedAt };
}
