/**
 * First-class bookmark collection.
 *
 * Owns every list operation — upsert, delete, merge, search, filter, sort — so
 * UI code calls named intents instead of duplicating array reducers (see
 * docs/implementation-principles.md "First-class bookmark collection" and
 * "Tell, don't ask"). Instances are immutable: every mutating operation returns
 * a new {@link Bookmarks}.
 *
 * The collection is pure: it never reads a clock or generates an id. Callers
 * inject `now` (and `id` for new records) so behavior stays deterministic and
 * testable without Chrome.
 */
import { type Result, err, ok } from "./result";
import {
	type BookmarkRecord,
	type NewBookmarkInput,
	type RecordError,
	createBookmarkRecord,
} from "./record";
import { type Tombstone, createTombstone } from "./tombstone";
import { canonicalizeUrl, type UrlError } from "./url";
import {
	type BookmarkId,
	type CanonicalUrl,
	type Genre,
	type IsoTimestamp,
	type Tag,
	compareIsoTimestamp,
	maxIsoTimestamp,
	minIsoTimestamp,
} from "./values";

export type UpsertContext = { id: BookmarkId; now: IsoTimestamp };

export type AiAnalysis = {
	description?: string;
	genre?: string;
	tags?: string[];
	analysisMarkdown?: string;
	analysisProfileId?: string;
};

export type CollectionError =
	| RecordError
	| UrlError
	| { readonly field: "canonicalUrl"; readonly message: string };

