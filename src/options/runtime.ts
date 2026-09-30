/**
 * Options composition: bookmark mutations go through the same worker lock as
 * popup saves. Cache reads, Ask AI chat, and separately stored skill settings
 * remain local to this UI. React/controllers know none of these adapters.
 */
import {
	createCryptoSkillIdGenerator,
	createSettingsApp,
	createSystemClock,
} from "../lib/app/index";
import {
	createChromeAskAiPromptSessionFactory,
	createChromeAskAiRecommendationRunner,
} from "../lib/ai/index";
import { detectUiLanguage } from "../lib/i18n/index";
import { createConsoleLogger } from "../lib/logging/index";
import { createChromeDriveRuntime } from "../lib/runtime/index";
import { createBackgroundBookmarkClient } from "../lib/runtime/background-client";
import { createChromeTabProvider } from "../lib/runtime/chrome-tabs";
import {
	createChromeLocalCache,
	createChromeSettingsCache,
} from "../lib/storage/index";
import type { AskAiDeps } from "./ask-ai-view-model";
import { type OptionsUseCases, createOptionsUseCases } from "./use-cases";
import { type SkillsUseCases, createSkillsUseCases } from "./skills-use-cases";

/** Bookmark writes share the worker lock with popup saves; reads remain local. */
export function createRuntimeUseCases(): OptionsUseCases {
	return createOptionsUseCases(
		createBackgroundBookmarkClient({
			tabs: createChromeTabProvider(),
			cache: createChromeLocalCache(),
			send: (command) =>
				chrome.runtime.sendMessage({ action: "bookmark-job", ...command }),
		}),
	);
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
	const logger = createConsoleLogger();
	const run = createChromeAskAiRecommendationRunner(undefined, { logger });
	const createSession = createChromeAskAiPromptSessionFactory(undefined, {
		logger,
	});
	// The browser UI language decides both prompt and expected output language,
	// matching the analyzer's language posture (MIK-029).
	const language = detectUiLanguage();
	return {
		async loadBookmarks() {
			return (await cache.load()).bookmarks.toArray();
		},
		runKeywordExtractionPrompt(request, observer) {
			return run(request, language, observer);
		},
		runRecommendationPrompt(request, observer) {
			return run(request, language, observer);
		},
		createRecommendationSession(systemInstruction, observer) {
			return createSession(systemInstruction, language, observer);
		},
		logger,
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
