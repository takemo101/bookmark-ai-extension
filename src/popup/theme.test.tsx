import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	darkThemePalette,
	lightThemePalette,
	ThemeProvider,
	createThemeStore,
	type ThemeStore,
} from "../lib/theme/index";
import { Popup } from "./Popup";
import type { PopupController, PopupView } from "./view-model";

/**
 * Static-markup tests for the Popup theme behavior: the popup reflects the
 * saved/resolved theme (no selector of its own) — light Warm Library by
 * default, Deep Ledger surfaces when the stored preference resolves dark.
 */

function viewOf(overrides: Partial<PopupView> = {}): PopupView {
	return {
		loading: false,
		tab: { title: "Example Page", url: "https://example.test/page" },
		connection: "connected",
		promptApi: "available",
		sync: { status: "synced", pendingLocalChanges: false },
		flow: { kind: "idle" },
		recent: [],
		canSave: true,
		deleting: false,
		...overrides,
	};
}

function controllerOf(view: PopupView): PopupController {
	return {
		getView: () => view,
		subscribe: () => () => {},
		init: async () => {},
		refresh: async () => {},
		save: async () => {},
		reAnalyze: async () => {},
		deleteCurrentBookmark: async () => {},
		selectRecent: () => {},
		clearRecentSelection: () => {},
	};
}

/** A real theme store over in-memory fakes, initialized to `dark`. */
async function darkStore(): Promise<ThemeStore> {
	const store = createThemeStore({
		storage: { load: async () => "dark", save: async () => {} },
		systemDark: { prefersDark: () => false, subscribe: () => () => {} },
	});
	await store.init();
	return store;
}

describe("Popup theme rendering", () => {
	it("renders the receipt surface with the light Warm Library paper by default", () => {
		const html = renderToStaticMarkup(
			<Popup controller={controllerOf(viewOf())} language="en" />,
		);

		expect(html).toContain(lightThemePalette.paper);
		expect(html).not.toContain(darkThemePalette.paper);
	});

	it("renders Deep Ledger surfaces when the stored preference resolves dark", async () => {
		const store = await darkStore();
		const html = renderToStaticMarkup(
			<ThemeProvider store={store}>
				<Popup controller={controllerOf(viewOf())} language="en" />
			</ThemeProvider>,
		);

		// Receipt surface paper + ink, raised card, and accent action.
		expect(html).toContain(darkThemePalette.paper);
		expect(html).toContain(darkThemePalette.ink);
		expect(html).toContain(darkThemePalette.paperRaised);
		expect(html).toContain(darkThemePalette.accent);
		expect(html).not.toContain(lightThemePalette.paper);
	});

	it("exposes no theme selector — that lives in the Options app header", () => {
		const html = renderToStaticMarkup(
			<Popup controller={controllerOf(viewOf())} language="en" />,
		);

		expect(html).not.toContain("<select");
	});
});
