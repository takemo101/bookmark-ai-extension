import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type {
	AskAiChatMessage,
	AskAiController,
	AskAiResultView,
	AskAiView,
} from "./ask-ai-view-model";
import type { OptionsScreen } from "./Options";
import {
	askAiDistanceFromBottom,
	askAiLatestButtonVisible,
	askAiShouldAutoFollow,
	lockScroll,
	Options,
	syncHubSummaryKind,
	visibleFacetValues,
} from "./Options";
import type { SkillsController, SkillsView } from "./skills-view-model";
import type {
	DetailView,
	OptionsController,
	OptionsView,
	RowView,
} from "./view-model";

/**
 * Static-markup tests for the MIK-022 detail sheet, the MIK-024 list polish,
 * and the MIK-025 screens: the component is rendered with fake controllers
 * and fixed views, no DOM or Chrome required. Event behavior (Escape,
 * backdrop click, quick delete stopPropagation, nav clicks) lives in handlers
 * the controller tests cover indirectly; here we pin the rendered structure —
 * the sheet carries dialog semantics without a Re-analyze action, rows carry
 * a quick delete button, growable facets cap their expanded chip lists, facet
 * groups collapse behind aria-expanded headers with active-filter summaries
 * (MIK-035), bookmark Drive sync and analysis settings sync live in one shared
 * app-header sync hub instead of per-screen rail panels and floating buttons
 * (MIK-051), and the Analysis skills settings screen renders separately from
 * the ledger with a modal skill form and the same rail/main workspace body as
 * the Library (MIK-038). Screen
 * switching is exercised through the `initialScreen` prop because static
 * rendering cannot dispatch clicks. The scroll-lock and tag-cap logic are
 * unit-tested via their exported helpers because tests run in node, not
 * jsdom.
 */

function detailOf(overrides: Partial<DetailView> = {}): DetailView {
	return {
		canonicalUrl: "https://example.test/x",
		title: "Selected bookmark",
		url: "https://example.test/x",
		description: "短い説明",
		genre: "技術",
		tags: ["typescript"],
		aiStatus: "ready",
		createdAt: "2026-03-01T00:00:00Z",
		updatedAt: "2026-03-02T00:00:00Z",
		lastAnalyzedAt: "2026-03-02T00:00:00Z",
		canReAnalyze: false,
		analysisMarkdown: "## 概要\n\n分析本文。",
		analysisProfileId: "github-repository",
		...overrides,
	};
}

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

// Language is injected explicitly (MIK-029) so the assertions never depend on
// the test environment's own UI language.
function render(view: OptionsView, language: "en" | "ja" = "en"): string {
	return renderToStaticMarkup(
		<Options controller={controllerOf(view)} language={language} />,
	);
}

function skillsViewOf(overrides: Partial<SkillsView> = {}): SkillsView {
	return {
		loading: false,
		busy: false,
		sync: {
			status: "synced",
			pendingLocalChanges: false,
			syncing: false,
			writing: false,
		},
		builtIns: [
			{
				id: "github-repository",
				name: "GitHub repository",
				priority: 30,
				urlPatterns: ["github.com/*"],
			},
		],
		custom: [],
		formOpen: false,
		form: {
			name: "",
			priority: "10",
			domains: "",
			urlPatterns: "",
			instruction: "",
		},
		...overrides,
	};
}

function skillsControllerOf(view: SkillsView): SkillsController {
	return {
		getView: () => view,
		subscribe: () => () => {},
		init: async () => {},
		refresh: async () => {},
		startCreate: () => {},
		startEdit: () => {},
		cancelEdit: () => {},
		setFormField: () => {},
		submit: async () => {},
		remove: async () => {},
		setEnabled: async () => {},
	};
}

function renderWithSkills(
	view: OptionsView,
	skillsView: SkillsView,
	initialScreen: OptionsScreen = "library",
	language: "en" | "ja" = "en",
): string {
	return renderToStaticMarkup(
		<Options
			controller={controllerOf(view)}
			skillsController={skillsControllerOf(skillsView)}
			initialScreen={initialScreen}
			language={language}
		/>,
	);
}

function askAiViewOf(overrides: Partial<AskAiView> = {}): AskAiView {
	return {
		question: "",
		canSubmit: false,
		answering: false,
		messages: [],
		canClear: false,
		...overrides,
	};
}

function askAiControllerOf(view: AskAiView): AskAiController {
	return {
		getView: () => view,
		subscribe: () => () => {},
		setQuestion: () => {},
		useExample: () => {},
		submit: async () => {},
		clearSession: () => {},
	};
}

// All three controllers injected, mirroring the runtime composition root.
function renderWithAskAi(
	view: OptionsView,
	askAiView: AskAiView,
	initialScreen: OptionsScreen = "library",
	language: "en" | "ja" = "en",
): string {
	return renderToStaticMarkup(
		<Options
			controller={controllerOf(view)}
			skillsController={skillsControllerOf(skillsViewOf())}
			askAiController={askAiControllerOf(askAiView)}
			initialScreen={initialScreen}
			language={language}
		/>,
	);
}

describe("Options bookmark favicons (MIK-032)", () => {
	afterEach(() => {
		delete (globalThis as { chrome?: unknown }).chrome;
	});

	function stubChromeRuntime(): void {
		(globalThis as { chrome?: unknown }).chrome = {
			runtime: {
				getURL: (path: string) => `chrome-extension://test-ext${path}`,
			},
		};
	}

	const populatedView = viewOf({
		rows: [rowOf({ selected: true })],
		totalCount: 1,
		filteredCount: 1,
		empty: false,
		selected: detailOf(),
	});

	it("shows the fallback hostname initial off-extension in rows and detail", () => {
		const html = render(populatedView);

		// example.test → "E", once per row and once in the detail sheet header.
		expect(html.match(/>E</g)).toHaveLength(2);
		expect(html).not.toContain("_favicon");
	});

	it("shows _favicon images for rows and detail when Chrome resolves them", () => {
		stubChromeRuntime();

		const html = render(populatedView);

		// Row (size 22) and detail header (size 28) both hit the local endpoint
		// with the encoded bookmark URL; the images stay decorative.
		expect(html).toContain(
			"chrome-extension://test-ext/_favicon/?pageUrl=https%3A%2F%2Fexample.test%2Fx&amp;size=22",
		);
		expect(html).toContain(
			"chrome-extension://test-ext/_favicon/?pageUrl=https%3A%2F%2Fexample.test%2Fx&amp;size=28",
		);
		expect(html).toContain('alt=""');
		expect(html).not.toContain(">E<");
	});

	it("looks up row favicons by the original URL, not the canonical URL (MIK-034)", () => {
		stubChromeRuntime();

		// Canonicalization strips `www.`, tracking params, and the trailing
		// slash; Chrome's _favicon endpoint knows the visited original.
		const html = render(
			viewOf({
				rows: [
					rowOf({
						url: "https://www.apple.com/jp/?utm_source=test",
						canonicalUrl: "https://apple.com/jp",
					}),
				],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
		);

		expect(html).toContain(
			"chrome-extension://test-ext/_favicon/?pageUrl=https%3A%2F%2Fwww.apple.com%2Fjp%2F%3Futm_source%3Dtest&amp;size=22",
		);
		expect(html).not.toContain("pageUrl=https%3A%2F%2Fapple.com%2Fjp");
	});
});

describe("Options detail sheet", () => {
	it("renders no dialog and no legacy detail pane when nothing is selected", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
		);

		expect(html).not.toContain('role="dialog"');
		expect(html).not.toContain("Select a bookmark to see its details.");
	});

	it("renders the selected bookmark as a modal side sheet with full detail", () => {
		const html = render(
			viewOf({
				rows: [rowOf({ selected: true })],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				selected: detailOf(),
			}),
		);

		expect(html).toContain('role="dialog"');
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain('aria-labelledby="bookmark-detail-title"');
		expect(html).toContain("Selected bookmark");
		// Full analysisMarkdown rendered through react-markdown, not as raw text.
		expect(html).toContain("<h2");
		expect(html).toContain("概要");
		expect(html).toContain("分析本文。");
		expect(html).toContain("github-repository");
		expect(html).toContain(">Close<");
		// The open row is highlighted via the selected state.
		expect(html).toContain('aria-expanded="true"');
	});

	it("offers only Open/Delete/Close — never Re-analyze (MIK-024)", () => {
		const html = render(
			viewOf({
				rows: [rowOf({ selected: true, canReAnalyze: true })],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				selected: detailOf({ aiStatus: "failed", canReAnalyze: true }),
			}),
		);

		expect(html).toContain(">Open<");
		expect(html).toContain(">Delete<");
		expect(html).toContain(">Close<");
		expect(html).not.toContain("Re-analyze");
		expect(html).not.toContain("Analyzing…");
	});

	it("keeps Open/Close while disabling Delete and warns during a busy action", () => {
		const html = render(
			viewOf({
				rows: [rowOf({ selected: true })],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				busy: true,
				selected: detailOf(),
			}),
		);

		expect(html).toContain("Working — keep this page open until it finishes.");
		expect(html).toContain("disabled");
		expect(html).toContain(">Open<");
		expect(html).toContain(">Close<");
	});
});

