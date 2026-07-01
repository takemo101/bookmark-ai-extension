/**
 * Chrome `scripting` page-extraction adapter.
 *
 * Implements the app's {@link PageExtractorPort} for the real extension by
 * injecting the self-contained {@link extractPageContent} function into a tab via
 * `chrome.scripting.executeScript` and parsing the untrusted result through
 * {@link parseExtractedPage} at the boundary. This is the only Chrome glue for
 * extraction; the algorithm itself lives in `extraction/*` and is never
 * duplicated here.
 *
 * Permission posture (docs/design.md "Save Flow"; AGENTS.md security rules): the
 * page is touched only via `activeTab` + `scripting`, and only after the user's
 * Save/Re-analyze gesture. No always-on content script, no `tabs` permission, no
 * broad host access is used:
 *   - Save passes the active tab's `tabId`, so injection targets exactly that
 *     user-chosen tab.
 *   - Re-analyze has no `tabId`; it injects only when the *active* tab's URL
 *     matches the record being re-analyzed (so it still rides the activeTab
 *     grant). Otherwise it returns a typed extraction error rather than reaching
 *     for a tab the extension was not granted.
 *
 * Raw page text is never persisted here — the parsed {@link ExtractedPage} flows
 * straight to the excerpt builder and AI input (docs/privacy-policy.md).
 */
import type { ExtractionTarget, PageExtractorPort } from "../app/index";
import {
	type ExtractedPage,
	type ExtractionError,
	type Result as ExtractionResult,
	err as extractionErr,
	extractPageContent,
	parseExtractedPage,
} from "../extraction/index";
import type { RawExtractedPage } from "../extraction/types";

/**
 * The narrow slice of `chrome.scripting` the adapter uses, declared as a port so
 * the adapter is unit-testable with a fake and never depends on the ambient
 * `chrome` global at the type level.
 */
export interface ScriptInjector {
	executeScript(args: {
		target: { tabId: number };
		func: () => RawExtractedPage;
	}): Promise<ReadonlyArray<{ result?: RawExtractedPage | null }>>;
}

/** Resolves the active tab's id/url, or `undefined` when there is none. */
export type ActiveTabResolver = () => Promise<
	{ id?: number; url?: string } | undefined
>;

export type ChromeExtractorDeps = {
	/** Defaults to `chrome.scripting`. */
	scripting?: ScriptInjector;
	/** Defaults to `chrome.tabs.query({ active, currentWindow })`. */
	resolveActiveTab?: ActiveTabResolver;
};

type ChromeGlobal = {
	scripting?: ScriptInjector;
	tabs?: {
		query(info: {
			active?: boolean;
			currentWindow?: boolean;
		}): Promise<ReadonlyArray<{ id?: number; url?: string }>>;
	};
};

function resolveChrome(): ChromeGlobal | undefined {
	return (globalThis as { chrome?: ChromeGlobal }).chrome;
}

function defaultResolveActiveTab(): ActiveTabResolver {
	return async () => {
		const tabs = resolveChrome()?.tabs;
		if (!tabs) {
			return undefined;
		}
		const [tab] = await tabs.query({ active: true, currentWindow: true });
		return tab;
	};
}

/**
 * Build a {@link PageExtractorPort} backed by `chrome.scripting`. Dependencies
 * are injected for tests; in the extension they default to the live globals.
 */
export function createChromeScriptingExtractor(
	deps: ChromeExtractorDeps = {},
): PageExtractorPort {
	const scripting = deps.scripting ?? resolveChrome()?.scripting;
	const resolveActiveTab = deps.resolveActiveTab ?? defaultResolveActiveTab();

	/**
	 * Pick the tab to inject into without ever exceeding the activeTab grant: the
	 * explicit save target, else the active tab when its URL matches the record.
	 */
	async function resolveTabId(
		target: ExtractionTarget,
	): Promise<number | { error: ExtractionError }> {
		if (target.tabId !== undefined) {
			return target.tabId;
		}
		const active = await resolveActiveTab();
		if (active?.id !== undefined && active.url === target.url) {
			return active.id;
		}
		return {
			error: {
				field: "tab",
				message: "Open the page in the active tab to re-analyze it from here.",
			},
		};
	}

	return {
		async extract(
			target: ExtractionTarget,
		): Promise<ExtractionResult<ExtractedPage, ExtractionError>> {
			if (!scripting) {
				return extractionErr({
					field: "scripting",
					message: "chrome.scripting is unavailable",
				});
			}

			const resolved = await resolveTabId(target);
			if (typeof resolved !== "number") {
				return extractionErr(resolved.error);
			}

			let results: ReadonlyArray<{ result?: RawExtractedPage | null }>;
			try {
				results = await scripting.executeScript({
					target: { tabId: resolved },
					func: extractPageContent,
				});
			} catch {
				// activeTab not granted for this frame, a restricted page (chrome://,
				// the Web Store), or the tab closed mid-inject. Recoverable: keep the
				// bookmark and let the caller mark it for re-analysis.
				return extractionErr({
					field: "page",
					message: "Could not read this page's content.",
				});
			}

			const raw = results[0]?.result;
			if (raw === undefined || raw === null) {
				return extractionErr({
					field: "page",
					message: "The page returned no content to analyze.",
				});
			}

			// Parse at the boundary: untrusted in-page output becomes a trusted
			// ExtractedPage or a typed error, never raw text flowing inward.
			return parseExtractedPage(raw);
		},
	};
}
