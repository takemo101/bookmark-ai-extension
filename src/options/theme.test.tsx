import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	darkThemePalette,
	lightThemePalette,
	ThemeProvider,
	type ThemePreference,
	createThemeStore,
	type ThemeStore,
} from "../lib/theme/index";
import { ThemeSelect } from "./components/ThemeSelect";
import { optionsMessages } from "./i18n";
import { Options } from "./Options";
import type { OptionsController, OptionsView, RowView } from "./view-model";

/**
 * Static-markup tests for the Options theme behavior: the app-header theme
 * selector and the Deep Ledger dark styling of representative surfaces.
 * Change-event dispatch needs a DOM, so — matching the project's node
 * static-rendering policy — the write path is covered through the theme
 * store (`store.setPreference` persists and the selector reflects the new
 * state on re-render) while the markup pins structure and colors.
 */

function rowOf(overrides: Partial<RowView> = {}): RowView {
	return {
		canonicalUrl: "https://example.test/x",
		url: "https://example.test/x",
		title: "Selected bookmark",
		summary: "短い説明",
		genre: "技術",
		tags: ["typescript"],
		aiStatus: "ready",
		updatedAt: "2026-03-02T00:00:00Z",
		selected: false,
		canReAnalyze: false,
		analysisProfileId: "github-repository",
		...overrides,
	};
}

function viewOf(overrides: Partial<OptionsView> = {}): OptionsView {
	return {
		loading: false,
		sync: {
			status: "synced",
			pendingLocalChanges: false,
			syncing: false,
			writing: false,
		},
		filters: { query: "" },
		facets: {
			genres: [],
			tags: [],
			statuses: ["ready", "pending", "unavailable", "failed"],
			domains: [],
		},
		rows: [],
		totalCount: 0,
		filteredCount: 0,
		empty: true,
		noMatches: false,
		busy: false,
		...overrides,
	};
}

function controllerOf(view: OptionsView): OptionsController {
	return {
		getView: () => view,
		subscribe: () => () => {},
		init: async () => {},
		refresh: async () => {},
		setQuery: () => {},
		setGenre: () => {},
		setTag: () => {},
		setStatus: () => {},
		setDomain: () => {},
		clearFilters: () => {},
		select: () => {},
		clearSelection: () => {},
		deleteBookmark: async () => {},
		reAnalyze: async () => {},
	};
}

/** A real theme store over in-memory fakes, initialized to `preference`. */
async function storeOf(preference: ThemePreference): Promise<{
	store: ThemeStore;
	saved: ThemePreference[];
}> {
	const saved: ThemePreference[] = [];
	let value: ThemePreference = preference;
	const store = createThemeStore({
		storage: {
			load: async () => value,
			save: async (next) => {
				value = next;
				saved.push(next);
			},
		},
		systemDark: { prefersDark: () => false, subscribe: () => () => {} },
	});
	await store.init();
	return { store, saved };
}

function render(view: OptionsView, store?: ThemeStore): string {
	const options = <Options controller={controllerOf(view)} language="en" />;
	return renderToStaticMarkup(
		store ? <ThemeProvider store={store}>{options}</ThemeProvider> : options,
	);
}

describe("Options app-header theme selector", () => {
	it("renders the labelled selector with the three preferences, defaulting to system", () => {
		const html = render(viewOf());

		expect(html).toContain('aria-label="Color theme"');
		expect(html).toContain(">Theme</label>");
		expect(html).toContain(
			'<option value="system" selected="">System</option>',
		);
		expect(html).toContain('<option value="light">Light</option>');
		expect(html).toContain('<option value="dark">Dark</option>');
	});

	it("localizes the selector labels in Japanese", () => {
		const html = renderToStaticMarkup(
			<Options controller={controllerOf(viewOf())} language="ja" />,
		);

		const m = optionsMessages("ja");
		expect(html).toContain(`aria-label="${m.themeSelectAria}"`);
		expect(html).toContain(`>${m.themeDark}</option>`);
	});

	it("reflects and persists a preference change through the theme store", async () => {
		const { store, saved } = await storeOf("system");

		await store.setPreference("dark");

		expect(saved).toEqual(["dark"]);
		const html = renderToStaticMarkup(
			<ThemeProvider store={store}>
				<ThemeSelect m={optionsMessages("en")} />
			</ThemeProvider>,
		);
		expect(html).toContain('<option value="dark" selected="">Dark</option>');
	});
});

describe("Options dark theme rendering", () => {
	it("renders the page frame with the light Warm Library paper by default", () => {
		const html = render(viewOf());

		expect(html).toContain(lightThemePalette.paper);
		expect(html).not.toContain(darkThemePalette.paper);
	});

	it("renders the page frame and surfaces with Deep Ledger colors when dark", async () => {
		const { store } = await storeOf("dark");
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
			store,
		);

		// Page frame paper + ink.
		expect(html).toContain(darkThemePalette.paper);
		expect(html).toContain(darkThemePalette.ink);
		// Representative surfaces: raised ledger row/panel and hairline border.
		expect(html).toContain(darkThemePalette.paperRaised);
		expect(html).toContain(darkThemePalette.border);
		expect(html).not.toContain(lightThemePalette.paper);
	});
});