describe("Options scroll lock (MIK-024)", () => {
	it("hides overflow while locked and restores the previous value on unlock", () => {
		const body = { style: { overflow: "scroll" } };

		const restore = lockScroll(body);
		expect(body.style.overflow).toBe("hidden");

		restore();
		expect(body.style.overflow).toBe("scroll");
	});
});

describe("Options row quick delete (MIK-024)", () => {
	it("renders a quick delete button on each row", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
		);

		expect(html).toContain('aria-label="Delete Selected bookmark"');
		expect(html).not.toContain("disabled");
	});

	it("disables quick delete while an action is busy", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				busy: true,
			}),
		);

		expect(html).toContain('aria-label="Delete Selected bookmark"');
		expect(html).toContain("disabled");
	});
});

describe("Options facet cap (MIK-024)", () => {
	// The capped-list render behavior of an expanded growable facet is pinned
	// through the Domain group (open by default, MIK-035) in the MIK-028 block;
	// the shared cap logic itself stays unit-tested here.
	const manyTags = Array.from(
		{ length: 20 },
		(_, i) => `tag-${String(i + 1).padStart(2, "0")}`,
	);

	it("shows every domain with no toggle when the list fits the cap", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				facets: {
					genres: [],
					tags: [],
					statuses: ["ready", "pending", "unavailable", "failed"],
					domains: ["a.test", "b.test", "c.test", "d.test", "e.test"],
				},
			}),
		);

		expect(html).toContain(">e.test<");
		expect(html).not.toContain("Show all");
	});

	it("returns the full list when expanded (visibleFacetValues)", () => {
		expect(visibleFacetValues(manyTags, undefined, true)).toEqual(manyTags);
		expect(visibleFacetValues(manyTags, undefined, false)).toHaveLength(12);
		expect(visibleFacetValues(manyTags, "tag-20", false)).toContain("tag-20");
	});
});

describe("Options collapsible facet groups (MIK-035)", () => {
	const manyTags = Array.from(
		{ length: 20 },
		(_, i) => `tag-${String(i + 1).padStart(2, "0")}`,
	);
	const facets = {
		genres: ["技術"],
		tags: manyTags,
		statuses: ["ready", "pending", "unavailable", "failed"] as const,
		domains: ["example.test", "github.com"],
	};

	// No rows: the row open button also renders aria-expanded, so an empty
	// list keeps the aria-expanded counts pinned to the four facet headers.
	const baseView = (overrides: Partial<OptionsView> = {}) =>
		viewOf({
			rows: [],
			totalCount: 1,
			filteredCount: 0,
			empty: false,
			noMatches: true,
			facets,
			...overrides,
		});

	it("defaults Domain/Genre open and Tags/AI status collapsed with counts", () => {
		const html = render(baseView());

		// Domain and Genre bodies render their chips.
		expect(html).toContain(">example.test<");
		expect(html).toContain(">技術<");
		// Tags and AI status stay collapsed: no chips, only header counts.
		expect(html).not.toContain("#tag-01");
		expect(html).not.toContain("Show all 20 tags");
		expect(html).toContain("20 options");
		expect(html).toContain("4 options");
		// The four group headers carry the expanded state, plus the closed
		// Library help trigger (MIK-053) on the false side.
		expect(html.match(/aria-expanded="true"/g)).toHaveLength(2);
		expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
	});

	it("keeps the active tag visible as a header summary while collapsed", () => {
		const html = render(baseView({ filters: { query: "", tag: "tag-20" } }));

		// The summary chip is the only #tag-20 occurrence — the body stays closed.
		expect(html.match(/#tag-20/g)).toHaveLength(1);
		expect(html).not.toContain("#tag-01");
		expect(html).not.toContain("Show all 20 tags");
		// Clear filters stays reachable next to the search box.
		expect(html).toContain("Clear filters");
	});

	it("keeps the active AI status visible as a header summary while collapsed", () => {
		const html = render(
			baseView({ filters: { query: "", aiStatus: "failed" } }),
		);

		// No rows and a collapsed body: the only ">failed<" is the summary chip.
		expect(html.match(/>failed</g)).toHaveLength(1);
		expect(html).toContain("Clear filters");
	});

	it("localizes the collapsed option count for the ja language", () => {
		const html = render(baseView(), "ja");

		expect(html).toContain("20件");
		expect(html).not.toContain("20 options");
	});
});

describe("Options left rail filters (MIK-028)", () => {
	it("groups Domain, Genre, Tags, and AI status inside one Filters panel", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				facets: {
					genres: ["技術"],
					tags: ["typescript"],
					statuses: ["ready", "pending", "unavailable", "failed"],
					domains: ["example.test", "github.com"],
				},
			}),
		);

		expect(html).toContain('aria-label="Bookmark filters"');
		expect(html).toContain(">Filters<");
		// Subsection order: Domain before Genre before Tags before AI status.
		const order = [">Domain<", ">Genre<", ">Tags<", ">AI status<"].map((s) =>
			html.indexOf(s),
		);
		expect(order.every((i) => i >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(html).toContain(">example.test<");
		expect(html).toContain(">github.com<");
	});

	it("omits the Domain subsection when no domains exist", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
		);

		expect(html).not.toContain(">Domain<");
		// AI status renders even with no other facets.
		expect(html).toContain(">AI status<");
	});

	it("collapses a long domain list behind a Show all toggle", () => {
		const manyDomains = Array.from(
			{ length: 15 },
			(_, i) => `site-${String(i + 1).padStart(2, "0")}.test`,
		);
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				facets: {
					genres: [],
					tags: [],
					statuses: ["ready", "pending", "unavailable", "failed"],
					domains: manyDomains,
				},
			}),
		);

		expect(html).toContain("site-12.test");
		expect(html).not.toContain("site-13.test");
		expect(html).toContain("Show all 15 domains");
	});

	it("keeps Clear filters visible when only a domain filter is active", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				filters: { query: "", domain: "example.test" },
				facets: {
					genres: [],
					tags: [],
					statuses: ["ready", "pending", "unavailable", "failed"],
					domains: ["example.test"],
				},
			}),
		);

		expect(html).toContain("Clear filters");
	});
});

