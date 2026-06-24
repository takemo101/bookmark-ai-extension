/**
 * The options composition root: build the real {@link OptionsUseCases} for the
 * extension runtime.
 *
 * This is the one place adapters are wired, so the React component and controller
 * stay free of Chrome/Drive/AI imports. What can be wired now is wired now:
 *   - the local cache (`chrome.storage.local`) — the ledger's render source;
 *   - the AI analyzer (Chrome Built-in AI / Prompt API) for re-analyze;
 *   - the system clock and crypto id generator.
 *
 * ## MIK-009 seam (intentional, localized)
 *
 * Two ports require OAuth/Drive bootstrap and `chrome.scripting` page injection
 * that this issue does not own — {@link BookmarkRepositoryPort} and
 * {@link PageExtractorPort}. They are supplied here as clearly-named placeholders
 * that return typed, UI-safe errors. The use-case layer already degrades
 * correctly around them: the cached list still renders, sync surfaces an honest
 * error badge, and re-analyze marks the record `failed` with a safe message.
 * When MIK-009 lands the Drive repository and the scripting extractor, only these
 * factories change; nothing in the controller or the React layer moves.
 *
 * The options page never saves the current tab, so the required {@link
 * TabProviderPort} is a typed placeholder too.
 */
import {
	type BookmarkRepositoryPort,
	type PageExtractorPort,
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
import { type OptionsUseCases, createOptionsUseCases } from "./use-cases";

const PENDING_WIRING =
	"Drive sync and page analysis finish wiring in a later update.";

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
	const app = createBookmarkApp({
		repository: createPendingRepository(),
		analyzer: createAnalyzerPort(createChromePromptClient()),
		extractor: createPendingExtractor(),
		tabs: createUnusedTabProvider(),
		cache: createChromeLocalCache(),
		clock: createSystemClock(),
		ids: createCryptoIdGenerator(),
	});
	return createOptionsUseCases(app);
}
