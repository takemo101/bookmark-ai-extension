/**
 * Minimal typed-result helpers for the AI boundary.
 *
 * The AI module is kept independent of the bookmark domain (and of Drive,
 * storage, React, and extraction), so it carries its own tiny {@link Result}
 * rather than reaching into `bookmarks/*`. Recoverable conditions (malformed
 * Prompt API output) are returned as values, never thrown; see
 * docs/implementation-principles.md "Parse, don't validate" and "Error handling
 * policy".
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