describe("Options shared sync hub (MIK-051)", () => {
	const populatedView = viewOf({
		rows: [rowOf()],
		totalCount: 1,
		filteredCount: 1,
		empty: false,
	});

	it("renders the bookmark sync status and action inside an app-header hub", () => {
		const html = render(populatedView);

		// A native disclosure in the app header: summary pill plus detail panel.
		expect(html).toContain("<details");
		expect(html).toContain('aria-label="Sync status"');
		expect(html).toContain(">Synced<");
		expect(html).toContain("Drive sync");
		expect(html).toContain(">synced<");
		expect(html).toContain(">Sync Drive<");
		expect(html).toContain('aria-label="Sync with Google Drive"');
		// The hub sits in the app header, before any screen content.
		expect(html.indexOf("<details")).toBeLessThan(html.indexOf("<h2"));
	});

	it("no longer renders the old rail Drive sync panel or floating sync button", () => {
		const html = render(populatedView);

		// One Drive sync readout — the hub's — instead of the old rail panel.
		expect(html.match(/Drive sync/g)).toHaveLength(1);
		expect(html).not.toContain("position:fixed;right:24px;bottom:24px");
		expect(html).not.toContain("Sync now");
	});

	it("shows the settings sync section and action when a skills controller exists", () => {
		const html = renderWithSkills(populatedView, skillsViewOf());

		expect(html).toContain("Settings sync");
		expect(html).toContain(">Sync settings<");
		expect(html).toContain('aria-label="Sync analysis skill settings"');
		// Both readouts live inside the one header hub.
		const details = html.indexOf("<details");
		expect(details).toBeGreaterThanOrEqual(0);
		expect(html.indexOf("Settings sync")).toBeGreaterThan(details);
		expect(html.indexOf("Settings sync")).toBeLessThan(html.indexOf("<h2"));
	});

	it("omits the settings sync section without a skills controller", () => {
		const html = render(populatedView);

		expect(html).not.toContain("Settings sync");
		expect(html).not.toContain(">Sync settings<");
	});

	it("summarizes pending local changes in the hub pill and detail", () => {
		const html = render(
			viewOf({
				sync: {
					status: "synced",
					pendingLocalChanges: true,
					syncing: false,
					writing: false,
				},
			}),
		);

		expect(html).toContain(">Pending<");
		expect(html).toContain("Local changes pending — will retry on next sync");
	});

	it("keeps sync errors and pending info visible in the hub detail", () => {
		const html = render(
			viewOf({
				sync: {
					status: "error",
					pendingLocalChanges: true,
					error: "Drive sync failed",
					syncing: false,
					writing: false,
				},
			}),
		);

		expect(html).toContain(">Sync error<");
		expect(html).toContain("Drive sync failed");
		expect(html).toContain("Local changes pending — will retry on next sync");
		// A failed sync leaves the action clickable so the user can retry.
		expect(html).not.toContain('aria-busy="true"');
		expect(html).not.toContain("disabled");
	});

	it("keeps the bookmark last-synced time discoverable in the hub", () => {
		const html = render(
			viewOf({
				sync: {
					status: "synced",
					pendingLocalChanges: false,
					syncing: false,
					writing: false,
					lastSyncedAt: "2026-01-06T12:34:56.000Z",
				},
			}),
		);

		expect(html).toContain("Last synced");
		expect(html).toContain("2026");
	});

	it("disables only the settings action while settings sync is running", () => {
		const html = renderWithSkills(
			viewOf(),
			skillsViewOf({
				sync: {
					status: "synced",
					pendingLocalChanges: false,
					syncing: true,
					writing: false,
				},
			}),
		);

		expect(html).toContain(">Syncing…<");
		expect(html).toContain("Syncing settings with Google Drive…");
		// Only the settings action is disabled; bookmark sync stays available.
		expect(html.match(/disabled/g)).toHaveLength(1);
	});

	it("localizes the hub for the ja language", () => {
		const html = renderWithSkills(
			populatedView,
			skillsViewOf(),
			"library",
			"ja",
		);

		expect(html).toContain(">同期済み<");
		expect(html).toContain(">Driveと同期<");
		expect(html).toContain(">設定を同期<");
		expect(html).toContain("設定の同期");
	});

	it("derives the summary kind from the worst section state", () => {
		const idle = {
			status: "synced",
			pendingLocalChanges: false,
			syncing: false,
			writing: false,
			loading: false,
		};

		expect(syncHubSummaryKind([idle])).toBe("synced");
		expect(syncHubSummaryKind([idle, { ...idle, loading: true }])).toBe(
			"syncing",
		);
		expect(syncHubSummaryKind([idle, { ...idle, writing: true }])).toBe(
			"syncing",
		);
		expect(
			syncHubSummaryKind([{ ...idle, pendingLocalChanges: true }, idle]),
		).toBe("pending");
		// An error outranks in-flight progress and pending changes.
		expect(
			syncHubSummaryKind([
				{ ...idle, status: "error" },
				{ ...idle, syncing: true, pendingLocalChanges: true },
			]),
		).toBe("error");
	});
});

describe("Options Drive sync progress feedback (MIK-026)", () => {
	it("shows cached-loading progress and disables the hub sync action", () => {
		const html = render(viewOf({ loading: true }));

		expect(html).toContain("Loading cached bookmarks…");
		expect(html).toContain("Loading your library…");
		expect(html).toContain(">Syncing…<");
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("disabled");
	});

	it("shows Drive-syncing progress and blocks duplicate sync clicks", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				sync: {
					status: "syncing",
					pendingLocalChanges: false,
					syncing: true,
					writing: false,
				},
			}),
		);

		expect(html).toContain("Syncing with Google Drive…");
		expect(html).toContain(">Syncing…<");
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("disabled");
		expect(html).not.toContain("Writing changes to Google Drive…");
	});

	it("shows Drive-writing progress distinct from syncing", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				busy: true,
				sync: {
					status: "synced",
					pendingLocalChanges: false,
					syncing: false,
					writing: true,
				},
			}),
		);

		expect(html).toContain("Writing changes to Google Drive…");
		expect(html).toContain(">Syncing…<");
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain("Syncing with Google Drive…");
	});

	it("keeps pending-local-changes visible while a write is failing over", () => {
		const html = render(
			viewOf({
				sync: {
					status: "error",
					pendingLocalChanges: true,
					error: "Drive sync failed",
					syncing: false,
					writing: false,
				},
			}),
		);

		expect(html).toContain("Local changes pending — will retry on next sync");
		expect(html).toContain("Drive sync failed");
		expect(html).not.toContain("Syncing with Google Drive…");
		expect(html).not.toContain("Writing changes to Google Drive…");
	});

	it("renders no progress line and an enabled sync button when idle", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
		);

		expect(html).not.toContain("Loading cached bookmarks…");
		expect(html).not.toContain("Syncing with Google Drive…");
		expect(html).not.toContain("Writing changes to Google Drive…");
		expect(html).not.toContain("disabled");
		expect(html).toContain("synced");
	});
});

describe("Options UI language (MIK-029)", () => {
	const populatedView = viewOf({
		rows: [rowOf()],
		totalCount: 1,
		filteredCount: 1,
		empty: false,
		facets: {
			genres: ["技術"],
			tags: ["typescript"],
			statuses: ["ready", "pending", "unavailable", "failed"],
			domains: ["example.test"],
		},
	});

	it("renders representative Japanese library strings for the ja language", () => {
		const html = render(populatedView, "ja");

		expect(html).toContain("リサーチ台帳");
		expect(html).toContain(">検索<");
		expect(html).toContain(">フィルタ<");
		expect(html).toContain(">ドメイン<");
		expect(html).toContain(">ジャンル<");
		expect(html).toContain(">タグ<");
		expect(html).toContain(">AIステータス<");
		expect(html).toContain("Driveと同期");
		expect(html).toContain("全1件中1件を表示");
		expect(html).not.toContain("Research Ledger");
		expect(html).not.toContain(">Filters<");
	});

	it("renders representative Japanese skills-screen strings for the ja language", () => {
		const html = renderWithSkills(
			viewOf(),
			skillsViewOf(),
			"analysis-skills",
			"ja",
		);

		expect(html).toContain(">ライブラリ<");
		expect(html).toContain(">分析スキル<");
		expect(html).toContain("組み込み（読み取り専用）");
		expect(html).toContain("カスタム（Drive同期）");
		expect(html).toContain("カスタムスキルを追加");
		expect(html).toContain("設定の同期");
		// Drive filename stays literal in both languages.
		expect(html).toContain("bookmark-ai/settings.json");
		expect(html).not.toContain("Built-in (read-only)");
	});

	it("localizes the detail sheet actions for the ja language", () => {
		const html = render(
			viewOf({
				rows: [rowOf({ selected: true })],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				selected: detailOf(),
			}),
			"ja",
		);

		expect(html).toContain(">開く<");
		expect(html).toContain(">削除<");
		expect(html).toContain(">閉じる<");
		expect(html).not.toContain(">Open<");
	});

	it("keeps rendering English strings for the en language", () => {
		const html = render(populatedView, "en");

		expect(html).toContain("Research Ledger");
		expect(html).toContain(">Filters<");
		expect(html).not.toContain("リサーチ台帳");
	});
});

describe("Options top-level navigation (MIK-025)", () => {
	const libraryView = viewOf({
		rows: [rowOf()],
		totalCount: 1,
		filteredCount: 1,
		empty: false,
	});

	it("shows the Library screen by default with the nav and no skills content", () => {
		const html = renderWithSkills(libraryView, skillsViewOf());

		expect(html).toContain(">Library<");
		expect(html).toContain(">Analysis skills<");
		expect(html).toContain('aria-current="page"');
		expect(html).toContain('aria-label="Search bookmarks"');
		expect(html).not.toContain("Built-in (read-only)");
		expect(html).not.toContain("Custom (Drive-synced)");
	});

	it("shows the Analysis skills screen without the ledger when selected", () => {
		const html = renderWithSkills(
			libraryView,
			skillsViewOf(),
			"analysis-skills",
		);

		expect(html).toContain('aria-label="Analysis skills settings"');
		expect(html).toContain("Built-in (read-only)");
		expect(html).toContain("Custom (Drive-synced)");
		expect(html).not.toContain('aria-label="Search bookmarks"');
		// The shared header hub keeps bookmark sync reachable on every screen.
		expect(html).toContain('aria-label="Sync with Google Drive"');
		expect(html).not.toContain("Selected bookmark");
	});

	it("renders no nav when no skills controller is provided", () => {
		const html = render(libraryView);

		expect(html).not.toContain(">Analysis skills<");
		expect(html).not.toContain('aria-label="Options screens"');
	});
});

