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

function matchesQuery(record: BookmarkRecord, needle: string): boolean {
	const haystacks = [
		record.title,
		record.url,
		record.description ?? "",
		record.genre ?? "",
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
	// Keyed by canonical URL, the upsert/merge identity.
	private readonly byUrl: ReadonlyMap<CanonicalUrl, BookmarkRecord>;

	private constructor(byUrl: ReadonlyMap<CanonicalUrl, BookmarkRecord>) {
		this.byUrl = byUrl;
	}

	static empty(): Bookmarks {
		return new Bookmarks(new Map());
	}

	/**
	 * Build from already-valid records. Later records win when two share a
	 * canonical URL, so callers control precedence by ordering.
	 */
	static from(records: Iterable<BookmarkRecord>): Bookmarks {
		const map = new Map<CanonicalUrl, BookmarkRecord>();
		for (const record of records) {
			map.set(record.canonicalUrl, record);
		}
		return new Bookmarks(map);
	}

	get size(): number {
		return this.byUrl.size;
	}

	get(canonicalUrl: CanonicalUrl): BookmarkRecord | undefined {
		return this.byUrl.get(canonicalUrl);
	}

	/** All records, most-recently-updated first. */
	toArray(): BookmarkRecord[] {
		return [...this.byUrl.values()].sort(byRecency);
	}

	private with(record: BookmarkRecord): Bookmarks {
		const next = new Map(this.byUrl);
		next.set(record.canonicalUrl, record);
		return new Bookmarks(next);
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
			return err({ field: "canonicalUrl", message: "no record for canonical URL" });
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
			return err({ field: "canonicalUrl", message: "no record for canonical URL" });
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

	delete(canonicalUrl: CanonicalUrl): Bookmarks {
		if (!this.byUrl.has(canonicalUrl)) {
			return this;
		}
		const next = new Map(this.byUrl);
		next.delete(canonicalUrl);
		return new Bookmarks(next);
	}

	deleteById(id: BookmarkId): Bookmarks {
		for (const record of this.byUrl.values()) {
			if (record.id === id) {
				return this.delete(record.canonicalUrl);
			}
		}
		return this;
	}

	/**
	 * Merge remote records into this set by canonical URL (revision-conflict
	 * resolution). For a URL present on both sides the latest `updatedAt` wins
	 * its field values, the earliest `createdAt` is preserved, and ties break
	 * deterministically by id. The result is independent of argument order
	 * except for the deterministic tie-break.
	 */
	mergeRemote(remote: Bookmarks): Bookmarks {
		const next = new Map(this.byUrl);
		for (const incoming of remote.byUrl.values()) {
			const local = next.get(incoming.canonicalUrl);
			if (!local) {
				next.set(incoming.canonicalUrl, incoming);
				continue;
			}
			next.set(incoming.canonicalUrl, resolveConflict(local, incoming));
		}
		return new Bookmarks(next);
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
