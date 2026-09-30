import {
	type ActiveTab,
	createBookmarkApp,
	createCryptoIdGenerator,
	createSettingsProviderPort,
	createSystemClock,
	appError,
	err,
	ok,
} from "../lib/app/index";
import { detectUiLanguage } from "../lib/i18n/index";
import {
	createChromeDriveRuntime,
	createChromeScriptingExtractor,
} from "../lib/runtime/index";
import { createBackgroundAnalyzer } from "../lib/runtime/background-analyzer";
import {
	createChromeLocalCache,
	createChromeSettingsCache,
} from "../lib/storage/index";

/** Composition only: domain, Drive, extraction and AI rules stay in their ports. */
export function createWorkerBookmarkApp(tab?: ActiveTab) {
	return createBookmarkApp({
		repository: createChromeDriveRuntime().repository,
		analyzer: createBackgroundAnalyzer(),
		extractor: createChromeScriptingExtractor({
			resolveActiveTab: async () => tab,
		}),
		tabs: {
			activeTab: async () =>
				tab ? ok(tab) : err(appError("no-active-tab", "No selected tab.")),
		},
		cache: createChromeLocalCache(),
		clock: createSystemClock(),
		ids: createCryptoIdGenerator(),
		settingsProvider: createSettingsProviderPort(createChromeSettingsCache()),
		fallbackLanguage: detectUiLanguage(),
	});
}