describe("Options shared screen shell (MIK-036)", () => {
	const libraryView = viewOf({
		rows: [rowOf()],
		totalCount: 1,
		filteredCount: 1,
		empty: false,
	});

	it("keeps the brand app header and nav visible on both screens", () => {
		const library = renderWithSkills(libraryView, skillsViewOf());
		const skills = renderWithSkills(
			libraryView,
			skillsViewOf(),
			"analysis-skills",
		);

		for (const html of [library, skills]) {
			expect(html).toContain(">Bookmark AI<");
			expect(html).toContain('aria-label="Options screens"');
			expect(html).toContain(">Library<");
			expect(html).toContain(">Analysis skills<");
		}
	});

	it("opens the Library screen with the shared title/subtitle header", () => {
		const html = renderWithSkills(libraryView, skillsViewOf());

		expect(html).toMatch(/<h2[^>]*>Library<\/h2>/);
		expect(html).toContain("Research Ledger");
		// The brand lives only in the app header now, never in the rail.
		expect(html.match(/Bookmark AI/g)).toHaveLength(1);
	});

	it("opens the Analysis skills screen with the same header rhythm", () => {
		const html = renderWithSkills(
			libraryView,
			skillsViewOf(),
			"analysis-skills",
		);

		expect(html).toMatch(/<h2[^>]*>Analysis skills<\/h2>/);
		expect(html).toContain("bookmark-ai/settings.json");
		expect(html.match(/Bookmark AI/g)).toHaveLength(1);
	});

	it("keeps the brand header without nav when no skills controller is provided", () => {
		const html = render(libraryView);

		expect(html).toContain(">Bookmark AI<");
		expect(html).not.toContain('aria-label="Options screens"');
		expect(html).toMatch(/<h2[^>]*>Library<\/h2>/);
	});
});

describe("Detail profile name and edit navigation (MIK-031)", () => {
	function selectedView(analysisProfileId: string): OptionsView {
		return viewOf({
			rows: [rowOf({ selected: true, analysisProfileId })],
			totalCount: 1,
			filteredCount: 1,
			empty: false,
			selected: detailOf({ analysisProfileId }),
		});
	}

	const customSkillsView = skillsViewOf({
		custom: [
			{
				id: "s1",
				name: "Docs deep dive",
				enabled: true,
				priority: 25,
				domains: ["example.com"],
				urlPatterns: ["example.com/docs/*"],
				instruction: "Focus on X.",
				updatedAt: "2026-03-01T00:00:00Z",
			},
		],
	});

	it("shows the built-in profile name as read-only text, never an edit button", () => {
		const html = renderWithSkills(
			selectedView("github-repository"),
			customSkillsView,
		);

		expect(html).toContain("GitHubリポジトリ");
		expect(html).not.toContain("Edit analysis skill");
	});

	it("shows the custom skill name as a button targeting skill editing", () => {
		const html = renderWithSkills(selectedView("s1"), customSkillsView);

		expect(html).toContain("Docs deep dive");
		expect(html).toContain('aria-label="Edit analysis skill Docs deep dive"');
	});

	it("falls back to the raw id as read-only text for an unknown profile", () => {
		const html = renderWithSkills(
			selectedView("mystery-profile"),
			customSkillsView,
		);

		expect(html).toContain("mystery-profile");
		expect(html).not.toContain("Edit analysis skill");
	});

	it("renders an unresolvable custom id as plain text without a skills controller", () => {
		const html = render(selectedView("s1"));

		expect(html).toContain(">s1<");
		expect(html).not.toContain("Edit analysis skill");
	});
});

describe("Analysis skills settings screen (MIK-025)", () => {
	function renderSkills(skillsView: SkillsView): string {
		return renderWithSkills(viewOf(), skillsView, "analysis-skills");
	}

	it("keeps built-ins read-only while custom skills expose full actions", () => {
		const html = renderSkills(
			skillsViewOf({
				custom: [
					{
						id: "s1",
						name: "Docs deep dive",
						enabled: true,
						priority: 25,
						domains: ["example.com"],
						urlPatterns: ["example.com/docs/*"],
						instruction: "Focus on X.",
						updatedAt: "2026-03-01T00:00:00Z",
					},
				],
			}),
		);

		expect(html).toContain("GitHub repository");
		expect(html).toContain("Built-in (read-only)");
		expect(html).toContain("Docs deep dive");
		expect(html).toContain(">Disable<");
		expect(html).toContain(">Edit<");
		expect(html).toContain(">Delete<");
		// Exactly one each: the custom row's actions, never on built-ins.
		expect(html.match(/>Edit</g)).toHaveLength(1);
		expect(html.match(/>Delete</g)).toHaveLength(1);
	});

	it("shows the settings sync readout with pending info in the header hub", () => {
		const html = renderSkills(
			skillsViewOf({
				sync: {
					status: "synced",
					pendingLocalChanges: true,
					syncing: false,
					writing: false,
				},
			}),
		);

		expect(html).toContain("Settings sync");
		expect(html).toContain("Local changes pending — will retry on next sync");
		expect(html).toContain('aria-label="Sync analysis skill settings"');
	});

	it("surfaces action errors as an alert on the screen when the form is closed", () => {
		const html = renderSkills(
			skillsViewOf({ actionError: "Drive sync failed" }),
		);

		expect(html).toContain('role="alert"');
		expect(html).toContain("Drive sync failed");
	});
});

