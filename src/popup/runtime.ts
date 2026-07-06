/**
 * The popup composition root: build the real {@link PopupUseCases} for the
 * extension runtime.
 *
 * This is the one place adapters are wired, so the React component and controller
 * stay free of Chrome/Drive/AI imports. Every port is now backed by a real
 * adapter:
 *   - the Drive repository (chrome.identity → Drive REST client → conflict-safe
 *     {@link DriveBookmarkRepository}), assembled by `runtime/*`;
 *   - the page extractor (`chrome.scripting`, injected only after the user's Save
 *     gesture into the active tab);
 *   - the local cache (`chrome.storage.local`);
 *   - the AI analyzer (Chrome Built-in AI / Prompt API), including its real
 *     availability probe for the badge;
 *   - the active-tab provider (`chrome.tabs`), used both to save and to show the
 *     receipt header, plus a non-interactive connection probe for the badge;
 *   - the system clock and crypto id generator.
 *
 * Tests never reach this module: the popup controller is exercised with a fake
 * {@link PopupUseCases}, and the runtime adapters are tested directly with fake
 * chrome/fetch dependencies in `runtime/*` and `storage/*`.
 */

import { createChromePromptClient } from "../lib/ai/index";
import {
	type AppError,
	err as appErr,
	appError,
	ok as appOk,
	createAnalyzerPort,
	createBookmarkApp,
	createCryptoIdGenerator,
	createSettingsProviderPort,
	createSystemClock,
	type TabProviderPort,
} from "../lib/app/index";
import { detectUiLanguage } from "../lib/i18n/index";
import { createConsoleLogger } from "../lib/logging/index";
import {
	createChromeDriveRuntime,
	createChromeScriptingExtractor,
} from "../lib/runtime/index";
import {
	createChromeLocalCache,
	createChromeSettingsCache,
} from "../lib/storage/index";
import {
	createPopupUseCases,
	type PopupEnvironmentProvider,
	type PopupUseCases,
} from "./use-cases";

/** Active-tab provider backed by `chrome.tabs`. */
function createChromeTabProvider(): TabProviderPort {
	return {
		async activeTab() {
			try {
				const [tab] = await chrome.tabs.query({
					active: true,
					currentWindow: true,
				});
				if (!tab || tab.id === undefined || !tab.url) {
					return appErr(appError("no-active-tab", "no active tab to save"));
				}
				return appOk({
					id: tab.id,
					url: tab.url,
					title: tab.title ?? tab.url,
				});
			} catch (cause) {
				return appErr(
					appError("no-active-tab", "could not read the active tab", {
						detail: cause instanceof Error ? cause.name : undefined,
					}),
				);
			}
		},
	};
}

/** Environment provider: current tab for the header, plus the status badges. */
function createChromeEnvironmentProvider(
	tabs: TabProviderPort,
	probeConnection: () => Promise<"connected" | "disconnected">,
): PopupEnvironmentProvider {
	const promptClient = createChromePromptClient();
	return {
		async currentTab() {
			const result = await tabs.activeTab();
			if (!result.ok) {
				return result as { ok: false; error: AppError };
			}
			return appOk({ title: result.value.title, url: result.value.url });
		},
		async environment() {
			// Probe identity (non-interactive) and Prompt API independently so a
			// disconnected account never blocks the AI badge and vice versa. The
			// probe requests the UI language's expected outputs — the analysis
			// output language for this user (MIK-033).
			const [connection, promptApi] = await Promise.all([
				probeConnection(),
				promptClient.availability(detectUiLanguage()),
			]);
			return { connection, promptApi };
		},
	};
}

/** Build the real {@link PopupUseCases} for the extension popup. */
export function createRuntimeUseCases(): PopupUseCases {
	const tabs = createChromeTabProvider();
	const drive = createChromeDriveRuntime();
	const logger = createConsoleLogger();
	const app = createBookmarkApp({
		repository: drive.repository,
		analyzer: createAnalyzerPort(createChromePromptClient(), { logger }),
		extractor: createChromeScriptingExtractor(),
		tabs,
		cache: createChromeLocalCache(),
		clock: createSystemClock(),
		ids: createCryptoIdGenerator(),
		// A fast local-cache read of `bookmark-ai/settings.json`'s custom skills
		// (MIK-018), never a Drive round-trip, so saving from the popup gains no
		// extra latency (docs/ai-analysis-v2.md "Settings file").
		settingsProvider: createSettingsProviderPort(createChromeSettingsCache()),
		// The current browser UI language: the analyzer's output language
		// (MIK-033).
		fallbackLanguage: detectUiLanguage(),
	});
	return createPopupUseCases(
		app,
		createChromeEnvironmentProvider(tabs, () => drive.probeConnection()),
	);
}
