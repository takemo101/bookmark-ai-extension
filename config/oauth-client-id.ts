/**
 * Resolves the Google OAuth client ID injected into the MV3 manifest.
 *
 * The OAuth client ID is not a secret (it is embedded in the manifest), but
 * dev and production client IDs must be kept separate, and production /
 * extension builds must never silently fall back to a placeholder. See
 * `docs/publication.md` and `docs/privacy-policy.md`.
 */

/**
 * Documented dev/test fallback OAuth client ID.
 *
 * This is intentionally a non-functional placeholder. It only exists so that
 * `vite dev` and the test suite can run without a configured client ID. It is
 * never used for an extension build (see {@link resolveOAuthClientId}).
 */
export const DEV_FALLBACK_OAUTH_CLIENT_ID =
	"dev-unconfigured.apps.googleusercontent.com";

export type ResolveOAuthClientIdOptions = {
	/**
	 * When true, a missing client ID is a hard error instead of falling back to
	 * {@link DEV_FALLBACK_OAUTH_CLIENT_ID}. Set this for `vite build`.
	 */
	requireForBuild: boolean;
};

/**
 * Returns a usable OAuth client ID, or throws a clear error when one is
 * required for a build but not configured.
 */
export function resolveOAuthClientId(
	rawClientId: string | undefined,
	options: ResolveOAuthClientIdOptions,
): string {
	const clientId = rawClientId?.trim();
	if (clientId) {
		return clientId;
	}

	if (options.requireForBuild) {
		throw new Error(
			"VITE_GOOGLE_OAUTH_CLIENT_ID is required for an extension build but is not set. " +
				"Add it to .env.local (see .env.example). " +
				"Production/extension builds must not fall back to a placeholder OAuth client.",
		);
	}

	return DEV_FALLBACK_OAUTH_CLIENT_ID;
}