describe("Analysis skills workspace layout (MIK-038)", () => {
	function renderSkills(skillsView: SkillsView): string {
		return renderWithSkills(viewOf(), skillsView, "analysis-skills");
	}

	it("keeps the workspace grid on the Library but not on Analysis skills (MIK-052)", () => {
		const libraryView = viewOf({
			rows: [rowOf()],
			totalCount: 1,
			filteredCount: 1,
			empty: false,
		});
		const library = renderWithSkills(libraryView, skillsViewOf());
		const skills = renderWithSkills(
			libraryView,
			skillsViewOf(),
			"analysis-skills",
		);

		// The Library rail holds active search/filter controls, so it keeps the
		// two-column grid; the skills screen lost its explanation-only rail.
		expect(library).toContain("grid-template-columns:240px");
		expect(library).toContain("<aside");
		expect(skills).not.toContain("grid-template-columns:240px");
		expect(skills).not.toContain("<aside");
	});

	it("centers the skills content in a no-rail column with guidance in header help (MIK-052)", () => {
		const html = renderSkills(skillsViewOf());

		// The main content is centered in a readable single column.
		expect(html).toContain("max-width:880px");
		// The settings sync readout lives only in the header hub.
		expect(html.match(/Settings sync/g)).toHaveLength(1);
		// The settings-file guidance moved into the title-adjacent help, which
		// renders ahead of the main skill cards.
		const order = [
			'aria-label="Analysis skills help"',
			"bookmark-ai/settings.json",
			"Custom (Drive-synced)",
			"Built-in (read-only)",
		].map((s) => html.indexOf(s));
		expect(order.every((i) => i >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(html).not.toContain("Refresh settings");
	});

	it("keeps the subtitle user-facing and the settings file path in the header help", () => {
		const html = renderSkills(skillsViewOf());

		expect(html).toContain("Tune how the AI analyzes the pages you save");
		// The technical filename lives only in the header help guidance now.
		expect(html.match(/bookmark-ai\/settings\.json/g)).toHaveLength(1);
	});

	it("offers refresh via an enabled hub settings sync action when idle", () => {
		const html = renderSkills(skillsViewOf());

		expect(html).toContain('aria-label="Sync analysis skill settings"');
		expect(html).toContain("Sync settings");
		expect(html).not.toContain("disabled");
		expect(html).not.toContain('aria-busy="true"');
	});

	it("disables the hub settings sync action while an action is busy", () => {
		const html = renderSkills(
			skillsViewOf({
				busy: true,
				sync: {
					status: "synced",
					pendingLocalChanges: false,
					syncing: false,
					writing: true,
				},
			}),
		);

		expect(html).toContain('aria-label="Sync analysis skill settings"');
		expect(html).toContain("disabled");
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("Writing settings changes to Google Drive…");
	});

	it("shows settings syncing progress in the hub while a pull is running", () => {
		const html = renderSkills(
			skillsViewOf({
				sync: {
					status: "synced",
					pendingLocalChanges: false,
					syncing: true,
					writing: false,
				},
			}),
		);

		expect(html).toContain('aria-label="Sync analysis skill settings"');
		expect(html).toContain("disabled");
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("Syncing settings with Google Drive…");
	});

	it("shows the settings last synced timestamp in the hub", () => {
		const html = renderSkills(
			skillsViewOf({
				sync: {
					status: "synced",
					pendingLocalChanges: false,
					syncing: false,
					writing: false,
					lastSyncedAt: "2026-01-06T12:34:56.000Z",
				},
			}),
		);

		expect(html).toContain("Last synced");
		expect(html).toContain("2026");
	});

	it("keeps the settings sync status visible in the hub while loading", () => {
		const html = renderSkills(
			skillsViewOf({
				loading: true,
				sync: {
					status: "idle",
					pendingLocalChanges: false,
					syncing: false,
					writing: false,
				},
			}),
		);

		expect(html).toContain("Settings sync");
		expect(html).toContain(">idle<");
		expect(html).toContain("Loading analysis skills…");
		expect(html).toContain("disabled");
	});
});

describe("Skill form dialog (MIK-025; drawer since MIK-053)", () => {
	function renderSkills(skillsView: SkillsView): string {
		return renderWithSkills(viewOf(), skillsView, "analysis-skills");
	}

	it("renders no dialog while the form is closed", () => {
		const html = renderSkills(skillsViewOf());

		expect(html).not.toContain('role="dialog"');
	});

	it("opens a create dialog with an empty form, close/cancel, and guidance", () => {
		const html = renderSkills(skillsViewOf({ formOpen: true }));

		expect(html).toContain('role="dialog"');
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain('aria-labelledby="skill-form-title"');
		expect(html).toContain("New custom skill");
		expect(html).toContain('aria-label="Close skill form"');
		expect(html).toContain(">Cancel<");
		expect(html).toContain(">Create skill<");
		// Authoring guidance sits next to the form, including safety warnings.
		expect(html).toContain("Writing a good instruction");
		expect(html).toContain("Never write instructions that");
		expect(html).toContain("request secrets, tokens, or credentials;");
		expect(html).toContain("ask to persist raw page content or excerpts;");
		expect(html).toContain("ask to call external APIs or AI providers;");
		expect(html).toContain(
			"try to change the output schema or the privacy contract.",
		);
		expect(html).toContain("How matching works");
		// Output-shape guidance (MIK-030): the instruction can shape the analysis
		// note with priority over the default format, but never the fixed
		// schema/privacy/language boundaries.
		expect(html).toContain("takes priority over the default long-form format");
		expect(html).toContain(
			"It cannot change the JSON keys, the output language,",
		);
		expect(html).toContain("## Video overview and ## Comment picks");
		expect(html).toContain(
			"ask to change the output language or the AI model;",
		);
	});

	it("opens an edit modal populated with the skill being edited", () => {
		const html = renderSkills(
			skillsViewOf({
				formOpen: true,
				editingId: "s1",
				form: {
					name: "Docs deep dive",
					priority: "25",
					domains: "example.com",
					urlPatterns: "example.com/docs/*",
					instruction: "Focus on X.",
				},
			}),
		);

		expect(html).toContain("Edit custom skill");
		expect(html).toContain(">Save changes<");
		expect(html).toContain('value="Docs deep dive"');
		expect(html).toContain('value="25"');
		expect(html).toContain("Focus on X.");
	});

	it("keeps the action error visible inside the open modal", () => {
		const html = renderSkills(
			skillsViewOf({ formOpen: true, actionError: "name must be non-empty" }),
		);

		expect(html).toContain('role="dialog"');
		expect(html).toContain('role="alert"');
		expect(html).toContain("name must be non-empty");
	});
});

describe("Ask AI screen shell (MIK-045)", () => {
	const syncedView = viewOf({
		sync: {
			status: "synced",
			pendingLocalChanges: false,
			syncing: false,
			writing: false,
			lastSyncedAt: "2026-01-06T12:34:56.000Z",
		},
	});

	it("adds an Ask AI tab to the nav alongside the existing screens", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf());

		expect(html).toContain(">Library<");
		expect(html).toContain(">Analysis skills<");
		expect(html).toContain(">Ask AI<");
	});

	it("labels the nav tab AIに聞く for the ja language", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "library", "ja");

		expect(html).toContain(">ライブラリ<");
		expect(html).toContain(">分析スキル<");
		expect(html).toContain(">AIに聞く<");
	});

	it("renders the Ask AI screen as a chat-only layout without the shared workspace grid", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		expect(html).toContain('aria-label="Ask AI about saved bookmarks"');
		expect(html).toMatch(/<h2[^>]*>Ask AI<\/h2>/);
		// Chat-only screen (MIK-050): no shared rail/main workspace grid and no
		// left rail section — the chat is the primary full-width content.
		expect(html).not.toContain("grid-template-columns:240px");
		expect(html).not.toContain("<aside");
		expect(html.match(/Bookmark AI/g)).toHaveLength(1);
		// Neither the ledger nor the skills content leaks onto this screen; the
		// bookmark sync action stays reachable through the shared header hub.
		expect(html).not.toContain('aria-label="Search bookmarks"');
		expect(html).toContain('aria-label="Sync with Google Drive"');
		expect(html).not.toContain("Built-in (read-only)");
	});

	it("keeps the shared workspace grid on the Library screen only (MIK-052)", () => {
		// MIK-050 removed the grid on Ask AI; MIK-052 removes the skills
		// explanation-only rail too — only the Library keeps active rail controls.
		const library = renderWithAskAi(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
			askAiViewOf(),
		);
		const skills = renderWithAskAi(
			syncedView,
			askAiViewOf(),
			"analysis-skills",
		);

		expect(library).toContain("grid-template-columns:240px");
		expect(skills).not.toContain("grid-template-columns:240px");
	});

	it("centers the Ask AI chat in a comfortable no-rail chat column (MIK-052)", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		// The app header and screen shell keep the shared 1200px width cap; the
		// chat itself is centered in a narrower comfortable column inside it.
		expect(html.match(/max-width:1200px/g)).toHaveLength(2);
		expect(html).not.toContain("max-width:1600px");
		expect(html).toContain("max-width:960px");
		// The centered chat wrapper hosts the scrolling chat viewport.
		expect(html.indexOf("max-width:960px")).toBeLessThan(
			html.indexOf("overflow-y:auto"),
		);
	});

	it("locks the Ask AI outer page so the chat viewport is the only scroller", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		// The Ask AI page itself should not scroll; the transcript viewport owns
		// vertical overflow so the composer remains pinned.
		expect(html).toContain(
			"height:100vh;overflow:hidden;display:flex;flex-direction:column",
		);
		expect(html).toContain("flex:1;min-height:0");
		expect(html).toContain("height:100%;min-height:0");
		expect(html).not.toContain("height:calc(100vh - 180px)");
	});

	it("keeps sync status and timestamp out of the Ask AI chat context (MIK-051)", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		const context = html.indexOf('aria-label="About Ask AI"');
		expect(context).toBeGreaterThanOrEqual(0);
		// Last synced belongs in the header hub only, not in the chat context.
		expect(html.match(/Last synced/g)).toHaveLength(1);
		expect(html.indexOf("Last synced")).toBeLessThan(context);
		// The sync status readout itself also lives only in the header hub: every
		// status occurrence (bookmarks + settings) precedes the chat context.
		expect(html.match(/Drive sync/g)).toHaveLength(1);
		expect(html.match(/>synced</g)).toHaveLength(2);
		expect(html.lastIndexOf(">synced<")).toBeLessThan(context);
		expect(html.indexOf("Drive sync")).toBeLessThan(context);
	});

	it("renders the sync/scope/privacy context as the first item inside the chat viewport", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		// The context lives inside the one scrolling viewport of the chat —
		// after the scroll container opens, before the welcome state and the
		// pinned composer form — not as an external strip above the chat frame.
		const viewport = html.indexOf("overflow-y:auto");
		const context = html.indexOf('aria-label="About Ask AI"');
		const welcome = html.indexOf("No questions yet");
		const form = html.indexOf("<form");
		for (const index of [viewport, context, welcome, form]) {
			expect(index).toBeGreaterThanOrEqual(0);
		}
		expect(context).toBeGreaterThan(viewport);
		expect(context).toBeLessThan(welcome);
		expect(context).toBeLessThan(form);
	});

	it("keeps the chat context ahead of the transcript once messages exist", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript testing", {
					kind: "weak-candidates",
				}),
			}),
			"ask-ai",
		);

		const context = html.indexOf('aria-label="About Ask AI"');
		const log = html.indexOf('role="log"');
		expect(context).toBeGreaterThanOrEqual(0);
		expect(log).toBeGreaterThanOrEqual(0);
		expect(context).toBeLessThan(log);
	});

	it("explains the local-cache scope and chat non-persistence in the chat context", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		expect(html).toContain(
			"Ask AI searches all your saved bookmarks in the local cache",
		);
		expect(html).toContain("it does not search the open web");
		// The refresh guidance points at the header hub, not the Library screen.
		expect(html).toContain("Use Sync Drive in the app header");
		expect(html).toContain("Only short saved-bookmark info");
		expect(html).toContain("this chat is never saved");
	});

	it("localizes the chat-context scope and privacy notes for the ja language", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai", "ja");

		expect(html).toContain(
			"ローカルキャッシュ内のすべての保存済みブックマークを検索します",
		);
		expect(html).toContain("ウェブ全体は検索しません");
		expect(html).toContain("このチャットは保存されません");
	});

	it("renders the empty chat state with the localized example prompts", () => {
		const en = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");
		expect(en).toContain("Find saved bookmarks about TypeScript testing");
		expect(en).toContain("Show me GitHub repositories about AI tools");
		expect(en).toContain("What should I read about Chrome extensions?");

		const ja = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai", "ja");
		expect(ja).toContain("TypeScriptのテストについて保存済みから探す");
		expect(ja).toContain("AIツール関連のGitHubリポジトリを見つける");
		expect(ja).toContain("Chrome拡張について読むべきものは？");
	});

	it("disables submit for an empty or too-short question", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ question: "", canSubmit: false }),
			"ask-ai",
		);

		expect(html).toContain('aria-label="Ask AI question"');
		expect(html).toContain(">Ask<");
		expect(html).toContain("disabled");
	});

	it("enables submit once the question passes the minimum length", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				question: "typescript testing",
				canSubmit: true,
				canClear: true,
			}),
			"ask-ai",
		);

		expect(html).toContain("typescript testing");
		expect(html).not.toContain("disabled");
		expect(html).not.toContain('aria-busy="true"');
	});

	it("disables submit and marks the form busy while answering", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ question: "typescript testing", answering: true }),
			"ask-ai",
		);

		expect(html).toContain("disabled");
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("Looking through your saved bookmarks…");
	});

	it("renders no Ask AI tab when no Ask AI controller is provided", () => {
		const html = renderWithSkills(syncedView, skillsViewOf());

		expect(html).not.toContain(">Ask AI<");
	});
});

