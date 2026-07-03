/**
 * The use-case error taxonomy.
 *
 * Every failure a use case surfaces to its caller is one flat, typed
 * {@link AppError}. The shape is deliberately UI- and log-safe: it carries a
 * stable `kind`, a human-readable `message`, and at most a short `detail`/`status`
 * — never an OAuth token and never raw page-excerpt content (AGENTS.md "Redact
 * tokens and sensitive values"; the excerpt is a transient AI input that never
 * enters an error here).
 *
 * Lower layers already throw/return their own typed errors; this module maps
 * those onto {@link AppError} so the UI sees one consistent vocabulary.
 */
import type { RepositoryError } from "../drive/index";
import type { ExtractionError } from "../extraction/index";
import type { CollectionError } from "../bookmarks/index";
import type { SkillError } from "../settings/index";
import type { SyncError } from "../storage/index";

export type AppErrorKind =
	| "no-active-tab" // no resolvable active tab to save
	| "invalid-tab" // active tab lacks a usable URL
	| "invalid-bookmark" // a domain invariant rejected the record (e.g. bad URL)
	| "invalid-skill" // a domain invariant rejected a custom analysis skill
	| "not-found" // no cached record for the requested canonical URL
	| "extraction" // page extraction failed
	| "drive" // a Drive repository operation failed
	| "cache"; // reading/writing the local cache failed

export type AppError = {
	readonly kind: AppErrorKind;
	readonly message: string;
	/** A short, safe sub-classification (e.g. the underlying Drive error kind). */
	readonly detail?: string;
	/** HTTP status when the failure originated from a Drive API response. */
	readonly status?: number;
};

export function appError(
	kind: AppErrorKind,
	message: string,
	extra: { detail?: string; status?: number } = {},
): AppError {
	return { kind, message, detail: extra.detail, status: extra.status };
}

/** Map a Drive {@link RepositoryError} onto the `drive` app error. */
export function fromRepositoryError(error: RepositoryError): AppError {
	return {
		kind: "drive",
		message: error.message,
		detail: error.kind,
		status: error.status,
	};
}

/** Map a Drive {@link RepositoryError} onto the cache's {@link SyncError}. */
export function toSyncError(error: RepositoryError): SyncError {
	return { kind: error.kind, message: error.message };
}

/** Map an {@link ExtractionError} onto the `extraction` app error. */
export function fromExtractionError(error: ExtractionError): AppError {
	return { kind: "extraction", message: error.message, detail: error.field };
}

/** Map a bookmark-domain {@link CollectionError} onto an `invalid-bookmark` error. */
export function fromCollectionError(error: CollectionError): AppError {
	return {
		kind: "invalid-bookmark",
		message: error.message,
		detail: error.field,
	};
}

/** Map a settings-domain {@link SkillError} onto an `invalid-skill` error. */
export function fromSkillError(error: SkillError): AppError {
	return {
		kind: "invalid-skill",
		message: error.message,
		detail: error.field,
	};
}
