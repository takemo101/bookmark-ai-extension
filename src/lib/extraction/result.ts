/**
 * Minimal typed-result helpers for the extraction boundary.
 *
 * Extraction is kept independent of the bookmark domain (and of Drive, storage,
 * React, and AI), so it carries its own tiny {@link Result} rather than reaching
 * into `bookmarks/*`. Recoverable conditions (malformed injected extraction
 * output) are returned as values; see docs/implementation-principles.md
 * "Parse, don't validate".
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
	return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
	return { ok: false, error };
}
