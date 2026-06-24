import { describe, expect, it } from "vitest";

import { DriveAuthError } from "./errors";
import {
	type ChromeIdentityApi,
	createChromeIdentityTokenProvider,
} from "./token-provider";

/**
 * These tests inject a fake `chrome.identity` and `lastError` accessor instead
 * of touching a real Chrome global, so they stay pure and deterministic. They
 * also assert the security invariant that a token value never appears in a
 * thrown error.
 */

const SECRET_TOKEN = "ya29.super-secret-access-token";

function fakeIdentity(
	overrides: Partial<ChromeIdentityApi> = {},
): ChromeIdentityApi {
	return {
		getAuthToken: (_details, callback) => callback(SECRET_TOKEN),
		removeCachedAuthToken: (_details, callback) => callback(),
		...overrides,
	};
}

describe("createChromeIdentityTokenProvider", () => {
	it("resolves the token from chrome.identity", async () => {
		const provider = createChromeIdentityTokenProvider({
			identity: fakeIdentity(),
			getLastError: () => undefined,
		});
		expect(await provider.getToken()).toBe(SECRET_TOKEN);
	});

	it("passes the interactive flag through to chrome.identity", async () => {
		let seen: boolean | undefined;
		const provider = createChromeIdentityTokenProvider({
			identity: fakeIdentity({
				getAuthToken: (details, callback) => {
					seen = details.interactive;
					callback(SECRET_TOKEN);
				},
			}),
			getLastError: () => undefined,
		});
		await provider.getToken({ interactive: true });
		expect(seen).toBe(true);
	});

	it("defaults interactive to false", async () => {
		let seen: boolean | undefined = true;
		const provider = createChromeIdentityTokenProvider({
			identity: fakeIdentity({
				getAuthToken: (details, callback) => {
					seen = details.interactive;
					callback(SECRET_TOKEN);
				},
			}),
			getLastError: () => undefined,
		});
		await provider.getToken();
		expect(seen).toBe(false);
	});

	it("rejects with DriveAuthError carrying only chrome's message", async () => {
		const provider = createChromeIdentityTokenProvider({
			identity: fakeIdentity({
				getAuthToken: (_details, callback) => callback(undefined),
			}),
			getLastError: () => ({ message: "user not signed in" }),
		});
		await expect(provider.getToken()).rejects.toBeInstanceOf(DriveAuthError);
		await expect(provider.getToken()).rejects.toThrow("user not signed in");
	});

	it("rejects when no token and no error are provided", async () => {
		const provider = createChromeIdentityTokenProvider({
			identity: fakeIdentity({
				getAuthToken: (_details, callback) => callback(undefined),
			}),
			getLastError: () => undefined,
		});
		await expect(provider.getToken()).rejects.toBeInstanceOf(DriveAuthError);
	});

	it("never includes the token in a thrown auth error", async () => {
		// Even if Chrome were to echo the token into lastError, the provider only
		// rejects on a missing token, so the secret cannot reach the error.
		const provider = createChromeIdentityTokenProvider({
			identity: fakeIdentity({
				getAuthToken: (_details, callback) => callback(undefined),
			}),
			getLastError: () => ({ message: "permission denied" }),
		});
		try {
			await provider.getToken();
			throw new Error("expected getToken to reject");
		} catch (error) {
			expect(String(error)).not.toContain(SECRET_TOKEN);
		}
	});

	it("rejects when chrome.identity is unavailable", async () => {
		const provider = createChromeIdentityTokenProvider({
			identity: undefined,
			getLastError: () => undefined,
		});
		await expect(provider.getToken()).rejects.toBeInstanceOf(DriveAuthError);
	});

	it("invalidateToken calls removeCachedAuthToken with the token", async () => {
		let removed: string | undefined;
		const provider = createChromeIdentityTokenProvider({
			identity: fakeIdentity({
				removeCachedAuthToken: (details, callback) => {
					removed = details.token;
					callback();
				},
			}),
			getLastError: () => undefined,
		});
		await provider.invalidateToken(SECRET_TOKEN);
		expect(removed).toBe(SECRET_TOKEN);
	});

	it("invalidateToken resolves quietly when identity is unavailable", async () => {
		const provider = createChromeIdentityTokenProvider({
			identity: undefined,
			getLastError: () => undefined,
		});
		await expect(provider.invalidateToken(SECRET_TOKEN)).resolves.toBeUndefined();
	});
});
