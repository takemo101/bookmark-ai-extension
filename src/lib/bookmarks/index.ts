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
	ASK_AI_MATCHED_FIELDS,
	type AskAiCandidate,
	type AskAiCandidateSearchOptions,
	type AskAiCandidateSearchResult,
	type AskAiMatchedField,
	DEFAULT_ASK_AI_CANDIDATE_LIMIT,
	DEFAULT_ASK_AI_MIN_QUESTION_LENGTH,
	findAskAiCandidates,
} from "./ask-ai-candidates";
export {
	type AiAnalysis,
	Bookmarks,
	type CollectionError,
	type FilterCriteria,
	recordDomain,
	type UpsertContext,
} from "./collection";
export {
	type JsonlParseResult,
	type JsonlProblem,
	type JsonlProblemKind,
	parseJsonl,
	serializeJsonl,
} from "./jsonl";

export {
	AI_MODEL,
	AI_STATUSES,
	type AiModel,
	type AiStatus,
	type BookmarkRecord,
	type BookmarkRecordV1,
	CURRENT_SCHEMA_VERSION,
	createBookmarkRecord,
	type NewBookmarkInput,
	parseBookmarkRecord,
	type RecordError,
	serializeBookmarkRecord,
} from "./record";
export {
	BookmarkInvariantError,
	type Err,
	err,
	type Ok,
	ok,
	type Result,
} from "./result";
export {
	createTombstone,
	isTombstoneShape,
	parseTombstone,
	serializeTombstone,
	TOMBSTONE_KIND,
	type Tombstone,
	type TombstoneV1,
} from "./tombstone";
export {
	canonicalizeUrl,
	parseBookmarkUrl,
	parseCanonicalUrl,
	type UrlError,
} from "./url";
export {
	type BookmarkId,
	type BookmarkUrl,
	bookmarkId,
	type CanonicalUrl,
	compareIsoTimestamp,
	type Genre,
	genre,
	type IsoTimestamp,
	isoTimestamp,
	isoTimestampFromDate,
	maxIsoTimestamp,
	minIsoTimestamp,
	parseBookmarkId,
	parseGenre,
	parseIsoTimestamp,
	parseTag,
	parseTags,
	type Tag,
	tag,
	type ValueError,
} from "./values";