/** A one-exchange transcript: the submitted question plus its answer. */
function chatOf(question: string, result: AskAiResultView): AskAiChatMessage[] {
	return [
		{ id: "m-user", role: "user", text: question },
		{ id: "m-assistant", role: "assistant", result },
	];
}

describe("Ask AI recommendations (MIK-046)", () => {
	const syncedView = viewOf({
		sync: {
			status: "synced",
			pendingLocalChanges: false,
			syncing: false,
			writing: false,
		},
	});

	const cards = [
		{
			canonicalUrl: "https://ts.test/handbook",
			url: "https://ts.test/handbook",
			title: "TypeScript testing handbook",
			domain: "ts.test",
			genre: "技術",
			tags: ["typescript"],
			description: "A short saved description.",
			aiStatus: "ready" as const,
			reason: "Covers exactly this topic.",
		},
		{
			canonicalUrl: "https://vitest.test/guide",
			url: "https://vitest.test/guide",
			title: "Vitest guide",
			domain: "vitest.test",
			tags: [],
			aiStatus: "pending" as const,
			reason: "Matched title",
		},
	];

	it("renders AI recommendation cards as buttons with titles and reasons", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript testing", {
					kind: "recommendations",
					source: "ai",
					message: "Here are your matches.",
					cards,
				}),
			}),
			"ask-ai",
		);

		expect(html).toContain("Here are your matches.");
		expect(html).toContain("TypeScript testing handbook");
		expect(html).toContain("Covers exactly this topic.");
		expect(html).toContain("Vitest guide");
		expect(html).toContain(
			'aria-label="Open details for TypeScript testing handbook"',
		);
		expect(html).toContain('aria-label="Open details for Vitest guide"');
		// The submitted question stays visible as a user turn in the transcript.
		expect(html).toContain("typescript testing");
		// No fallback notice on an AI-sourced answer.
		expect(html).not.toContain("keyword matches");
	});

	it("marks local fallback results with the fallback notice and reasons", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript", {
					kind: "recommendations",
					source: "local",
					cards,
				}),
			}),
			"ask-ai",
		);

		expect(html).toContain(
			"these are keyword matches from your saved bookmarks",
		);
		expect(html).toContain("Matched title");
		expect(html).toContain("TypeScript testing handbook");
	});

	it("shows the clarifying message for weak candidates", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("hm", { kind: "weak-candidates" }),
			}),
			"ask-ai",
		);

		expect(html).toContain("could not find a strong match");
		expect(html).not.toContain('aria-label="Open details for');
	});

	it("shows safe messages for too-short questions and an empty library", () => {
		const tooShort = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("a", { kind: "too-short-question" }),
			}),
			"ask-ai",
		);
		expect(tooShort).toContain("longer question");

		const emptyLibrary = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript", { kind: "empty-library" }),
			}),
			"ask-ai",
		);
		expect(emptyLibrary).toContain("no saved bookmarks yet");
	});

	it("shows a safe error banner when the flow fails unexpectedly", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript", { kind: "error" }),
			}),
			"ask-ai",
		);

		expect(html).toContain('role="alert"');
		expect(html).toContain("try again");
	});

	it("localizes the fallback notice and clarify message for the ja language", () => {
		const fallback = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript", {
					kind: "recommendations",
					source: "local",
					cards,
				}),
			}),
			"ask-ai",
			"ja",
		);
		expect(fallback).toContain("キーワード一致");

		const clarify = renderWithAskAi(
			syncedView,
			askAiViewOf({ messages: chatOf("hm", { kind: "weak-candidates" }) }),
			"ask-ai",
			"ja",
		);
		expect(clarify).toContain("見つかりませんでした");
	});

	it("opens the existing bookmark detail sheet over the Ask AI screen", () => {
		const html = renderWithAskAi(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				selected: detailOf(),
			}),
			askAiViewOf({
				messages: chatOf("typescript testing", {
					kind: "recommendations",
					source: "ai",
					message: "Here are your matches.",
					cards,
				}),
			}),
			"ask-ai",
		);

		expect(html).toContain('role="dialog"');
		expect(html).toContain('aria-labelledby="bookmark-detail-title"');
		expect(html).toContain("Selected bookmark");
	});
});

describe("Ask AI chat session UI (MIK-048)", () => {
	const syncedView = viewOf({
		sync: {
			status: "synced",
			pendingLocalChanges: false,
			syncing: false,
			writing: false,
		},
	});

	const answer: AskAiResultView = {
		kind: "recommendations",
		source: "ai",
		message: "Here are your matches.",
		cards: [
			{
				canonicalUrl: "https://ts.test/handbook",
				url: "https://ts.test/handbook",
				title: "TypeScript testing handbook",
				domain: "ts.test",
				tags: ["typescript"],
				aiStatus: "ready" as const,
				reason: "Covers exactly this topic.",
			},
		],
	};

	it("keeps the welcome/examples panel before the first user message", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		expect(html).toContain("No questions yet");
		expect(html).toContain("Find saved bookmarks about TypeScript testing");
	});

	it("replaces the welcome panel with the transcript once the chat starts", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ messages: chatOf("typescript testing", answer) }),
			"ask-ai",
		);

		expect(html).not.toContain("No questions yet");
		expect(html).toContain('aria-label="Ask AI conversation"');
		expect(html).toContain("typescript testing");
		expect(html).toContain("Here are your matches.");
	});

	it("renders every turn of a multi-exchange transcript in order", () => {
		const messages: AskAiChatMessage[] = [
			...chatOf("typescript testing", answer),
			{ id: "m-user-2", role: "user", text: "which one is newest?" },
			{
				id: "m-assistant-2",
				role: "assistant",
				result: { kind: "weak-candidates" },
			},
		];
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ messages }),
			"ask-ai",
		);

		expect(html).toContain("typescript testing");
		expect(html).toContain("which one is newest?");
		expect(html).toContain("could not find a strong match");
		expect(html.indexOf("typescript testing")).toBeLessThan(
			html.indexOf("which one is newest?"),
		);
	});

	it("renders a clear-chat button that is disabled until there is something to clear", () => {
		const idle = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");
		expect(idle).toContain(">Clear chat<");
		expect(idle).toContain("disabled");

		const active = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript testing", answer),
				canClear: true,
			}),
			"ask-ai",
		);
		expect(active).toContain(">Clear chat<");
	});

	it("localizes the clear-chat button for the ja language", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai", "ja");

		expect(html).toContain(">チャットをクリア<");
	});

	it("disables the composer while an answer is in flight", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript testing", answer),
				answering: true,
				canClear: true,
			}),
			"ask-ai",
		);

		expect(html).toMatch(/<textarea[^>]*disabled/);
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("Looking through your saved bookmarks…");
	});
});

