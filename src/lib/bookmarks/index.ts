/**
 * `bookmarks/*` boundary.
 *
 * Owns the bookmark domain: branded values, JSONL schema, parse/serialize, URL
 * canonicalization, the first-class bookmark collection (upsert, delete, merge,
 * search, filter, sort), and AI-status transitions. Pure logic — no Chrome,
 * Drive, or Prompt API I/O. See docs/design.md and
 * docs/implementation-principles.md.
 */
export {
	type Result,
	type Ok,
	type Err,
	ok,
	err,
	BookmarkInvariantError,
} from "./result";

export {
	type BookmarkId,
	type BookmarkUrl,
	type CanonicalUrl,
	type IsoTimestamp,
	type Genre,
	type Tag,
	type ValueError,
	parseBookmarkId,
	bookmarkId,
	parseIsoTimestamp,
	isoTimestamp,
	isoTimestampFromDate,
	compareIsoTimestamp,
	maxIsoTimestamp,
	minIsoTimestamp,
	parseGenre,
	genre,
	parseTag,
	tag,
	parseTags,
} from "./values";

export {
	type UrlError,
	parseBookmarkUrl,
	canonicalizeUrl,
	parseCanonicalUrl,
} from "./url";

export {
	type AiStatus,
	type AiModel,
	type BookmarkRecord,
	type BookmarkRecordV1,
	type NewBookmarkInput,
	type RecordError,
	AI_STATUSES,
	AI_MODEL,
	CURRENT_SCHEMA_VERSION,
	parseBookmarkRecord,
	serializeBookmarkRecord,
	createBookmarkRecord,
} from "./record";

export {
	type Tombstone,
	type TombstoneV1,
	TOMBSTONE_KIND,
	isTombstoneShape,
	parseTombstone,
	serializeTombstone,
	createTombstone,
} from "./tombstone";

export {
	type JsonlProblem,
	type JsonlProblemKind,
	type JsonlParseResult,
	parseJsonl,
	serializeJsonl,
} from "./jsonl";

export {
	type AiAnalysis,
	type CollectionError,
	type FilterCriteria,
	type UpsertContext,
	Bookmarks,
} from "./collection";
