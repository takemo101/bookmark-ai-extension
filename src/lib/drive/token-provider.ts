/**
 * OAuth token provider port + Chrome identity adapter.
 *
 * The Drive client depends only on the small {@link TokenProvider} port, never
 * on a concrete browser global, so it stays testable without Chrome. The
 * concrete adapter ({@link createChromeIdentityTokenProvider}) wraps
 * `chrome.identity.getAuthToken` for the `drive.file` scope (declared in the
 * manifest, not requested here) and maps its callback/`lastError` contract to a
 * Promise.
 *
 * Security: a token value is never logged and never placed into an error. On
 * failure the adapter throws {@link DriveAuthError} carrying only Chrome's
 * `lastError.message`. See AGENTS.md "Redact tokens and sensitive values".
 */
import { DriveAuthError } from "./errors";

/**
 * The port the Drive client talks to. A fake implementing this interface is all
 * a test needs; the real `chrome.identity` global never appears in client or
 * repository tests.
 */
export interface TokenProvider {
	/** Resolve an OAuth access token, or throw {@link DriveAuthError}. */
	getToken(options?: { interactive?: boolean }): Promise<string>;
	/**
	 * Drop a cached token that the server rejected (e.g. after a 401), so the
	 * next {@link getToken} mints a fresh one. Never throws.
	 */
	invalidateToken(token: string): Promise<void>;
}

/**
 * The slice of `chrome.identity` the adapter uses. Declared explicitly (rather
 * than depending on the ambient `chrome` global at the type level) so the
 * adapter can be exercised with a fake in tests.
 */
export interface ChromeIdentityApi {
	getAuthToken(
		details: { interactive?: boolean },
		callback: (token?: string) => void,
	): void;
	removeCachedAuthToken(
		details: { token: string },
		callback: () => void,
	): void;
}

/** Accessor for `chrome.runtime.lastError`, injectable for tests. */
export type LastErrorAccessor = () => { message?: string } | undefined;

type ChromeGlobal = {
	identity?: ChromeIdentityApi;
	runtime?: { lastError?: { message?: string } };
};

function resolveChrome(): ChromeGlobal | undefined {
	return (globalThis as { chrome?: ChromeGlobal }).chrome;
}

export type ChromeTokenProviderDeps = {
	/** Defaults to `chrome.identity`. */
	identity?: ChromeIdentityApi;
	/** Defaults to reading `chrome.runtime.lastError`. */
	getLastError?: LastErrorAccessor;
};

/**
 * Build a {@link TokenProvider} backed by `chrome.identity`. Dependencies are
 * injected for tests; in the extension they default to the live `chrome` global.
 */
export function createChromeIdentityTokenProvider(
	deps: ChromeTokenProviderDeps = {},
): TokenProvider {
	const identity = deps.identity ?? resolveChrome()?.identity;
	const getLastError =
		deps.getLastError ?? (() => resolveChrome()?.runtime?.lastError);

	return {
		getToken(options = {}): Promise<string> {
			if (!identity) {
				return Promise.reject(
					new DriveAuthError("chrome.identity is unavailable"),
				);
			}
			return new Promise<string>((resolve, reject) => {
				identity.getAuthToken(
					{ interactive: options.interactive ?? false },
					(token) => {
						const lastError = getLastError();
						if (lastError) {
							// Surface only Chrome's message, never the (absent) token.
							reject(new DriveAuthError(lastError.message));
							return;
						}
						if (!token) {
							reject(new DriveAuthError("no token was returned"));
							return;
						}
						resolve(token);
					},
				);
			});
		},

		invalidateToken(token: string): Promise<void> {
			if (!identity) {
				return Promise.resolve();
			}
			return new Promise<void>((resolve) => {
				identity.removeCachedAuthToken({ token }, () => resolve());
			});
		},
	};
}