describe("Ask AI chat layout polish (MIK-049)", () => {
	const syncedView = viewOf({
		sync: {
			status: "synced",
			pendingLocalChanges: false,
			syncing: false,
			writing: false,
		},
	});

	const answer: AskAiResultView = {
		kind: "recommendations",
		source: "ai",
		message: "Here are your matches.",
		cards: [
			{
				canonicalUrl: "https://ts.test/handbook",
				url: "https://ts.test/handbook",
				title: "TypeScript testing handbook",
				domain: "ts.test",
				tags: ["typescript"],
				aiStatus: "ready" as const,
				reason: "Covers exactly this topic.",
			},
		],
	};

	it("renders a chat surface with a scrollable transcript and a bottom-pinned composer", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ messages: chatOf("typescript testing", answer) }),
			"ask-ai",
		);

		// The Ask AI page bounds the available height; the chat shell fills that
		// space so the composer stays pinned while only the transcript scrolls.
		expect(html).toContain("height:100%;min-height:0");
		expect(html).not.toContain("height:calc(100vh - 180px)");
		expect(html).toContain("flex-shrink:0");
		// The transcript log lives inside the scroll viewport, above the composer.
		expect(html.indexOf('role="log"')).toBeGreaterThan(-1);
		expect(html.indexOf('role="log"')).toBeLessThan(html.indexOf("<form"));
	});

	it("centers the welcome/examples state before the first message", () => {
		const html = renderWithAskAi(syncedView, askAiViewOf(), "ask-ai");

		expect(html).toContain("No questions yet");
		expect(html).toContain("Find saved bookmarks about TypeScript testing");
		expect(html).toContain("justify-content:center");
		expect(html).toContain("text-align:center");
	});

	it("labels user and assistant turns as distinct chat bubbles", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ messages: chatOf("typescript testing", answer) }),
			"ask-ai",
		);

		expect(html).toContain(">You<");
		expect(html).toContain(">AI<");
		// The user turn is a right-aligned bubble; the assistant turn stretches.
		expect(html).toContain("align-self:flex-end");
		expect(html).toContain("typescript testing");
		expect(html).toContain("Here are your matches.");
	});

	it("localizes the turn labels for the ja language", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ messages: chatOf("typescript testing", answer) }),
			"ask-ai",
			"ja",
		);

		expect(html).toContain(">あなた<");
		expect(html).toContain(">AI<");
	});

	it("shows a chat-like animated thinking indicator while answering", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript testing", answer),
				answering: true,
				canClear: true,
			}),
			"ask-ai",
		);

		expect(html).toContain('role="status"');
		expect(html).toContain("Looking through your saved bookmarks…");
		// The dot animation ships with the indicator (no CSS framework).
		expect(html).toContain("askai-thinking");
	});

	it("hides the jump-to-latest button until the user scrolls away", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({ messages: chatOf("typescript testing", answer) }),
			"ask-ai",
		);

		expect(html).not.toContain("Jump to latest");
	});

	it("keeps Clear chat inside the pinned composer", () => {
		const html = renderWithAskAi(
			syncedView,
			askAiViewOf({
				messages: chatOf("typescript testing", answer),
				canClear: true,
			}),
			"ask-ai",
		);

		const formStart = html.indexOf("<form");
		expect(formStart).toBeGreaterThan(-1);
		expect(html.indexOf(">Clear chat<")).toBeGreaterThan(formStart);
	});
});

describe("Screen header help (MIK-052, MIK-053)", () => {
	const populatedView = viewOf({
		rows: [rowOf()],
		totalCount: 1,
		filteredCount: 1,
		empty: false,
	});

	it("renders a title-adjacent help trigger on the Analysis skills screen", () => {
		const html = renderWithSkills(viewOf(), skillsViewOf(), "analysis-skills");

		// A button-based popover trigger (MIK-053) — click/focus accessible,
		// never hover-only — the small `?` toggle beside the title.
		expect(html).toMatch(/<button[^>]*aria-label="Analysis skills help"/);
		const title = html.indexOf(">Analysis skills</h2>");
		const help = html.indexOf('aria-label="Analysis skills help"');
		const subtitle = html.indexOf(
			"Tune how the AI analyzes the pages you save",
		);
		expect(title).toBeGreaterThanOrEqual(0);
		expect(help).toBeGreaterThan(title);
		expect(help).toBeLessThan(subtitle);
		// The help content carries the existing settings-file guidance.
		expect(html).toContain(
			"Custom skills tune the AI analysis for matching pages",
		);
		expect(html).toContain("bookmark-ai/settings.json");
		// One native disclosure left on this screen: the header sync hub. The
		// title help is a button-driven fixed popover now (MIK-053).
		expect(html.match(/<details/g)).toHaveLength(1);
	});

	it("renders a title-adjacent help trigger with scope/privacy guidance on Ask AI", () => {
		const html = renderWithAskAi(viewOf(), askAiViewOf(), "ask-ai");

		expect(html).toMatch(/<button[^>]*aria-label="Ask AI help"/);
		// The help explains the local-cache scope, the no-open-web boundary, and
		// non-persistence; the compact chat context keeps the same critical copy
		// inside the viewport (MIK-050), so each note appears exactly twice.
		expect(html.match(/it does not search the open web/g)).toHaveLength(2);
		expect(html.match(/this chat is never saved/g)).toHaveLength(2);
		// The header help precedes the scrolling chat viewport.
		expect(html.indexOf('aria-label="Ask AI help"')).toBeLessThan(
			html.indexOf("overflow-y:auto"),
		);
	});

	it("gives the Library a title-adjacent help trigger while keeping its rail (MIK-053)", () => {
		const html = renderWithSkills(populatedView, skillsViewOf());

		expect(html).toMatch(/<button[^>]*aria-label="Library help"/);
		expect(html).not.toContain('aria-label="Analysis skills help"');
		expect(html).not.toContain('aria-label="Ask AI help"');
		expect(html).toContain("grid-template-columns:240px");
		expect(html).toContain('aria-label="Search bookmarks"');
	});

	it("localizes the help toggles for the ja language", () => {
		const library = renderWithSkills(
			populatedView,
			skillsViewOf(),
			"library",
			"ja",
		);
		expect(library).toContain('aria-label="ライブラリのヘルプ"');

		const skills = renderWithSkills(
			viewOf(),
			skillsViewOf(),
			"analysis-skills",
			"ja",
		);
		expect(skills).toContain('aria-label="分析スキルのヘルプ"');

		const askAi = renderWithAskAi(viewOf(), askAiViewOf(), "ask-ai", "ja");
		expect(askAi).toContain('aria-label="AIに聞くのヘルプ"');
	});
});

describe("Ask AI scroll-follow helpers (MIK-049)", () => {
	it("computes the distance from the bottom of the viewport", () => {
		expect(
			askAiDistanceFromBottom({
				scrollTop: 100,
				scrollHeight: 400,
				clientHeight: 200,
			}),
		).toBe(100);
		expect(
			askAiDistanceFromBottom({
				scrollTop: 200,
				scrollHeight: 400,
				clientHeight: 200,
			}),
		).toBe(0);
	});

	it("auto-follows only while the user is near the bottom", () => {
		expect(askAiShouldAutoFollow(0)).toBe(true);
		expect(askAiShouldAutoFollow(16)).toBe(true);
		expect(askAiShouldAutoFollow(17)).toBe(false);
		expect(askAiShouldAutoFollow(300)).toBe(false);
	});

	it("shows the latest button past the show threshold and hides it with hysteresis", () => {
		// Hidden → needs to pass the (higher) show threshold.
		expect(askAiLatestButtonVisible(120, false)).toBe(false);
		expect(askAiLatestButtonVisible(121, false)).toBe(true);
		// Visible → stays until the (lower) hide threshold is crossed.
		expect(askAiLatestButtonVisible(80, true)).toBe(true);
		expect(askAiLatestButtonVisible(41, true)).toBe(true);
		expect(askAiLatestButtonVisible(40, true)).toBe(false);
		expect(askAiLatestButtonVisible(0, true)).toBe(false);
	});
});

