/**
 * Small, Chrome-free default adapters for a few ports.
 *
 * These wire ports to dependencies that are *not* browser-specific (the AI
 * analyzer talks to its own injectable {@link PromptClient}; the clock and id
 * generator use standard `Date`/`crypto` available in both Node and the
 * extension). The genuinely Chrome-bound adapters — active-tab resolution and
 * page extraction via `chrome.scripting` — belong with the popup/options UI
 * wiring and are intentionally not implemented here (this issue ships no React
 * and no Chrome glue). The local-cache adapter lives in `storage/*`.
 */
import { bookmarkId, isoTimestampFromDate } from "../bookmarks/index";
import { type PromptClient, analyzePage, toAnalysisProfile } from "../ai/index";
import { skillId } from "../settings/index";
import type { SettingsCache } from "../storage/settings-local-cache";
import type {
	AnalyzerPort,
	Clock,
	IdGenerator,
	SettingsProviderPort,
} from "./ports";
import type { SkillIdGenerator } from "./settings-app";

/** Adapt the AI module's {@link analyzePage} into an {@link AnalyzerPort}. */
export function createAnalyzerPort(client: PromptClient): AnalyzerPort {
	return {
		analyze(input, customProfiles) {
			return analyzePage(client, input, customProfiles);
		},
	};
}

/**
 * Adapt a {@link SettingsCache} into a {@link SettingsProviderPort}: a fast
 * local-cache read (never a Drive round-trip), so wiring this into a save flow
 * never adds Drive latency to saving/re-analyzing a bookmark. Any cache read
 * failure degrades to `[]` — the built-ins still apply.
 */
export function createSettingsProviderPort(
	cache: SettingsCache,
): SettingsProviderPort {
	return {
		async currentCustomProfiles() {
			try {
				const state = await cache.load();
				return state.settings.enabledSkills().map(toAnalysisProfile);
			} catch {
				return [];
			}
		},
	};
}

/** A {@link Clock} backed by the system clock. */
export function createSystemClock(): Clock {
	return {
		now() {
			return isoTimestampFromDate(new Date());
		},
	};
}

/** An {@link IdGenerator} backed by `crypto.randomUUID()`. */
export function createCryptoIdGenerator(): IdGenerator {
	return {
		next() {
			return bookmarkId(crypto.randomUUID());
		},
	};
}

/** A {@link SkillIdGenerator} backed by `crypto.randomUUID()`. */
export function createCryptoSkillIdGenerator(): SkillIdGenerator {
	return {
		next() {
			return skillId(crypto.randomUUID());
		},
	};
}
