/**
 * Minimal typed-result helpers for the `storage/*` boundary.
 *
 * Mirrors the tiny `Result` carried by `drive/*`, `ai/*`, and `extraction/*`:
 * the cache parser returns recoverable problems as values instead of throwing,
 * so a corrupt `chrome.storage.local` payload can never abort a read. See
 * docs/implementation-principles.md "Error handling policy".
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
