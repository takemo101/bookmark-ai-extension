import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Popup } from "./Popup";
import type {
	CurrentBookmarkView,
	PopupController,
	PopupDetailView,
	PopupView,
	RecentItemView,
	TrailStage,
} from "./view-model";

/**
 * Static-markup tests for the MIK-027 popup states: the component renders with
 * a fake controller and fixed views, no DOM or Chrome required. Click behavior
 * lives in controller intents the view-model tests cover; here we pin the
 * rendered structure — the already-bookmarked current-page state with its
 * Remove affordance, the strengthened foreground-analysis running copy, and
 * the compact single-line recent list.
 */

const URL = "https://example.test/page";

function currentBookmarkOf(
	overrides: Partial<CurrentBookmarkView> = {},
): CurrentBookmarkView {
	return {
		canonicalUrl: URL,
		title: "Example Page",
		url: URL,
		description: "短い説明",
		aiStatus: "ready",
		updatedAt: "2026-03-01T00:00:00Z",
		...overrides,
	};
}

function recentOf(overrides: Partial<RecentItemView> = {}): RecentItemView {
	return {
		canonicalUrl: URL,
		title: "Recent Page",
		url: URL,
		description: "説明文",
		tags: [],
		aiStatus: "ready",
		updatedAt: "2026-03-01T00:00:00Z",
		canReAnalyze: false,
		...overrides,
	};
}

function runningTrail(): TrailStage[] {
	return [
		{ key: "saving", label: "Pending bookmark saved", status: "done" },
		{ key: "extracting", label: "Page excerpt extracted", status: "done" },
		{ key: "analyzing", label: "AI analyzing", status: "active" },
		{ key: "syncing", label: "Synced to Drive", status: "pending" },
	];
}

function viewOf(overrides: Partial<PopupView> = {}): PopupView {
	return {
		loading: false,
		tab: { title: "Example Page", url: URL },
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
		save: async () => {},
		reAnalyze: async () => {},
		selectRecent: () => {},
		clearRecentSelection: () => {},
		deleteCurrentBookmark: async () => {},
		refresh: async () => {},
	};
}

function detailOf(overrides: Partial<PopupDetailView> = {}): PopupDetailView {
	return {
		canonicalUrl: URL,
		title: "Recent Page",
		url: URL,
		description: "説明文",
		genre: "技術",
		tags: ["typescript"],
		aiStatus: "ready",
		updatedAt: "2026-03-01T00:00:00Z",
		analysisMarkdown: "## 概要\n\n分析本文。",
		analysisProfileId: "github-repository",
		analysisProfileName: "GitHubリポジトリ",
		...overrides,
	};
}

// Language is injected explicitly (MIK-029) so the assertions never depend on
// the test environment's own UI language.
function render(view: PopupView, language: "en" | "ja" = "en"): string {
	return renderToStaticMarkup(
		<Popup controller={controllerOf(view)} language={language} />,
	);
}

