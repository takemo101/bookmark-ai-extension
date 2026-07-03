/**
 * Shared English/Japanese language selection (MIK-029).
 *
 * One small, dependency-free contract for every layer that needs a language:
 *   - the UI (Popup/Options dictionaries) resolves its display language from
 *     the browser UI language;
 *   - the AI analyzer infers the analysis *output* language from the page's
 *     own text, falling back to the UI/browser language, then Japanese.
 *
 * Everything here is pure and deterministic except {@link detectUiLanguage},
 * which reads the browser globals defensively (absent in Node tests) and is a
 * thin wrapper over the pure {@link resolveUiLanguage}. No Chrome, Drive, AI,
 * or React imports — see docs/design.md "AI Design" and "UI language".
 */

/** The only languages the MVP supports. Japanese remains the final fallback. */
export type SupportedLanguage = "ja" | "en";

/** The final fallback when nothing else resolves a language. */
export const DEFAULT_LANGUAGE: SupportedLanguage = "ja";

/**
 * Normalize one BCP 47-ish language tag (`ja`, `ja-JP`, `en`, `en-US`, …)
 * onto a {@link SupportedLanguage}, or `undefined` for anything else. Only the
 * primary subtag is considered.
 */
export function normalizeLanguageTag(
	tag: string | undefined | null,
): SupportedLanguage | undefined {
	if (!tag) {
		return undefined;
	}
	const primary = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
	if (primary === "ja") {
		return "ja";
	}
	if (primary === "en") {
		return "en";
	}
	return undefined;
}

/**
 * Resolve a UI language from an ordered list of candidate tags: the first tag
 * that normalizes wins; with none, Japanese (the documented fallback).
 * Pure, so tests can drive it with any tag combination.
 */
export function resolveUiLanguage(
	tags: readonly (string | undefined | null)[],
): SupportedLanguage {
	for (const tag of tags) {
		const normalized = normalizeLanguageTag(tag);
		if (normalized) {
			return normalized;
		}
	}
	return DEFAULT_LANGUAGE;
}

/**
 * Read the browser UI language: `chrome.i18n.getUILanguage()` when the
 * extension runtime provides it, then `navigator.language`, then Japanese.
 * Both globals are read defensively so this never throws outside Chrome
 * (Node tests, a standalone page).
 */
export function detectUiLanguage(): SupportedLanguage {
	const scope = globalThis as {
		chrome?: { i18n?: { getUILanguage?: () => string } };
		navigator?: { language?: string };
	};
	let chromeTag: string | undefined;
	try {
		chromeTag = scope.chrome?.i18n?.getUILanguage?.();
	} catch {
		chromeTag = undefined;
	}
	return resolveUiLanguage([chromeTag, scope.navigator?.language]);
}

/** Only a bounded prefix of the page text feeds the inference (design cap). */
const INFERENCE_SAMPLE_CHARS = 1200;

/** Below this many script characters the text carries no clear signal. */
const MIN_SIGNAL_CHARS = 10;

/** At or above this Japanese-script share the page is clearly Japanese. */
const CLEAR_JAPANESE_SHARE = 0.3;

/** At or below this Japanese-script share the page is clearly English. */
const CLEAR_ENGLISH_SHARE = 0.05;

/** Hiragana, katakana (incl. halfwidth and extensions), and CJK ideographs. */
const JAPANESE_SCRIPT = /[぀-ヿㇰ-ㇿｦ-ﾟ一-鿿]/g;

const LATIN_LETTERS = /[a-z]/gi;

function countMatches(text: string, pattern: RegExp): number {
	return text.match(pattern)?.length ?? 0;
}

/**
 * Infer the AI output language from page text (title + excerpt prefix) with a
 * deterministic script-count heuristic:
 *   - a clear Japanese-script presence chooses `ja`;
 *   - an essentially Latin-only text chooses `en`;
 *   - anything mixed/ambiguous (or too short to judge) uses `fallback`.
 * The text is never stored; it is the same transient AI input the analyzer
 * already holds (docs/privacy-policy.md "Page Text Excerpts").
 */
export function inferOutputLanguage(
	text: string,
	fallback: SupportedLanguage = DEFAULT_LANGUAGE,
): SupportedLanguage {
	const sample = text.slice(0, INFERENCE_SAMPLE_CHARS);
	const japanese = countMatches(sample, JAPANESE_SCRIPT);
	const latin = countMatches(sample, LATIN_LETTERS);
	const total = japanese + latin;
	if (total < MIN_SIGNAL_CHARS) {
		return fallback;
	}
	const japaneseShare = japanese / total;
	if (japaneseShare >= CLEAR_JAPANESE_SHARE) {
		return "ja";
	}
	if (japaneseShare <= CLEAR_ENGLISH_SHARE) {
		return "en";
	}
	return fallback;
}
