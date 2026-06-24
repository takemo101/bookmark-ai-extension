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
import { type PromptClient, analyzePage } from "../ai/index";
import type { AnalyzerPort, Clock, IdGenerator } from "./ports";

/** Adapt the AI module's {@link analyzePage} into an {@link AnalyzerPort}. */
export function createAnalyzerPort(client: PromptClient): AnalyzerPort {
	return {
		analyze(input) {
			return analyzePage(client, input);
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
