/**
 * The options composition root: build the real {@link OptionsUseCases} and
 * {@link SkillsUseCases} for the extension runtime.
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
 *   - the system clock and crypto id generator;
 *   - `bookmark-ai/settings.json`'s Drive repository and its own
 *     `chrome.storage.local` cache (MIK-018), shared between the re-analyze
 *     flow's `settingsProvider` port and the "Analysis skills" panel's CRUD
 *     use cases.
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
 * {@link OptionsUseCases}/{@link SkillsUseCases}, and the runtime adapters are
 * tested directly with fake chrome/fetch dependencies in `runtime/*` and
 * `storage/*`.
 */
import {
	type TabProviderPort,
	appError,
	createAnalyzerPort,
	createBookmarkApp,
	createCryptoIdGenerator,
	createCryptoSkillIdGenerator,
	createSettingsApp,
	createSettingsProviderPort,
	createSystemClock,
	err as appErr,
} from "../lib/app/index";
import {
	createChromeAskAiPromptSessionFactory,
	createChromeAskAiRecommendationRunner,
	createChromePromptClient,
} from "../lib/ai/index";
import { detectUiLanguage } from "../lib/i18n/index";
import {
	createChromeDriveRuntime,
	createChromeScriptingExtractor,
} from "../lib/runtime/index";
import {
	createChromeLocalCache,
	createChromeSettingsCache,
} from "../lib/storage/index";
import type { AskAiDeps } from "./ask-ai-view-model";
import { type OptionsUseCases, createOptionsUseCases } from "./use-cases";
import { type SkillsUseCases, createSkillsUseCases } from "./skills-use-cases";

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
	const settingsCache = createChromeSettingsCache();
	const app = createBookmarkApp({
		repository: drive.repository,
		analyzer: createAnalyzerPort(createChromePromptClient()),
		extractor: createChromeScriptingExtractor(),
		tabs: createUnusedTabProvider(),
		cache: createChromeLocalCache(),
		clock: createSystemClock(),
		ids: createCryptoIdGenerator(),
		settingsProvider: createSettingsProviderPort(settingsCache),
		// The current browser UI language: the analyzer's output language
		// (MIK-033).
		fallbackLanguage: detectUiLanguage(),
	});
	return createOptionsUseCases(app);
}

/**
 * Build the real {@link AskAiDeps} for the "Ask AI" screen (MIK-046, MIK-048).
 * The bookmark source is a plain `chrome.storage.local` cache read —
 * submitting a question never triggers a Drive pull, and the full cached
 * collection is used regardless of any Library filters. Keyword extraction
 * (MIK-047, built from the question and language only) runs per turn through
 * the one-shot Prompt API runner. Recommendation prompts prefer the volatile
 * chat session (MIK-048): one browser Prompt API session per Ask AI chat
 * session, created with the recommendation prompt's own system instruction and
 * destroyed by the controller on clear; when the session cannot be opened, the
 * controller degrades to the same one-shot runner per turn. A throw anywhere
 * makes the controller fall back to direct scoring / local fallback cards.
 * Nothing here can persist the chat, the session, or the extracted keywords.
 */
export function createRuntimeAskAiDeps(): AskAiDeps {
	const cache = createChromeLocalCache();
	const run = createChromeAskAiRecommendationRunner();
	const createSession = createChromeAskAiPromptSessionFactory();
	// The browser UI language decides both prompt and expected output language,
	// matching the analyzer's language posture (MIK-029).
	const language = detectUiLanguage();
	return {
		async loadBookmarks() {
			return (await cache.load()).bookmarks.toArray();
		},
		runKeywordExtractionPrompt(request) {
			return run(request, language);
		},
		runRecommendationPrompt(request) {
			return run(request, language);
		},
		createRecommendationSession(systemInstruction) {
			return createSession(systemInstruction, language);
		},
		language,
	};
}

/** Build the real {@link SkillsUseCases} for the options "Analysis skills" panel. */
export function createRuntimeSkillsUseCases(): SkillsUseCases {
	const drive = createChromeDriveRuntime();
	const settingsApp = createSettingsApp({
		repository: drive.settingsRepository,
		cache: createChromeSettingsCache(),
		clock: createSystemClock(),
		ids: createCryptoSkillIdGenerator(),
	});
	return createSkillsUseCases(settingsApp);
}
