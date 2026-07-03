/**
 * Typed result helpers for the settings domain.
 *
 * Mirrors `bookmarks/result.ts`: recoverable conditions (malformed remote
 * settings, unknown skill id) are returned as values, not thrown. Programmer
 * defects use {@link SettingsInvariantError} instead. See
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

/**
 * Thrown when internal code tries to build an invalid settings domain value.
 * This is a defect (a bug), not a recoverable error, so it surfaces loudly
 * rather than being folded into a {@link Result}.
 */
export class SettingsInvariantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SettingsInvariantError";
	}
}
