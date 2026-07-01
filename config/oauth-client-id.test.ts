import { describe, expect, it } from "vitest";

import {
	DEV_FALLBACK_OAUTH_CLIENT_ID,
	resolveOAuthClientId,
} from "./oauth-client-id";

describe("resolveOAuthClientId", () => {
	it("returns the configured client ID when present", () => {
		const clientId = resolveOAuthClientId("abc.apps.googleusercontent.com", {
			requireForBuild: true,
		});
		expect(clientId).toBe("abc.apps.googleusercontent.com");
	});

	it("trims surrounding whitespace from the configured client ID", () => {
		const clientId = resolveOAuthClientId(
			"  abc.apps.googleusercontent.com \n",
			{
				requireForBuild: true,
			},
		);
		expect(clientId).toBe("abc.apps.googleusercontent.com");
	});

	it("falls back to the dev placeholder when not required for a build", () => {
		const clientId = resolveOAuthClientId(undefined, {
			requireForBuild: false,
		});
		expect(clientId).toBe(DEV_FALLBACK_OAUTH_CLIENT_ID);
	});

	it("treats a whitespace-only value as unset in dev", () => {
		const clientId = resolveOAuthClientId("   ", { requireForBuild: false });
		expect(clientId).toBe(DEV_FALLBACK_OAUTH_CLIENT_ID);
	});

	it("throws a clear error when required for a build but missing", () => {
		expect(() =>
			resolveOAuthClientId(undefined, { requireForBuild: true }),
		).toThrow(/VITE_GOOGLE_OAUTH_CLIENT_ID is required/);
	});

	it("throws when required for a build but only whitespace is provided", () => {
		expect(() =>
			resolveOAuthClientId("   ", { requireForBuild: true }),
		).toThrow(/VITE_GOOGLE_OAUTH_CLIENT_ID is required/);
	});

	it("never returns the dev placeholder for a required build", () => {
		expect(() => resolveOAuthClientId("", { requireForBuild: true })).toThrow();
	});
});
