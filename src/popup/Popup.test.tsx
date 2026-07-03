import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Popup } from "./Popup";
import type {
	CurrentBookmarkView,
	PopupController,
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
		deleteCurrentBookmark: async () => {},
		refresh: async () => {},
	};
}

function render(view: PopupView): string {
	return renderToStaticMarkup(<Popup controller={controllerOf(view)} />);
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
