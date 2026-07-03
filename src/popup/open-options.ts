/**
 * Open the extension's options page, guarded so it is a no-op outside the
 * extension (a standalone render, a unit test) instead of throwing.
 *
 * Reading the bare `chrome` identifier throws `ReferenceError` when the global
 * is undeclared, so the popup footer must never do `chrome?.runtime?.…`.
 * `globalThis.chrome` is always safe to read — it is simply `undefined`
 * off-extension — and the optional chaining then no-ops (MIK-015).
 *
 * Before opening, a token-free sync request marker (a timestamp only) is
 * best-effort written to `chrome.storage.local` so the options page — freshly
 * opened or already open — pulls Drive instead of showing stale cache
 * (MIK-026). The marker is strictly optional: a missing storage API, a
 * synchronous throw, or a rejected write never blocks `openOptionsPage()`.
 */
import { OPTIONS_SYNC_REQUEST_KEY } from "../lib/storage/index";

/** The narrow slice of the `chrome` global this boundary reads. */
type OpenOptionsChrome = {
	runtime?: { openOptionsPage?: () => void };
	storage?: {
		local?: { set?: (items: Record<string, unknown>) => Promise<void> };
	};
};

/**
 * Best-effort write of the Manage-triggered sync request marker. Failures are
 * swallowed by design: the marker only upgrades freshness, while opening the
 * options page must always succeed.
 */
function requestOptionsSync(chromeLike: OpenOptionsChrome | undefined): void {
	const local = chromeLike?.storage?.local;
	if (!local?.set) {
		return;
	}
	try {
		void Promise.resolve(
			local.set({
				[OPTIONS_SYNC_REQUEST_KEY]: { requestedAt: new Date().toISOString() },
			}),
		).catch(() => {});
	} catch {
		// A synchronous throw from a broken storage shim is equally non-fatal.
	}
}

export function openOptionsPage(): void {
	const chromeLike = (globalThis as { chrome?: OpenOptionsChrome }).chrome;
	requestOptionsSync(chromeLike);
	chromeLike?.runtime?.openOptionsPage?.();
}
