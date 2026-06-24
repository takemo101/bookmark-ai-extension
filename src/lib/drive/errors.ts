/**
 * Typed error taxonomy for the Drive boundary.
 *
 * Two layers exist on purpose:
 *   - The token provider and Drive client *throw* typed errors
 *     ({@link DriveAuthError}, {@link DriveApiError}) at their I/O edge, mirroring
 *     how the AI module's port throws `PromptApiUnavailableError`.
 *   - The repository *catches* them and returns a flat {@link RepositoryError}
 *     value, so its callers get a recoverable, typed result instead of an
 *     exception. See docs/implementation-principles.md "Error handling policy".
 *
 * Security: no error message in this module ever contains an OAuth token. Auth
 * errors carry only the Chrome-supplied message; API errors carry only HTTP
 * status and the server's error text. The request `Authorization` header is
 * never serialized into an error. See docs/privacy-policy.md and AGENTS.md
 * "Redact tokens and sensitive values from logs, errors, reports".
 */

export type RepositoryErrorKind =
	| "auth"
	| "permission"
	| "network"
	| "not-found"
	| "rate-limit"
	| "server"
	| "malformed-response"
	| "conflict"
	| "unknown";

/** Flat, recoverable error returned from {@link DriveBookmarkRepository} methods. */
export type RepositoryError = {
	readonly kind: RepositoryErrorKind;
	readonly message: string;
	/** HTTP status, when the failure originated from a Drive API response. */
	readonly status?: number;
};

/**
 * Thrown by the token provider when an OAuth token cannot be obtained. The
 * message is the Chrome identity error text only — never the token itself.
 */
export class DriveAuthError extends Error {
	readonly kind = "auth" as const;
	constructor(message = "failed to obtain a Google auth token") {
		super(message);
		this.name = "DriveAuthError";
	}
}

/** Thrown by the Drive client when an API call fails. */
export class DriveApiError extends Error {
	readonly kind: RepositoryErrorKind;
	readonly status?: number;
	constructor(kind: RepositoryErrorKind, message: string, status?: number) {
		super(message);
		this.name = "DriveApiError";
		this.kind = kind;
		this.status = status;
	}
}

/** Map an HTTP status onto a {@link RepositoryErrorKind}. */
export function classifyStatus(status: number): RepositoryErrorKind {
	if (status === 401) return "auth";
	if (status === 403) return "permission";
	if (status === 404) return "not-found";
	if (status === 429) return "rate-limit";
	if (status >= 500) return "server";
	return "unknown";
}

/**
 * Collapse any thrown value into a flat {@link RepositoryError}. A `fetch`
 * network failure surfaces as a `TypeError` and is classified as `network`.
 */
export function toRepositoryError(error: unknown): RepositoryError {
	if (error instanceof DriveAuthError) {
		return { kind: "auth", message: error.message };
	}
	if (error instanceof DriveApiError) {
		return { kind: error.kind, message: error.message, status: error.status };
	}
	if (error instanceof TypeError) {
		// `fetch` rejects with a TypeError when the network is unreachable.
		return { kind: "network", message: error.message };
	}
	if (error instanceof Error) {
		return { kind: "unknown", message: error.message };
	}
	return { kind: "unknown", message: String(error) };
}
