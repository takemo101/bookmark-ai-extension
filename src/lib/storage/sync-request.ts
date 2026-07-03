/**
 * The Manage-in-Options → Options sync request marker (MIK-026).
 *
 * The popup's "Manage in Options" action writes this marker to
 * `chrome.storage.local` right before opening the options page. The options
 * page consumes (removes) it on mount — its own init already pulls Drive —
 * and an already-open options page observes the write via
 * `chrome.storage.onChanged` and re-runs the Drive refresh.
 *
 * The marker is deliberately token-free: a request timestamp only — no URL,
 * title, page excerpt, token, or bookmark data ever rides along (AGENTS.md
 * "Security and privacy rules"). The adapters that read/write it live at the
 * popup/options boundaries (`popup/open-options.ts`, `options/sync-request.ts`);
 * this module only owns the shared key and payload shape, keeping the two
 * boundaries free of imports into each other.
 */

/** The single key the sync request marker occupies in `chrome.storage.local`. */
export const OPTIONS_SYNC_REQUEST_KEY = "bookmark-ai:options-sync-request";

/** The marker payload: when the sync was requested. Informational only. */
export type OptionsSyncRequestMarker = {
	readonly requestedAt: string;
};
