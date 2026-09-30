import { expect, it, vi } from "vitest";
import { createBookmarkBadge } from "./bookmark-badge";
import type { BookmarkJob } from "./bookmark-jobs";
import { type SaveOutcome, appError, err, ok } from "../lib/app/index";
import { Bookmarks, bookmarkId, isoTimestamp } from "../lib/bookmarks/index";

function setup(language: "ja" | "en" = "en") {
	const action = {
		setBadgeText: vi.fn(async (_details: { text: string }) => {}),
		setBadgeBackgroundColor: vi.fn(async (_details: { color: string }) => {}),
		setTitle: vi.fn(async (_details: { title: string }) => {}),
	};
	return { action, badge: createBookmarkBadge(action, language) };
}
function running(stage: BookmarkJob["stage"]): BookmarkJob {
	return { id: "job-1", startedAt: 0, kind: "save", state: "running", stage };
}
function outcome(
	aiStatus: SaveOutcome["aiStatus"],
	driveSynced = true,
): SaveOutcome {
	const result = Bookmarks.empty().upsert(
		{ url: "https://private.test/page", title: "Private title", aiStatus },
		{ id: bookmarkId("id-1"), now: isoTimestamp("2026-10-01T00:00:00Z") },
	);
	if (!result.ok) throw new Error("bad fixture");
	const record = result.value.toArray()[0];
	if (!record) throw new Error("missing fixture");
	return { record, aiStatus, driveSynced };
}
function finished(value: SaveOutcome): BookmarkJob {
	return { ...running("syncing"), state: "finished", result: ok(value) };
}

it.each([
	["saving", "SAVE", "Saving"],
	["extracting", "READ", "Reading"],
	["analyzing", "AI", "Analyzing"],
	["syncing", "SYNC", "Syncing"],
] as const)("shows %s on the global icon without needing a popup", async (stage, text, title) => {
	const { action, badge } = setup();
	await badge.update(running(stage));
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text });
	expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
		color: "#2563eb",
	});
	expect(action.setTitle.mock.lastCall?.[0].title).toContain(title);
});

it.each([
	["ready", true, "✓", "#15803d"],
	["ready", false, "!", "#b45309"],
	["unavailable", true, "!", "#b45309"],
	["failed", true, "!", "#b91c1c"],
	["pending", true, "!", "#b45309"],
] as const)("reflects AI %s / Drive synced %s rather than claiming every finished job succeeded", async (aiStatus, synced, text, color) => {
	const { action, badge } = setup();
	await badge.update(finished(outcome(aiStatus, synced)));
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text });
	expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color });
	expect(JSON.stringify(action.setTitle.mock.calls)).not.toMatch(
		/Private title|private\.test/,
	);
});

it.each([
	"ja",
	"en",
] as const)("shows stopping then syncing then stopped, never an AI success (%s)", async (language) => {
	const { action, badge } = setup(language);
	await badge.update({ ...running("analyzing"), cancelRequested: true });
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "STOP" });
	expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
		color: "#b45309",
	});
	await badge.update({ ...running("syncing"), cancelRequested: true });
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "SYNC" });
	await badge.update(finished({ ...outcome("failed"), cancelled: true }));
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "STOP" });
	expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
		color: "#b45309",
	});
	expect(action.setTitle.mock.lastCall?.[0].title).toContain(
		language === "ja" ? "停止" : "stopped",
	);
	await badge.update(
		finished({ ...outcome("failed", false), cancelled: true }),
	);
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" });
	expect(action.setTitle.mock.lastCall?.[0].title).toContain(
		language === "ja" ? "ローカル" : "locally",
	);
});

it("shows a safe failure without displaying a raw exception or bookmark data", async () => {
	const { action, badge } = setup("ja");
	await badge.update({
		...running("saving"),
		state: "finished",
		result: err(appError("interrupted", "secret browser message")),
	});
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" });
	expect(action.setTitle.mock.lastCall?.[0].title).toContain("失敗");
	expect(JSON.stringify(action.setTitle.mock.calls)).not.toContain("secret");
});

it("clears a stale badge/title on worker startup; reset cannot overwrite a newly started save", async () => {
	const { action, badge } = setup("ja");
	let release!: () => void;
	action.setBadgeText.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
	});
	const reset = badge.update(null);
	await vi.waitFor(() => expect(action.setBadgeText).toHaveBeenCalledOnce());
	const job = running("analyzing");
	const analyzing = badge.update(job);
	// Snapshot immediately, rather than reading this mutable job later.
	job.stage = "syncing";
	expect(action.setBadgeText).toHaveBeenCalledOnce();
	release();
	await Promise.all([reset, analyzing]);
	expect(action.setBadgeText.mock.calls).toEqual([
		[{ text: "" }],
		[{ text: "AI" }],
	]);
	expect(action.setTitle.mock.calls[0]?.[0]).toEqual({ title: "Bookmark AI" });
	expect(action.setTitle.mock.lastCall?.[0].title).toContain("分析中");
});

it("catches every display API failure and still processes the next status", async () => {
	const { action, badge } = setup();
	action.setBadgeText.mockRejectedValueOnce(new Error("Badge text failed"));
	action.setBadgeBackgroundColor.mockRejectedValueOnce(
		new Error("Badge color failed"),
	);
	action.setTitle.mockRejectedValueOnce(new Error("Title failed"));
	await expect(badge.update(running("analyzing"))).resolves.toBeUndefined();
	await badge.update(finished(outcome("ready")));
	expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "✓" });
	expect(action.setTitle.mock.lastCall?.[0].title).toContain("Saved");
});

it("does not turn a manual Options sync/delete into an analysis-success badge", async () => {
	const { action, badge } = setup();
	await badge.update({ ...running("saving"), kind: "change" });
	expect(action.setBadgeText).not.toHaveBeenCalled();
});
