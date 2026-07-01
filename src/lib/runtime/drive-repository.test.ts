import { describe, expect, it } from "vitest";

import type { ChromeIdentityApi } from "../drive/index";
import { createChromeDriveRuntime } from "./drive-repository";

/**
 * The composed Drive runtime is exercised with a fake `chrome.identity` and a
 * fake `fetch` — no real Google calls. The point is to pin the two decisions this
 * module owns: Drive operations sign in *interactively* (so first use surfaces
 * consent), while the connection-badge probe stays *non-interactive*.
 */

type TokenCall = { interactive?: boolean };

/** A fake identity that always grants a token and records the interactive flag. */
function fakeIdentity(
	grant: boolean,
): ChromeIdentityApi & { calls: TokenCall[] } {
	const calls: TokenCall[] = [];
	return {
		calls,
		getAuthToken(details, callback) {
			calls.push({ interactive: details.interactive });
			callback(grant ? "token-abc" : undefined);
		},
		removeCachedAuthToken(_details, callback) {
			callback();
		},
	};
}

/** A fake Drive REST transport that serves a bootstrapped, empty store. */
function fakeFetch(): typeof fetch {
	const json = (body: unknown): Response =>
		({
			ok: true,
			status: 200,
			statusText: "OK",
			async json() {
				return body;
			},
			async text() {
				return JSON.stringify(body);
			},
		}) as unknown as Response;

	return (async (input: RequestInfo | URL) => {
		const url = decodeURIComponent(String(input));
		if (url.includes("alt=media")) {
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				async text() {
					return "";
				},
			} as unknown as Response;
		}
		if (url.includes("vnd.google-apps.folder")) {
			return json({ files: [{ id: "folder-1", name: "bookmark-ai" }] });
		}
		if (url.includes("in parents")) {
			return json({
				files: [
					{ id: "file-1", name: "bookmarks.jsonl", headRevisionId: "rev-1" },
				],
			});
		}
		// Bare metadata read for a file id.
		return json({
			id: "file-1",
			name: "bookmarks.jsonl",
			headRevisionId: "rev-1",
		});
	}) as typeof fetch;
}

describe("createChromeDriveRuntime", () => {
	it("loads through the composed stack using interactive sign-in", async () => {
		const identity = fakeIdentity(true);
		const runtime = createChromeDriveRuntime({
			identity,
			getLastError: () => undefined,
			fetchFn: fakeFetch(),
		});

		const result = await runtime.repository.load();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.bookmarks.size).toBe(0);
			expect(result.value.folder.name).toBe("bookmark-ai");
		}
		// Every Drive token request rode the interactive sign-in default.
		expect(identity.calls.length).toBeGreaterThan(0);
		expect(identity.calls.every((c) => c.interactive === true)).toBe(true);
	});

	it("probeConnection reports connected without prompting", async () => {
		const identity = fakeIdentity(true);
		const runtime = createChromeDriveRuntime({
			identity,
			getLastError: () => undefined,
			fetchFn: fakeFetch(),
		});

		const status = await runtime.probeConnection();

		expect(status).toBe("connected");
		// The badge probe must never trigger an interactive consent dialog.
		expect(identity.calls).toEqual([{ interactive: false }]);
	});

	it("probeConnection reports disconnected when no token is available", async () => {
		const identity = fakeIdentity(false);
		const runtime = createChromeDriveRuntime({
			identity,
			getLastError: () => undefined,
			fetchFn: fakeFetch(),
		});

		expect(await runtime.probeConnection()).toBe("disconnected");
		expect(identity.calls).toEqual([{ interactive: false }]);
	});
});