/** Default ordering: most recently updated first, fully deterministic. */
function byRecency(a: BookmarkRecord, b: BookmarkRecord): number {
	const updated = compareIsoTimestamp(b.updatedAt, a.updatedAt);
	if (updated !== 0) return updated;
	const created = compareIsoTimestamp(b.createdAt, a.createdAt);
	if (created !== 0) return created;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byOldestCreated(a: BookmarkRecord, b: BookmarkRecord): number {
	const created = compareIsoTimestamp(a.createdAt, b.createdAt);
	if (created !== 0) return created;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Deterministic, locale-independent ordering for facet values. */
function compareString(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function matchesQuery(record: BookmarkRecord, needle: string): boolean {
	const haystacks = [
		record.title,
		record.url,
		record.description ?? "",
		record.genre ?? "",
		record.analysisMarkdown ?? "",
		...record.tags,
	];
	return haystacks.some((field) => field.toLowerCase().includes(needle));
}

export type FilterCriteria = {
	query?: string;
	genre?: string;
	tag?: string;
	aiStatus?: BookmarkRecord["aiStatus"];
};

export class Bookmarks {
	// Keyed by canonical URL, the upsert/merge identity. A URL is either live (in
	// `byUrl`) or deleted (in `tombstoneByUrl`), never both — the constructors and
	// merge keep the two maps disjoint by URL.
	private readonly byUrl: ReadonlyMap<CanonicalUrl, BookmarkRecord>;
	private readonly tombstoneByUrl: ReadonlyMap<CanonicalUrl, Tombstone>;

	private constructor(
		byUrl: ReadonlyMap<CanonicalUrl, BookmarkRecord>,
		tombstoneByUrl: ReadonlyMap<CanonicalUrl, Tombstone> = new Map(),
	) {
		this.byUrl = byUrl;
		this.tombstoneByUrl = tombstoneByUrl;
	}

	static empty(): Bookmarks {
		return new Bookmarks(new Map(), new Map());
	}

	/**
	 * Build from already-valid records and (optionally) deletion tombstones. Later
	 * records win when two share a canonical URL, so callers control precedence by
	 * ordering. When a URL has both a record and a tombstone, the documented
	 * delete-vs-update rule (see {@link mergeRemote}) decides which survives, so
	 * the result keeps the live and deleted sets disjoint.
	 */
	static from(
		records: Iterable<BookmarkRecord>,
		tombstones: Iterable<Tombstone> = [],
	): Bookmarks {
		const recordByUrl = new Map<CanonicalUrl, BookmarkRecord>();
		for (const record of records) {
			recordByUrl.set(record.canonicalUrl, record);
		}
		const tombstoneByUrl = new Map<CanonicalUrl, Tombstone>();
		for (const tombstone of tombstones) {
			const prev = tombstoneByUrl.get(tombstone.canonicalUrl);
			if (
				prev === undefined ||
				compareIsoTimestamp(tombstone.deletedAt, prev.deletedAt) >= 0
			) {
				tombstoneByUrl.set(tombstone.canonicalUrl, tombstone);
			}
		}

		const byUrl = new Map<CanonicalUrl, BookmarkRecord>();
		const liveTombstones = new Map<CanonicalUrl, Tombstone>();
		for (const [url, record] of recordByUrl) {
			const tombstone = tombstoneByUrl.get(url);
			if (tombstone === undefined) {
				byUrl.set(url, record);
				continue;
			}
			const winner = resolveRecordVsTombstone(record, tombstone);
			if (isTombstone(winner)) {
				liveTombstones.set(url, winner);
			} else {
				byUrl.set(url, winner);
			}
		}
		for (const [url, tombstone] of tombstoneByUrl) {
			if (!recordByUrl.has(url)) {
				liveTombstones.set(url, tombstone);
			}
		}
		return new Bookmarks(byUrl, liveTombstones);
	}

	get size(): number {
		return this.byUrl.size;
	}

	get(canonicalUrl: CanonicalUrl): BookmarkRecord | undefined {
		return this.byUrl.get(canonicalUrl);
	}

	/** All records, most-recently-updated first. Tombstones are not records. */
	toArray(): BookmarkRecord[] {
		return [...this.byUrl.values()].sort(byRecency);
	}

	/**
	 * Active deletion tombstones, deterministically ordered, for serialization to
	 * Drive/cache. They are not part of {@link toArray}/{@link size}; only the
	 * persistence and merge layers need them.
	 */
	tombstones(): Tombstone[] {
		return [...this.tombstoneByUrl.values()].sort((a, b) => {
			if (a.canonicalUrl !== b.canonicalUrl) {
				return a.canonicalUrl < b.canonicalUrl ? -1 : 1;
			}
			return compareIsoTimestamp(a.deletedAt, b.deletedAt);
		});
	}

	/** The single entry a URL resolves to: a live record, a tombstone, or nothing. */
	private entryFor(canonicalUrl: CanonicalUrl): Entry | undefined {
		return (
			this.byUrl.get(canonicalUrl) ?? this.tombstoneByUrl.get(canonicalUrl)
		);
	}

	private with(record: BookmarkRecord): Bookmarks {
		const next = new Map(this.byUrl);
		next.set(record.canonicalUrl, record);
		// Writing a live record supersedes any local tombstone for the same URL
		// (e.g. re-saving a page that was previously deleted on this device).
		if (!this.tombstoneByUrl.has(record.canonicalUrl)) {
			return new Bookmarks(next, this.tombstoneByUrl);
		}
		const nextTombstones = new Map(this.tombstoneByUrl);
		nextTombstones.delete(record.canonicalUrl);
		return new Bookmarks(next, nextTombstones);
	}

	/**
	 * Save a tab. New canonical URL → create. Existing canonical URL → update
	 * in place, preserving `createdAt` and bumping `updatedAt` to `now`. Only
	 * fields present on the input replace existing values.
	 */
	upsert(
		input: NewBookmarkInput,
		context: UpsertContext,
	): Result<Bookmarks, CollectionError> {
		const canonical = canonicalizeUrl(input.url);
		if (!canonical.ok) {
			return canonical;
		}
		const existing = this.byUrl.get(canonical.value);
		if (!existing) {
			const created = createBookmarkRecord(input, context);
			if (!created.ok) {
				return created;
			}
			return ok(this.with(created.value));
		}

		// Re-parse a merged draft so the updated record stays always-valid.
		// Preserve timestamp monotonicity even if a test/fake clock moves backward.
		const updatedAt = maxIsoTimestamp(existing.updatedAt, context.now);
		const merged = createBookmarkRecord(
			{
				url: input.url,
				title: input.title ?? existing.title,
				description: input.description ?? existing.description,
				genre: input.genre ?? existing.genre,
				tags: input.tags ?? [...existing.tags],
				aiStatus: input.aiStatus ?? existing.aiStatus,
				aiModel: input.aiModel ?? existing.aiModel,
				aiError: input.aiError ?? existing.aiError,
				lastAnalyzedAt: input.lastAnalyzedAt ?? existing.lastAnalyzedAt,
				analysisMarkdown: input.analysisMarkdown ?? existing.analysisMarkdown,
				analysisProfileId:
					input.analysisProfileId ?? existing.analysisProfileId,
			},
			{ id: existing.id, now: updatedAt },
		);
		if (!merged.ok) {
			return merged;
		}
		return ok(
			this.with({
				...merged.value,
				createdAt: existing.createdAt,
				canonicalUrl: existing.canonicalUrl,
			}),
		);
	}

	/** Apply AI analysis results and move the record to `ready`. */
	applyAiAnalysis(
		canonicalUrl: CanonicalUrl,
		analysis: AiAnalysis,
		now: IsoTimestamp,
	): Result<Bookmarks, CollectionError> {
		const existing = this.byUrl.get(canonicalUrl);
		if (!existing) {
			return err({
				field: "canonicalUrl",
				message: "no record for canonical URL",
			});
		}
		const updatedAt = maxIsoTimestamp(existing.updatedAt, now);
		const updated = createBookmarkRecord(
			{
				url: existing.url,
				title: existing.title,
				description: analysis.description ?? existing.description,
				genre: analysis.genre ?? existing.genre,
				tags: analysis.tags ?? [...existing.tags],
				aiStatus: "ready",
				aiModel: "chrome-prompt-api",
				aiError: undefined,
				lastAnalyzedAt: updatedAt,
				analysisMarkdown:
					analysis.analysisMarkdown ?? existing.analysisMarkdown,
				analysisProfileId:
					analysis.analysisProfileId ?? existing.analysisProfileId,
			},
			{ id: existing.id, now: updatedAt },
		);
		if (!updated.ok) {
			return updated;
		}
		return ok(
			this.with({
				...updated.value,
				createdAt: existing.createdAt,
				canonicalUrl: existing.canonicalUrl,
			}),
		);
	}

	private transition(
		canonicalUrl: CanonicalUrl,
		aiStatus: BookmarkRecord["aiStatus"],
		now: IsoTimestamp,
		aiError?: string,
	): Result<Bookmarks, CollectionError> {
		const existing = this.byUrl.get(canonicalUrl);
		if (!existing) {
			return err({
				field: "canonicalUrl",
				message: "no record for canonical URL",
			});
		}
		return ok(
			this.with({
				...existing,
				aiStatus,
				aiError,
				updatedAt: maxIsoTimestamp(existing.updatedAt, now),
			}),
		);
	}

	markAiPending(
		canonicalUrl: CanonicalUrl,
		now: IsoTimestamp,
	): Result<Bookmarks, CollectionError> {
		return this.transition(canonicalUrl, "pending", now);
	}

	markAiUnavailable(
		canonicalUrl: CanonicalUrl,
		now: IsoTimestamp,
	): Result<Bookmarks, CollectionError> {
		return this.transition(canonicalUrl, "unavailable", now);
	}

	markAiFailed(
		canonicalUrl: CanonicalUrl,
		reason: string,
		now: IsoTimestamp,
	): Result<Bookmarks, CollectionError> {
		return this.transition(canonicalUrl, "failed", now, reason);
	}

	/**
	 * Delete by canonical URL, leaving a tombstone stamped `now` so the deletion
	 * propagates through {@link mergeRemote} instead of being undone by it. A URL
	 * we have never seen (no live record, no existing tombstone) is a no-op, as
	 * before. An existing tombstone is refreshed forward, never backward.
	 */
	delete(canonicalUrl: CanonicalUrl, now: IsoTimestamp): Bookmarks {
		const existingTombstone = this.tombstoneByUrl.get(canonicalUrl);
		if (!this.byUrl.has(canonicalUrl) && existingTombstone === undefined) {
			return this;
		}
		const deletedAt =
			existingTombstone === undefined
				? now
				: maxIsoTimestamp(existingTombstone.deletedAt, now);
		const next = new Map(this.byUrl);
		next.delete(canonicalUrl);
		const nextTombstones = new Map(this.tombstoneByUrl);
		nextTombstones.set(canonicalUrl, createTombstone(canonicalUrl, deletedAt));
		return new Bookmarks(next, nextTombstones);
	}

	deleteById(id: BookmarkId, now: IsoTimestamp): Bookmarks {
		for (const record of this.byUrl.values()) {
			if (record.id === id) {
				return this.delete(record.canonicalUrl, now);
			}
		}
		return this;
	}

	/**
	 * Merge remote into this set by canonical URL, resolving record/record,
	 * tombstone/tombstone, and the delete-vs-update conflict (revision-conflict
	 * resolution). The result is independent of argument order except for the
	 * deterministic id tie-break.
	 *
	 * Rules (docs/design.md "Drive Write and Conflict Strategy"):
	 *   - record vs record  → latest `updatedAt` wins fields, earliest `createdAt`
	 *                          is preserved, ties break by id;
	 *   - tombstone vs tombstone → the later `deletedAt` survives;
	 *   - record vs tombstone → the tombstone wins unless the record's `updatedAt`
	 *                          is strictly newer than the tombstone's `deletedAt`
	 *                          (a newer explicit update intentionally resurrects).
	 *                          A tie favors the deletion, so a delete is durable.
	 */
	mergeRemote(remote: Bookmarks): Bookmarks {
		const urls = new Set<CanonicalUrl>([
			...this.byUrl.keys(),
			...this.tombstoneByUrl.keys(),
			...remote.byUrl.keys(),
			...remote.tombstoneByUrl.keys(),
		]);
		const nextRecords = new Map<CanonicalUrl, BookmarkRecord>();
		const nextTombstones = new Map<CanonicalUrl, Tombstone>();
		for (const url of urls) {
			const winner = resolveEntry(this.entryFor(url), remote.entryFor(url));
			if (winner === undefined) {
				continue;
			}
			if (isTombstone(winner)) {
				nextTombstones.set(url, winner);
			} else {
				nextRecords.set(url, winner);
			}
		}
		return new Bookmarks(nextRecords, nextTombstones);
	}

	/** Case-insensitive substring search over title/url/description/genre/tags. */
	search(query: string): BookmarkRecord[] {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) {
			return this.toArray();
		}
		return this.toArray().filter((record) => matchesQuery(record, needle));
	}

	/** Combined filter; omitted criteria are ignored. */
	filter(criteria: FilterCriteria): BookmarkRecord[] {
		const needle = criteria.query?.trim().toLowerCase() ?? "";
		const genreNeedle = criteria.genre?.trim().toLowerCase();
		const tagNeedle = criteria.tag?.trim().toLowerCase();
		return this.toArray().filter((record) => {
			if (needle.length > 0 && !matchesQuery(record, needle)) return false;
			if (
				genreNeedle !== undefined &&
				(record.genre ?? "").toLowerCase() !== genreNeedle
			) {
				return false;
			}
			if (
				tagNeedle !== undefined &&
				!record.tags.some((t) => t.toLowerCase() === tagNeedle)
			) {
				return false;
			}
			if (
				criteria.aiStatus !== undefined &&
				record.aiStatus !== criteria.aiStatus
			) {
				return false;
			}
			return true;
		});
	}

	/**
	 * The distinct genres present, sorted, for building filter facets. Returning
	 * this from the collection keeps facet derivation a list operation here rather
	 * than a reducer duplicated in the options UI (First-class collection).
	 */
	genres(): Genre[] {
		const seen = new Map<string, Genre>();
		for (const record of this.byUrl.values()) {
			if (record.genre !== undefined && !seen.has(record.genre)) {
				seen.set(record.genre, record.genre);
			}
		}
		return [...seen.values()].sort(compareString);
	}

	/** The distinct tags present, sorted, for building filter facets. */
	tags(): Tag[] {
		const seen = new Map<string, Tag>();
		for (const record of this.byUrl.values()) {
			for (const t of record.tags) {
				if (!seen.has(t)) {
					seen.set(t, t);
				}
			}
		}
		return [...seen.values()].sort(compareString);
	}

	filterByGenre(genre: Genre | string): BookmarkRecord[] {
		return this.filter({ genre });
	}

	filterByTag(tag: Tag | string): BookmarkRecord[] {
		return this.filter({ tag });
	}

	filterByAiStatus(aiStatus: BookmarkRecord["aiStatus"]): BookmarkRecord[] {
		return this.filter({ aiStatus });
	}

	sortedByUpdated(direction: "asc" | "desc" = "desc"): BookmarkRecord[] {
		const sorted = this.toArray();
		return direction === "desc" ? sorted : sorted.reverse();
	}

	sortedByCreated(direction: "asc" | "desc" = "desc"): BookmarkRecord[] {
		const sorted = [...this.byUrl.values()].sort(byOldestCreated);
		return direction === "asc" ? sorted : sorted.reverse();
	}
}

/** What a canonical URL resolves to inside the collection. */
type Entry = BookmarkRecord | Tombstone;

function isTombstone(entry: Entry): entry is Tombstone {
	return (entry as Tombstone).kind === "tombstone";
}

/**
 * Resolve the entry for one canonical URL across the two sides of a merge. Each
 * side contributes at most one entry (the collection keeps live and deleted
 * disjoint), so this dispatches on the four combinations.
 */
function resolveEntry(left?: Entry, right?: Entry): Entry | undefined {
	if (left === undefined) return right;
	if (right === undefined) return left;
	const leftIsTombstone = isTombstone(left);
	const rightIsTombstone = isTombstone(right);
	if (leftIsTombstone && rightIsTombstone) {
		return compareIsoTimestamp(left.deletedAt, right.deletedAt) >= 0
			? left
			: right;
	}
	if (!leftIsTombstone && !rightIsTombstone) {
		return resolveConflict(left, right);
	}
	const tombstone = leftIsTombstone
		? (left as Tombstone)
		: (right as Tombstone);
	const record = leftIsTombstone
		? (right as BookmarkRecord)
		: (left as BookmarkRecord);
	return resolveRecordVsTombstone(record, tombstone);
}

/**
 * Delete vs update: the record survives only if its `updatedAt` is strictly
 * newer than the tombstone's `deletedAt`; otherwise the deletion stands (a tie
 * keeps the delete durable).
 */
function resolveRecordVsTombstone(
	record: BookmarkRecord,
	tombstone: Tombstone,
): Entry {
	return compareIsoTimestamp(record.updatedAt, tombstone.deletedAt) > 0
		? record
		: tombstone;
}

function resolveConflict(
	local: BookmarkRecord,
	remote: BookmarkRecord,
): BookmarkRecord {
	const updatedCmp = compareIsoTimestamp(local.updatedAt, remote.updatedAt);
	let winner: BookmarkRecord;
	if (updatedCmp > 0) {
		winner = local;
	} else if (updatedCmp < 0) {
		winner = remote;
	} else {
		// Deterministic tie-break independent of which side is "local".
		winner = local.id <= remote.id ? local : remote;
	}
	return {
		...winner,
		createdAt: minIsoTimestamp(local.createdAt, remote.createdAt),
		updatedAt: maxIsoTimestamp(local.updatedAt, remote.updatedAt),
	};
}