describe("Options shared UI foundation (MIK-053)", () => {
	const populatedView = viewOf({
		rows: [rowOf()],
		totalCount: 1,
		filteredCount: 1,
		empty: false,
	});

	const cards = [
		{
			canonicalUrl: "https://ts.test/handbook",
			url: "https://www.ts.test/handbook?utm_source=x",
			title: "TypeScript testing handbook",
			domain: "ts.test",
			genre: "技術",
			tags: ["typescript"],
			description: "A short saved description.",
			aiStatus: "ready" as const,
			reason: "Covers exactly this topic.",
		},
		{
			canonicalUrl: "https://vitest.test/guide",
			url: "https://vitest.test/guide",
			title: "Vitest guide",
			domain: "vitest.test",
			tags: [],
			aiStatus: "pending" as const,
			reason: "Matched title",
		},
	];

	function renderAskAiCards(): string {
		return renderWithAskAi(
			viewOf(),
			askAiViewOf({
				messages: chatOf("typescript testing", {
					kind: "recommendations",
					source: "ai",
					message: "Here are your matches.",
					cards,
				}),
			}),
			"ask-ai",
		);
	}

	describe("ScreenFrame variants", () => {
		it("keeps the Library frame on the rail/main workspace grid", () => {
			const html = renderWithSkills(populatedView, skillsViewOf());

			expect(html).toContain("grid-template-columns:240px");
			expect(html).toContain("<aside");
		});

		it("wraps the Analysis skills header inside the centered no-rail column", () => {
			const html = renderWithSkills(
				viewOf(),
				skillsViewOf(),
				"analysis-skills",
			);

			// The 880px content column opens before the screen title so the header
			// and the body share one centered column instead of drifting apart.
			const column = html.indexOf("max-width:880px");
			const title = html.indexOf(">Analysis skills</h2>");
			expect(column).toBeGreaterThanOrEqual(0);
			expect(title).toBeGreaterThanOrEqual(0);
			expect(column).toBeLessThan(title);
		});

		it("aligns the Ask AI header with the chat column", () => {
			const html = renderWithAskAi(viewOf(), askAiViewOf(), "ask-ai");

			// The 960px chat column opens before the screen title: header, help,
			// subtitle, and chat body all live in the same centered column.
			const column = html.indexOf("max-width:960px");
			const title = html.indexOf(">Ask AI</h2>");
			expect(column).toBeGreaterThanOrEqual(0);
			expect(title).toBeGreaterThanOrEqual(0);
			expect(column).toBeLessThan(title);
			expect(title).toBeLessThan(html.indexOf("overflow-y:auto"));
		});

		it("keeps the Ask AI outer page locked with the viewport as the only scroller", () => {
			const html = renderWithAskAi(viewOf(), askAiViewOf(), "ask-ai");

			expect(html).toContain(
				"height:100vh;overflow:hidden;display:flex;flex-direction:column",
			);
			expect(html.match(/overflow-y:auto/g)).toHaveLength(1);
			expect(html).not.toContain("height:calc(100vh - 180px)");
			// The composer form stays pinned after the scrolling viewport.
			expect(html.indexOf("overflow-y:auto")).toBeLessThan(
				html.indexOf("<form"),
			);
		});
	});

	describe("ScreenHelp fixed popover", () => {
		it("renders the Library help content: search/filters, detail drawer, sync hub", () => {
			const html = renderWithSkills(populatedView, skillsViewOf());

			expect(html).toMatch(/<button[^>]*aria-label="Library help"/);
			expect(html).toContain("Search and filters narrow your saved bookmarks");
			expect(html).toContain(
				"Click a row to open its full details in the right-side drawer",
			);
			expect(html).toContain(
				"manual sync actions live in the sync hub in the app header",
			);
		});

		it("renders every screen's help as a button-driven fixed popover, closed by default", () => {
			const screens = [
				renderWithSkills(populatedView, skillsViewOf()),
				renderWithSkills(viewOf(), skillsViewOf(), "analysis-skills"),
				renderWithAskAi(viewOf(), askAiViewOf(), "ask-ai"),
			];

			for (const html of screens) {
				// The trigger is a real button carrying popover semantics.
				expect(html).toMatch(
					/<button[^>]*aria-label="[^"]*help[^"]*"[^>]*aria-expanded="false"[^>]*aria-controls=/i,
				);
				// The panel is position:fixed (so an overflow:hidden ancestor like
				// the Ask AI page can never clip it) and hidden while closed.
				expect(html).toMatch(/hidden="" style="position:fixed/);
				// No <summary>-based help trigger remains.
				expect(html).not.toMatch(/<summary[^>]*aria-label="[^"]*help/i);
			}
		});
	});

	describe("shared Drawer foundation", () => {
		it("opens the skill create/edit form as a right drawer, not a centered modal", () => {
			const html = renderWithSkills(
				viewOf(),
				skillsViewOf({ formOpen: true }),
				"analysis-skills",
			);

			expect(html).toContain('role="dialog"');
			expect(html).toContain('aria-modal="true"');
			expect(html).toContain('aria-labelledby="skill-form-title"');
			// Right-aligned drawer backdrop and panel instead of the centered
			// modal card (the old card was `width:min(680px, 100%)`).
			expect(html).toContain("justify-content:flex-end");
			expect(html).toContain("width:min(60vw, 860px)");
			expect(html).not.toContain("width:min(680px, 100%)");
			expect(html).toContain('aria-label="Close skill form"');
		});

		it("keeps the bookmark detail drawer on the same right-drawer foundation", () => {
			const html = renderWithSkills(
				viewOf({
					rows: [rowOf({ selected: true })],
					totalCount: 1,
					filteredCount: 1,
					empty: false,
					selected: detailOf(),
				}),
				skillsViewOf(),
			);

			expect(html).toContain('role="dialog"');
			expect(html).toContain('aria-labelledby="bookmark-detail-title"');
			expect(html).toContain("justify-content:flex-end");
		});

		it("collapses the skill authoring guidance behind tips inside the drawer", () => {
			const html = renderWithSkills(
				viewOf(),
				skillsViewOf({ formOpen: true }),
				"analysis-skills",
			);

			// Two native disclosures while the drawer is open: the header sync hub
			// and the collapsible authoring tips inside the drawer body.
			expect(html.match(/<details/g)).toHaveLength(2);
			expect(html).toMatch(/<summary[^>]*>[^<]*Writing a good instruction/);
			// The guidance content stays available inside the tips.
			expect(html).toContain("Never write instructions that");
			expect(html).toContain("How matching works");
		});
	});

	describe("shared BookmarkSummaryItem", () => {
		afterEach(() => {
			delete (globalThis as { chrome?: unknown }).chrome;
		});

		function stubChromeRuntime(): void {
			(globalThis as { chrome?: unknown }).chrome = {
				runtime: {
					getURL: (path: string) => `chrome-extension://test-ext${path}`,
				},
			};
		}

		it("marks Library rows and Ask AI cards with the shared summary primitive", () => {
			const library = renderWithSkills(populatedView, skillsViewOf());
			expect(library.match(/data-bookmark-summary/g)).toHaveLength(1);

			const askAi = renderAskAiCards();
			expect(askAi.match(/data-bookmark-summary/g)).toHaveLength(2);
		});

		it("renders Ask AI card favicons from the original bookmark URL", () => {
			stubChromeRuntime();

			const html = renderAskAiCards();

			// The original visited URL, never the canonical form (MIK-034).
			expect(html).toContain(
				"chrome-extension://test-ext/_favicon/?pageUrl=https%3A%2F%2Fwww.ts.test%2Fhandbook%3Futm_source%3Dx&amp;size=22",
			);
			expect(html).not.toContain("pageUrl=https%3A%2F%2Fts.test%2Fhandbook");
		});

		it("falls back to the hostname initial on Ask AI cards off-extension", () => {
			const html = renderAskAiCards();

			// vitest.test → "V" fallback tile, like Library rows off-extension.
			expect(html).toContain(">V<");
			expect(html).not.toContain("_favicon");
		});

		it("keeps the recommendation reason on cards and quick delete on rows only", () => {
			const askAi = renderAskAiCards();
			expect(askAi).toContain("Covers exactly this topic.");
			expect(askAi).not.toContain('aria-label="Delete ');

			const library = renderWithSkills(populatedView, skillsViewOf());
			expect(library).toContain('aria-label="Delete Selected bookmark"');
		});
	});
});
