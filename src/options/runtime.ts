/**
 * The options composition root: build the real {@link OptionsUseCases} for the
 * extension runtime.
 *
 * This is the one place adapters are wired, so the React component and controller
 * stay free of Chrome/Drive/AI imports. Every port is now backed by a real
 * adapter:
 *   - the Drive repository (chrome.identity → Drive REST client → conflict-safe
 *     {@link DriveBookmarkRepository}), assembled by `runtime/*` — the ledger's
 *     authoritative source on `Sync now`;
 *   - the local cache (`chrome.storage.local`) — the ledger's render source;
 *   - the AI analyzer (Chrome Built-in AI / Prompt API) for re-analyze;
 *   - the page extractor (`chrome.scripting`) for re-analyze;
 *   - the system clock and crypto id generator.
 *
 * The options page never saves the current tab, so the required {@link
 * TabProviderPort} is a typed placeholder: it cannot resolve an active tab from a
 * full-page context and `saveCurrentTab` is never invoked here.
 *
 * Re-analyze note: re-analysis re-extracts from the live page through the same
 * `chrome.scripting` adapter. Because the options page is itself the active tab,
 * extraction succeeds only when the target page happens to be the active tab in
 * the current window; otherwise the record is marked `failed` with a safe message
 * and can be re-analyzed from the page's own tab. See the runtime extractor for
 * the activeTab-only posture.
 *
 * Tests never reach this module: the options controller is exercised with a fake
 * {@link OptionsUseCases}, and the runtime adapters are tested directly with fake
 * chrome/fetch dependencies in `runtime/*` and `storage/*`.
 */
import {
	type TabProviderPort,
	appError,
	createAnalyzerPort,
	createBookmarkApp,
	createCryptoIdGenerator,
	createSystemClock,
	err as appErr,
} from "../lib/app/index";
import { createChromePromptClient } from "../lib/ai/index";
import {
	createChromeDriveRuntime,
	createChromeScriptingExtractor,
} from "../lib/runtime/index";
import { createChromeLocalCache } from "../lib/storage/index";
import { type OptionsUseCases, createOptionsUseCases } from "./use-cases";

/** The options page does not save the current tab; a typed placeholder suffices. */
function createUnusedTabProvider(): TabProviderPort {
	return {
		async activeTab() {
			return appErr(
				appError("no-active-tab", "the options page does not save tabs"),
			);
		},
	};
}

/** Build the real {@link OptionsUseCases} for the extension options page. */
export function createRuntimeUseCases(): OptionsUseCases {
	const drive = createChromeDriveRuntime();
	const app = createBookmarkApp({
		repository: drive.repository,
		analyzer: createAnalyzerPort(createChromePromptClient()),
		extractor: createChromeScriptingExtractor(),
		tabs: createUnusedTabProvider(),
		cache: createChromeLocalCache(),
		clock: createSystemClock(),
		ids: createCryptoIdGenerator(),
	});
	return createOptionsUseCases(app);
}
