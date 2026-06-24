/**
 * Typed-result helpers for the `app/*` use-case boundary.
 *
 * Use cases return recoverable failures as values, never as thrown exceptions,
 * so every caller (popup/options UI) gets a typed, exhaustive {@link Result}.
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
