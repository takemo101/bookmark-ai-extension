import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Options } from "./Options";
import type {
	DetailView,
	OptionsController,
	OptionsView,
	RowView,
} from "./view-model";

/**
 * Static-markup tests for the MIK-022 detail sheet: the component is rendered
 * with a fake controller and a fixed view, no DOM or Chrome required. Event
 * behavior (Escape, backdrop click) lives in handlers the controller tests
 * cover indirectly; here we pin the rendered structure — the old detail pane
 * is gone, the sheet carries dialog semantics, and busy state disables the
 * mutating actions while keeping Open/Close available.
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

	it("keeps Open/Close while disabling Re-analyze/Delete and warns during busy analysis", () => {
		const html = render(
			viewOf({
				rows: [rowOf({ selected: true, canReAnalyze: true })],
				totalCount: 1,
				filteredCount: 1,
				empty: false,
				busy: true,
				selected: detailOf({ aiStatus: "failed", canReAnalyze: true }),
			}),
		);

		expect(html).toContain(
			"Analyzing in the foreground — keep this page open until it finishes.",
		);
		expect(html).toContain("Analyzing…");
		expect(html).toContain("disabled");
		expect(html).toContain(">Open<");
		expect(html).toContain(">Close<");
	});
});
