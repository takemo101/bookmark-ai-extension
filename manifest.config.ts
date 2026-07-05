import { defineManifest } from "@crxjs/vite-plugin";

import pkg from "./package.json" with { type: "json" };

/**
 * Builds the MV3 manifest with the OAuth client ID injected at config time.
 *
 * Permissions are intentionally limited to the MVP set documented in
 * `docs/design.md` and `docs/publication.md`:
 *   - identity   : Google OAuth via chrome.identity
 *   - storage    : chrome.storage.local cache (Drive remains source of truth)
 *   - activeTab  : user-initiated access to the current tab on Save
 *   - scripting  : inject the page extractor only after the user clicks Save
 *   - favicon    : Chrome's extension-local `_favicon` endpoint for the site
 *                  icons in bookmark lists/details (MIK-032); resolved at
 *                  render time, never persisted, no external favicon service
 * Host permission is scoped to the Google APIs origin, and the only Drive
 * OAuth scope is `drive.file`.
 */
export function createManifest(oauthClientId: string) {
	return defineManifest({
		manifest_version: 3,
		name: "Bookmark AI Extension",
		description:
			"Save the current tab as an AI-enriched bookmark stored as JSONL in your own Google Drive.",
		version: pkg.version,
		icons: {
			16: "icons/icon-16.png",
			32: "icons/icon-32.png",
			48: "icons/icon-48.png",
			128: "icons/icon-128.png",
		},
		action: {
			default_popup: "src/popup/index.html",
			default_title: "Bookmark AI",
			default_icon: {
				16: "icons/icon-16.png",
				32: "icons/icon-32.png",
				48: "icons/icon-48.png",
				128: "icons/icon-128.png",
			},
		},
		options_page: "src/options/index.html",
		background: {
			service_worker: "src/background/service-worker.ts",
			type: "module",
		},
		permissions: ["identity", "storage", "activeTab", "scripting", "favicon"],
		host_permissions: ["https://www.googleapis.com/*"],
		oauth2: {
			client_id: oauthClientId,
			scopes: ["https://www.googleapis.com/auth/drive.file"],
		},
	});
}
