import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { OptionsScreen } from "./Options";
import { lockScroll, Options, visibleFacetValues } from "./Options";
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
 * a quick delete button, the tag facet collapses behind a cap, Drive sync
 * floats instead of sitting in the rail, and the Analysis skills settings
 * screen renders separately from the ledger with a modal skill form. Screen
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
		sync: { status: "synced", pendingLocalChanges: false },
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

describe("Options tag facet cap (MIK-024)", () => {
	const manyTags = Array.from(
		{ length: 20 },
		(_, i) => `tag-${String(i + 1).padStart(2, "0")}`,
	);

	it("collapses a long tag list behind a Show all toggle", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				facets: {
					genres: [],
					tags: manyTags,
					statuses: ["ready", "pending", "unavailable", "failed"],
					domains: [],
				},
			}),
		);

		expect(html).toContain("#tag-01");
		expect(html).toContain("#tag-12");
		expect(html).not.toContain("#tag-13");
		expect(html).toContain("Show all 20 tags");
	});

	it("shows every tag with no toggle when the list fits the cap", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				facets: {
					genres: [],
					tags: manyTags.slice(0, 5),
					statuses: ["ready", "pending", "unavailable", "failed"],
					domains: [],
				},
			}),
		);

		expect(html).toContain("#tag-05");
		expect(html).not.toContain("Show all");
	});

	it("keeps the active tag filter visible even when collapsed beyond the cap", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				filters: { query: "", tag: "tag-20" },
				facets: {
					genres: [],
					tags: manyTags,
					statuses: ["ready", "pending", "unavailable", "failed"],
					domains: [],
				},
			}),
		);

		expect(html).toContain("#tag-20");
		expect(html).not.toContain("#tag-13");
	});

	it("returns the full list when expanded (visibleFacetValues)", () => {
		expect(visibleFacetValues(manyTags, undefined, true)).toEqual(manyTags);
		expect(visibleFacetValues(manyTags, undefined, false)).toHaveLength(12);
		expect(visibleFacetValues(manyTags, "tag-20", false)).toContain("tag-20");
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

describe("Options Drive sync affordance (MIK-024)", () => {
	it("renders a floating sync button and no rail Sync now button", () => {
		const html = render(
			viewOf({
				rows: [rowOf()],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
			}),
		);

		expect(html).toContain('aria-label="Sync with Google Drive"');
		expect(html).toContain("Sync Drive");
		expect(html).not.toContain("Sync now");
		// The rail keeps the status readout.
		expect(html).toContain("Drive sync");
		expect(html).toContain("synced");
	});

	it("keeps sync errors and pending-change info visible in the rail", () => {
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

		expect(html).toContain("Drive sync failed");
		expect(html).toContain("Local changes pending — will retry on next sync");
		expect(html).toContain('aria-label="Sync with Google Drive"');
		// A failed sync leaves the button clickable so the user can retry.
		expect(html).not.toContain('aria-busy="true"');
	});
});

describe("Options Drive sync progress feedback (MIK-026)", () => {
	it("shows cached-loading progress and disables the floating sync button", () => {
		const html = render(viewOf({ loading: true }));

		expect(html).toContain("Loading cached bookmarks…");
		expect(html).toContain("Loading your library…");
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("disabled");
		expect(html).toContain("loading…");
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
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("syncing…");
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
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("writing…");
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
		expect(html).not.toContain('aria-label="Sync with Google Drive"');
		expect(html).not.toContain("Selected bookmark");
	});

	it("renders no nav when no skills controller is provided", () => {
		const html = render(libraryView);

		expect(html).not.toContain(">Analysis skills<");
		expect(html).not.toContain('aria-label="Options screens"');
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

	it("shows the settings sync readout with a refresh action", () => {
		const html = renderSkills(
			skillsViewOf({ sync: { status: "synced", pendingLocalChanges: true } }),
		);

		expect(html).toContain("Settings sync");
		expect(html).toContain("Refresh settings");
		expect(html).toContain("Local changes pending — will retry on next sync");
	});

	it("surfaces action errors as an alert on the screen when the form is closed", () => {
		const html = renderSkills(
			skillsViewOf({ actionError: "Drive sync failed" }),
		);

		expect(html).toContain('role="alert"');
		expect(html).toContain("Drive sync failed");
	});
});

describe("Skill form modal (MIK-025)", () => {
	function renderSkills(skillsView: SkillsView): string {
		return renderWithSkills(viewOf(), skillsView, "analysis-skills");
	}

	it("renders no dialog while the form is closed", () => {
		const html = renderSkills(skillsViewOf());

		expect(html).not.toContain('role="dialog"');
	});

	it("opens a create modal with an empty form, close/cancel, and guidance", () => {
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
