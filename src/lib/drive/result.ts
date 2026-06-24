/**
 * Minimal typed-result helpers for the Drive boundary.
 *
 * Like the AI and extraction modules, `drive/*` carries its own tiny
 * {@link Result} rather than importing one from `bookmarks/*`, so the I/O layer
 * stays independent of the bookmark domain's error types. Recoverable
 * conditions (auth failures, network errors, conflicts, malformed remote data)
 * are returned as values from the repository, never thrown across its boundary.
 * See docs/implementation-principles.md "Error handling policy".
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
