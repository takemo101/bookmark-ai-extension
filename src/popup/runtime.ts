/**
 * The popup composition root: build the real {@link PopupUseCases} for the
 * extension runtime.
 *
 * This is the one place adapters are wired, so the React component and controller
 * stay free of Chrome/Drive/AI imports. What can be wired now is wired now:
 *   - the local cache (`chrome.storage.local`);
 *   - the AI analyzer (Chrome Built-in AI / Prompt API), including its real
 *     availability probe for the badge;
 *   - the active-tab provider (`chrome.tabs`), used both to save and to show the
 *     receipt header;
 *   - the system clock and crypto id generator.
 *
 * ## MIK-009 seam (intentional, localized)
 *
 * Two ports require OAuth/Drive bootstrap and `chrome.scripting` page injection
 * that this issue does not own — {@link BookmarkRepositoryPort} and
 * {@link PageExtractorPort}. They are supplied here as clearly-named placeholders
 * that return typed, UI-safe errors. The use-case layer already degrades
 * correctly around them: a save still writes a pending bookmark to the local
 * cache and surfaces an honest "saved locally / analysis pending" receipt. When
 * MIK-009 lands the Drive repository and the scripting extractor, only these two
 * factories change; nothing in the controller or the React layer moves.
 */
import {
	type AppError,
	type BookmarkRepositoryPort,
	type PageExtractorPort,
	type TabProviderPort,
	appError,
	createAnalyzerPort,
	createBookmarkApp,
	createCryptoIdGenerator,
	createSystemClock,
	err as appErr,
	ok as appOk,
} from "../lib/app/index";
import { createChromePromptClient } from "../lib/ai/index";
import {
	type RepositoryError,
	type RepositorySnapshot,
	type Result as DriveResult,
	err as driveErr,
} from "../lib/drive/index";
import {
	type ExtractedPage,
	type ExtractionError,
	type Result as ExtractionResult,
	err as extractionErr,
} from "../lib/extraction/index";
import { createChromeLocalCache } from "../lib/storage/index";
import {
	type PopupEnvironmentProvider,
	type PopupUseCases,
	createPopupUseCases,
} from "./use-cases";

const PENDING_WIRING = "Drive sync and page analysis finish wiring in a later update.";

/** Placeholder Drive repository: typed `drive` errors until MIK-009 wires it. */
function createPendingRepository(): BookmarkRepositoryPort {
	const error: RepositoryError = { kind: "unknown", message: PENDING_WIRING };
	const fail = async (): Promise<DriveResult<never, RepositoryError>> =>
		driveErr(error);
	return {
		bootstrap: fail,
		load: fail,
		save: fail as () => Promise<DriveResult<RepositorySnapshot, RepositoryError>>,
	};
}

/** Placeholder page extractor: typed `extraction` errors until MIK-009 wires it. */
function createPendingExtractor(): PageExtractorPort {
	return {
		async extract(): Promise<ExtractionResult<ExtractedPage, ExtractionError>> {
			return extractionErr({ field: "page", message: PENDING_WIRING });
		},
	};
}

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
			const promptApi = await promptClient.availability();
			return {
				// Identity/connection wiring is part of the MIK-009 runtime work; until
				// then the badge reads "unknown" rather than guessing a state.
				connection: "unknown",
				promptApi,
			};
		},
	};
}

/** Build the real {@link PopupUseCases} for the extension popup. */
export function createRuntimeUseCases(): PopupUseCases {
	const tabs = createChromeTabProvider();
	const app = createBookmarkApp({
		repository: createPendingRepository(),
		analyzer: createAnalyzerPort(createChromePromptClient()),
		extractor: createPendingExtractor(),
		tabs,
		cache: createChromeLocalCache(),
		clock: createSystemClock(),
		ids: createCryptoIdGenerator(),
	});
	return createPopupUseCases(app, createChromeEnvironmentProvider(tabs));
}
