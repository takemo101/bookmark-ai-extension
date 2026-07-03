import { describe, expect, it, vi } from "vitest";

import { OPTIONS_SYNC_REQUEST_KEY } from "../lib/storage/index";
import { createOptionsSyncRequestSource } from "./sync-request";

/**
 * The Manage-in-Options sync request consumer (MIK-026), exercised with a fake
 * `chrome`-shaped object — no extension runtime. What is pinned: a marker left
 * before mount is consumed (removed), a marker written while the page is open
 * notifies exactly the subscribed refresh and clears itself, our own removal
 * never loops back into another refresh, and everything is a safe no-op
 * off-extension.
 */

type StorageChange = { newValue?: unknown };
type Listener = (
	changes: Record<string, StorageChange>,
	areaName: string,
) => void;

function fakeChrome() {
	const listeners = new Set<Listener>();
	const remove = vi.fn().mockResolvedValue(undefined);
	const chromeLike = {
		storage: {
			local: { remove },
			onChanged: {
				addListener: (listener: Listener) => listeners.add(listener),
				removeListener: (listener: Listener) => listeners.delete(listener),
			},
		},
	};
	function emit(changes: Record<string, StorageChange>, areaName = "local") {
		for (const listener of [...listeners]) {
			listener(changes, areaName);
		}
	}
	return { chromeLike, remove, emit, listeners };
}

describe("createOptionsSyncRequestSource", () => {
	it("consumePending removes any marker left before this page mounted", async () => {
		const { chromeLike, remove } = fakeChrome();
		const source = createOptionsSyncRequestSource(chromeLike);

		await source.consumePending();

		expect(remove).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledWith(OPTIONS_SYNC_REQUEST_KEY);
	});

	it("notifies the subscriber and clears the marker on a new request", () => {
		const { chromeLike, remove, emit } = fakeChrome();
		const source = createOptionsSyncRequestSource(chromeLike);
		const onRequest = vi.fn();
		source.subscribe(onRequest);

		emit({
			[OPTIONS_SYNC_REQUEST_KEY]: {
				newValue: { requestedAt: "2026-07-04T00:00:00Z" },
			},
		});

		expect(onRequest).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledWith(OPTIONS_SYNC_REQUEST_KEY);
	});

	it("ignores its own marker removal, unrelated keys, and other areas", () => {
		const { chromeLike, emit } = fakeChrome();
		const source = createOptionsSyncRequestSource(chromeLike);
		const onRequest = vi.fn();
		source.subscribe(onRequest);

		// The consumer's own remove fires onChanged with no newValue.
		emit({ [OPTIONS_SYNC_REQUEST_KEY]: {} });
		// Unrelated cache writes must never trigger a Drive pull.
		emit({ "bookmark-ai:cache": { newValue: {} } });
		// Marker-shaped changes in other storage areas do not count.
		emit(
			{ [OPTIONS_SYNC_REQUEST_KEY]: { newValue: { requestedAt: "x" } } },
			"sync",
		);

		expect(onRequest).not.toHaveBeenCalled();
	});

	it("stops notifying after unsubscribe", () => {
		const { chromeLike, emit, listeners } = fakeChrome();
		const source = createOptionsSyncRequestSource(chromeLike);
		const onRequest = vi.fn();
		const unsubscribe = source.subscribe(onRequest);

		unsubscribe();
		emit({ [OPTIONS_SYNC_REQUEST_KEY]: { newValue: { requestedAt: "x" } } });

		expect(onRequest).not.toHaveBeenCalled();
		expect(listeners.size).toBe(0);
	});

	it("is a safe no-op off-extension (no chrome global)", async () => {
		const source = createOptionsSyncRequestSource(undefined);

		await expect(source.consumePending()).resolves.toBeUndefined();
		const unsubscribe = source.subscribe(() => {});
		expect(() => unsubscribe()).not.toThrow();
	});

	it("survives a failing storage remove", async () => {
		const { chromeLike, remove, emit } = fakeChrome();
		remove.mockRejectedValue(new Error("storage gone"));
		const source = createOptionsSyncRequestSource(chromeLike);
		const onRequest = vi.fn();
		source.subscribe(onRequest);

		await expect(source.consumePending()).resolves.toBeUndefined();
		emit({ [OPTIONS_SYNC_REQUEST_KEY]: { newValue: { requestedAt: "x" } } });

		// The refresh still fires even when the marker cannot be cleared.
		expect(onRequest).toHaveBeenCalledTimes(1);
		// Flush the swallowed rejection so it can never surface as unhandled.
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});
