import { afterEach, describe, expect, it, vi } from "vitest";

import { OPTIONS_SYNC_REQUEST_KEY } from "../lib/storage/index";
import { openOptionsPage } from "./open-options";

/**
 * The popup footer's "Manage in Options" action must be safe to invoke even when
 * the extension globals are absent (a standalone render, a unit test). Reading
 * the bare `chrome` identifier would throw `ReferenceError`; the guard reads
 * `globalThis.chrome` instead, which is simply `undefined` off-extension
 * (MIK-015).
 *
 * Since MIK-026 the action also best-effort writes a token-free sync request
 * marker to `chrome.storage.local` so the options page pulls Drive instead of
 * showing stale cache. The marker is strictly optional: any storage failure
 * must still open the options page.
 */
describe("openOptionsPage", () => {
	const g = globalThis as { chrome?: unknown };

	afterEach(() => {
		delete g.chrome;
	});

	it("does not throw when `chrome` is undeclared (standalone / test render)", () => {
		delete g.chrome;
		expect(() => openOptionsPage()).not.toThrow();
	});

	it("opens the options page when the extension runtime is present", () => {
		const open = vi.fn();
		g.chrome = { runtime: { openOptionsPage: open } };

		openOptionsPage();

		expect(open).toHaveBeenCalledTimes(1);
	});

	it("is a safe no-op when `runtime.openOptionsPage` is missing", () => {
		g.chrome = { runtime: {} };
		expect(() => openOptionsPage()).not.toThrow();
	});

	it("writes a token-free sync request marker and opens Options (MIK-026)", () => {
		const open = vi.fn();
		const set = vi.fn().mockResolvedValue(undefined);
		g.chrome = {
			runtime: { openOptionsPage: open },
			storage: { local: { set } },
		};

		openOptionsPage();

		expect(open).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledTimes(1);
		const items = set.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(Object.keys(items)).toEqual([OPTIONS_SYNC_REQUEST_KEY]);
		// The marker carries a timestamp only — no URL, title, excerpt, token, or
		// bookmark data may ever ride along.
		const marker = items[OPTIONS_SYNC_REQUEST_KEY] as Record<string, unknown>;
		expect(Object.keys(marker)).toEqual(["requestedAt"]);
		expect(typeof marker.requestedAt).toBe("string");
	});

	it("still opens Options when the marker write rejects (MIK-026)", async () => {
		const open = vi.fn();
		const set = vi.fn().mockRejectedValue(new Error("storage quota"));
		g.chrome = {
			runtime: { openOptionsPage: open },
			storage: { local: { set } },
		};

		expect(() => openOptionsPage()).not.toThrow();
		expect(open).toHaveBeenCalledTimes(1);
		// Flush the swallowed rejection so it can never surface as unhandled.
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it("still opens Options when the marker write throws synchronously (MIK-026)", () => {
		const open = vi.fn();
		const set = vi.fn(() => {
			throw new Error("broken storage shim");
		});
		g.chrome = {
			runtime: { openOptionsPage: open },
			storage: { local: { set } },
		};

		expect(() => openOptionsPage()).not.toThrow();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("still opens Options when the storage API is missing entirely (MIK-026)", () => {
		const open = vi.fn();
		g.chrome = { runtime: { openOptionsPage: open }, storage: {} };

		openOptionsPage();

		expect(open).toHaveBeenCalledTimes(1);
	});
});
