/**
 * The options-side consumer of the Manage-in-Options sync request marker
 * (MIK-026). The popup writes a token-free marker to `chrome.storage.local`
 * right before opening the options page (`popup/open-options.ts`); this module
 * turns that marker into refresh signals:
 *
 *   - {@link OptionsSyncRequestSource.consumePending} removes a marker left
 *     before this page mounted — the controller's `init()` already pulls Drive
 *     on mount, so consumption is cleanup, not a second sync;
 *   - {@link OptionsSyncRequestSource.subscribe} watches
 *     `chrome.storage.onChanged` so an already-open options page re-runs the
 *     Drive refresh when Manage in Options is clicked again.
 *
 * Everything reads `globalThis.chrome` defensively (MIK-015): off-extension —
 * a standalone render, a unit test — every method is a safe no-op. Tests
 * inject a fake `chrome`-shaped object; the composition root
 * (`options/main.tsx`) passes nothing and gets the real global.
 */
import { OPTIONS_SYNC_REQUEST_KEY } from "../lib/storage/index";

/** A single `storage.onChanged` entry; only `newValue` presence matters here. */
type StorageChange = { readonly newValue?: unknown };

/** The narrow slice of the `chrome` global this boundary reads. */
type SyncRequestChrome = {
	storage?: {
		local?: { remove?: (keys: string) => Promise<void> };
		onChanged?: {
			addListener?: (
				listener: (
					changes: Record<string, StorageChange>,
					areaName: string,
				) => void,
			) => void;
			removeListener?: (
				listener: (
					changes: Record<string, StorageChange>,
					areaName: string,
				) => void,
			) => void;
		};
	};
};

export type OptionsSyncRequestSource = {
	/** Remove any marker left before this page mounted. Never throws. */
	consumePending(): Promise<void>;
	/**
	 * Invoke `onRequest` whenever a new Manage-triggered sync request lands
	 * while this page is open. Returns an unsubscribe function.
	 */
	subscribe(onRequest: () => void): () => void;
};

/** Best-effort marker removal; a missing/failing storage API is non-fatal. */
async function removeMarker(chromeLike: SyncRequestChrome | undefined) {
	try {
		await chromeLike?.storage?.local?.remove?.(OPTIONS_SYNC_REQUEST_KEY);
	} catch {
		// A stale marker is harmless: it only ever triggers an extra refresh.
	}
}

export function createOptionsSyncRequestSource(
	chromeLike: SyncRequestChrome | undefined = (
		globalThis as { chrome?: SyncRequestChrome }
	).chrome,
): OptionsSyncRequestSource {
	return {
		async consumePending() {
			await removeMarker(chromeLike);
		},

		subscribe(onRequest) {
			const events = chromeLike?.storage?.onChanged;
			if (!events?.addListener) {
				return () => {};
			}
			const listener = (
				changes: Record<string, StorageChange>,
				areaName: string,
			) => {
				// Only a fresh marker write counts; our own removal of the marker
				// also fires `onChanged` (with no `newValue`) and must not loop.
				if (
					areaName !== "local" ||
					changes[OPTIONS_SYNC_REQUEST_KEY]?.newValue === undefined
				) {
					return;
				}
				void removeMarker(chromeLike);
				onRequest();
			};
			events.addListener(listener);
			return () => events.removeListener?.(listener);
		},
	};
}
