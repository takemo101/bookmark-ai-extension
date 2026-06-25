/**
 * Drive repository composition for the extension runtime.
 *
 * Wires the real Drive stack behind the app's {@link BookmarkRepositoryPort}:
 *   chrome.identity token provider → Google Drive REST client → conflict-safe
 *   {@link DriveBookmarkRepository}.
 * Each layer already lives in `drive/*`; this module only assembles them and is
 * the single place that decides *when* OAuth consent is interactive, so the
 * manual sign-in smoke path has one well-defined trigger.
 *
 * Sign-in posture (docs/publication.md "Development Setup"; AGENTS.md security
 * rules): the Drive client calls its token provider with no options
 * (non-interactive). To let the very first Drive operation surface Google's
 * consent screen, the provider used by the client defaults to `interactive:
 * true`. Chrome returns an already-granted token silently, so consent UI appears
 * only when it is genuinely needed — never on a background refresh. The
 * connection badge probe deliberately uses a separate, *non-interactive* call so
 * rendering a badge never pops a consent dialog. Tokens are never logged or
 * surfaced; that contract is enforced inside `drive/*`.
 */
import type { BookmarkRepositoryPort } from "../app/index";
import {
	type ChromeIdentityApi,
	type LastErrorAccessor,
	type TokenProvider,
	DriveBookmarkRepository,
	createChromeIdentityTokenProvider,
	createGoogleDriveClient,
} from "../drive/index";

/** Whether a Drive OAuth token is already available without prompting. */
export type ConnectionStatus = "connected" | "disconnected";

export type ChromeDriveDeps = {
	/** Defaults to `chrome.identity`. */
	identity?: ChromeIdentityApi;
	/** Defaults to reading `chrome.runtime.lastError`. */
	getLastError?: LastErrorAccessor;
	/** Defaults to the global `fetch`. */
	fetchFn?: typeof fetch;
};

/** The assembled Drive runtime: the repository port plus a connection probe. */
export type ChromeDriveRuntime = {
	readonly repository: BookmarkRepositoryPort;
	/** Non-interactive check used only to render the popup connection badge. */
	probeConnection(): Promise<ConnectionStatus>;
};

/**
 * Wrap a base provider so the Drive client's argless `getToken()` becomes
 * interactive, letting first use trigger consent. Explicit `interactive: false`
 * callers (the badge probe) are passed through unchanged.
 */
function withInteractiveSignIn(base: TokenProvider): TokenProvider {
	return {
		getToken(options) {
			return base.getToken({ interactive: options?.interactive ?? true });
		},
		invalidateToken(token) {
			return base.invalidateToken(token);
		},
	};
}

/** Assemble the real Drive repository + connection probe for the extension. */
export function createChromeDriveRuntime(
	deps: ChromeDriveDeps = {},
): ChromeDriveRuntime {
	const base = createChromeIdentityTokenProvider({
		identity: deps.identity,
		getLastError: deps.getLastError,
	});
	const client = createGoogleDriveClient(withInteractiveSignIn(base), {
		fetchFn: deps.fetchFn,
	});
	const repository = new DriveBookmarkRepository(client);

	return {
		repository,
		async probeConnection(): Promise<ConnectionStatus> {
			try {
				await base.getToken({ interactive: false });
				return "connected";
			} catch {
				return "disconnected";
			}
		},
	};
}