describe("Popup", () => {
	describe("current page bookmark state", () => {
		it("shows the already-bookmarked state with a Remove affordance", () => {
			const html = render(viewOf({ currentBookmark: currentBookmarkOf() }));

			expect(html).toContain("Already bookmarked");
			expect(html).toContain("Remove");
			expect(html).toContain(
				"Save &amp; Analyze updates this bookmark and refreshes its AI analysis.",
			);
		});

		it("shows no bookmarked state when the page is not saved", () => {
			const html = render(viewOf());

			expect(html).not.toContain("Already bookmarked");
			expect(html).not.toContain("Remove failed");
		});

		it("shows a busy Remove label while a delete is in flight", () => {
			const html = render(
				viewOf({ currentBookmark: currentBookmarkOf(), deleting: true }),
			);

			expect(html).toContain("Removing…");
			expect(html).toContain("disabled");
		});

		it("surfaces a safe delete error next to the bookmarked state", () => {
			const html = render(
				viewOf({
					currentBookmark: currentBookmarkOf(),
					deleteError: "Drive rejected the write",
				}),
			);

			expect(html).toContain("Remove failed: Drive rejected the write");
		});
	});

	describe("running flow copy", () => {
		it("tells the user to keep the popup and page open during analysis", () => {
			const html = render(
				viewOf({
					flow: { kind: "running", trail: runningTrail() },
					canSave: false,
				}),
			);

			expect(html).toContain("AI analysis is running in the foreground");
			expect(html).toContain("Keep this popup open");
			expect(html).toContain("stay on the saved page until it finishes");
		});
	});

	describe("recent detail (MIK-028)", () => {
		it("renders recent titles as clickable detail openers", () => {
			const html = render(viewOf({ recent: [recentOf()] }));

			// The row title is a real button that opens the detail dialog.
			expect(html).toContain('aria-haspopup="dialog"');
			expect(html).not.toContain('role="dialog"');
		});

		it("opens a compact detail overlay with Back/Close and safe Markdown", () => {
			const html = render(
				viewOf({ recent: [recentOf()], selectedRecent: detailOf() }),
			);

			expect(html).toContain('role="dialog"');
			expect(html).toContain('aria-modal="true"');
			expect(html).toContain('aria-labelledby="recent-detail-title"');
			expect(html).toContain("← Back");
			expect(html).toContain('aria-label="Close details"');
			// The analysisMarkdown renders through react-markdown as elements, never
			// as raw text or injected HTML.
			expect(html).toContain("概要");
			expect(html).toContain("分析本文。");
			expect(html).not.toContain("## 概要");
			// The link opens in a new tab without a referrer.
			expect(html).toContain('rel="noreferrer"');
			// The resolved profile name renders instead of the raw id (MIK-031).
			expect(html).toContain("GitHubリポジトリ");
			expect(html).not.toContain("github-repository");
		});

		it("keeps raw HTML in the analysis inert (no execution path)", () => {
			const html = render(
				viewOf({
					recent: [recentOf()],
					selectedRecent: detailOf({
						analysisMarkdown: '<img src=x onerror="alert(1)">攻撃',
					}),
				}),
			);

			// react-markdown without rehype-raw emits raw HTML as escaped literal
			// text, so no <img> element (or its onerror) ever reaches the DOM.
			expect(html).not.toContain("<img");
			expect(html).toContain("攻撃");
		});

		it("shows status and a safe error for a failed bookmark without Markdown", () => {
			const html = render(
				viewOf({
					recent: [recentOf()],
					selectedRecent: detailOf({
						aiStatus: "failed",
						aiError: "model returned no JSON",
						analysisMarkdown: undefined,
					}),
				}),
			);

			expect(html).toContain("failed");
			expect(html).toContain("model returned no JSON");
		});

		it("renders no full-ledger affordances in the detail", () => {
			const html = render(
				viewOf({ recent: [recentOf()], selectedRecent: detailOf() }),
			);

			// A reading surface only: delete/search/filters stay in Options.
			expect(html).not.toContain(">Delete<");
			expect(html).not.toContain("Search bookmarks");
		});
	});

	describe("UI language (MIK-029)", () => {
		it("renders representative Japanese strings for the ja language", () => {
			const html = render(
				viewOf({
					currentBookmark: currentBookmarkOf(),
					recent: [recentOf({ aiStatus: "failed", canReAnalyze: true })],
				}),
				"ja",
			);

			expect(html).toContain(
				"現在のタブをAI付きブックマークとして保存します。",
			);
			expect(html).toContain("現在のタブ");
			expect(html).toContain("ブックマーク済み");
			expect(html).toContain("保存＆分析");
			expect(html).toContain("最近のブックマーク");
			expect(html).toContain("再分析");
			expect(html).toContain("設定ページで管理");
			expect(html).not.toContain("Save &amp; Analyze");
			expect(html).not.toContain("Recent bookmarks");
		});

		it("localizes the running foreground notice and trail stages", () => {
			const html = render(
				viewOf({
					flow: { kind: "running", trail: runningTrail() },
					canSave: false,
				}),
				"ja",
			);

			expect(html).toContain("保存＆分析中…");
			expect(html).toContain("AI分析をフォアグラウンドで実行中です。");
			expect(html).toContain("AIが分析中");
			expect(html).toContain("Driveへ同期");
			expect(html).not.toContain("AI analysis is running in the foreground");
		});

		it("renders English strings for the en language", () => {
			const html = render(
				viewOf({ currentBookmark: currentBookmarkOf() }),
				"en",
			);

			expect(html).toContain(
				"Save the current tab as an AI-enriched bookmark.",
			);
			expect(html).toContain("Already bookmarked");
			expect(html).not.toContain("ブックマーク済み");
		});
	});

	describe("compact recent list", () => {
		it("renders one compact line per bookmark, description as tooltip only", () => {
			const html = render(
				viewOf({
					recent: [
						recentOf({ title: "First Saved" }),
						recentOf({
							canonicalUrl: "https://example.test/second",
							title: "Second Saved",
							description: undefined,
							aiStatus: "failed",
							canReAnalyze: true,
						}),
					],
				}),
			);

			expect(html).toContain("Recent bookmarks");
			expect(html).toContain("First Saved");
			expect(html).toContain("Second Saved");
			// The description moved into the title attribute; it is no longer body text.
			expect(html).toContain('title="説明文"');
			expect(html).not.toContain(">説明文<");
			// Re-analyze shows only for the non-ready row.
			expect(html.match(/Re-analyze/g)).toHaveLength(1);
		});

		it("disables Re-analyze while a flow is running", () => {
			const html = render(
				viewOf({
					flow: { kind: "running", trail: runningTrail() },
					canSave: false,
					recent: [recentOf({ aiStatus: "failed", canReAnalyze: true })],
				}),
			);

			expect(html).toContain("Re-analyze");
			expect(html).toContain("disabled");
		});
	});
});
