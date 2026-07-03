import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { lockScroll, Options, visibleTagFacets } from "./Options";
import type {
	DetailView,
	OptionsController,
	OptionsView,
	RowView,
} from "./view-model";

/**
 * Static-markup tests for the MIK-022 detail sheet and the MIK-024 list
 * polish: the component is rendered with a fake controller and a fixed view,
 * no DOM or Chrome required. Event behavior (Escape, backdrop click, quick
 * delete stopPropagation) lives in handlers the controller tests cover
 * indirectly; here we pin the rendered structure — the sheet carries dialog
 * semantics without a Re-analyze action, rows carry a quick delete button,
 * the tag facet collapses behind a cap, and Drive sync floats instead of
 * sitting in the rail. The scroll-lock and tag-cap logic are unit-tested via
 * their exported helpers because tests run in node, not jsdom.
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
		sync: { status: "synced", pendingLocalChanges: false },
		filters: { query: "" },
		facets: {
			genres: [],
			tags: [],
			statuses: ["ready", "pending", "unavailable", "failed"],
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
		clearFilters: () => {},
		select: () => {},
		clearSelection: () => {},
		deleteBookmark: async () => {},
		reAnalyze: async () => {},
	};
}

function render(view: OptionsView): string {
	return renderToStaticMarkup(<Options controller={controllerOf(view)} />);
}

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
				},
			}),
		);

		expect(html).toContain("#tag-20");
		expect(html).not.toContain("#tag-13");
	});

	it("returns the full list when expanded (visibleTagFacets)", () => {
		expect(visibleTagFacets(manyTags, undefined, true)).toEqual(manyTags);
		expect(visibleTagFacets(manyTags, undefined, false)).toHaveLength(12);
		expect(visibleTagFacets(manyTags, "tag-20", false)).toContain("tag-20");
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
				},
			}),
		);

		expect(html).toContain("Drive sync failed");
		expect(html).toContain("Local changes pending — will retry on next sync");
		expect(html).toContain('aria-label="Sync with Google Drive"');
	});
});
