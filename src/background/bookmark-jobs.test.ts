import { afterEach, expect, it, vi } from "vitest";
import {
	createBookmarkJobs,
	parseBookmarkCommand,
	isBookmarkUiSender,
} from "./bookmark-jobs";
import { type BookmarkApp, ok, err, appError } from "../lib/app/index";
import { emptyCacheState } from "../lib/storage/index";

const tab = { id: 42, url: "https://example.test/page", title: "Selected" };
function setup() {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const app: BookmarkApp = {
		loadCachedState: async () => emptyCacheState(),
		saveCurrentTab: vi.fn(async (progress) => {
			progress?.("analyzing");
			await pending;
			return err(appError("cache", "test outcome"));
		}),
		reAnalyzeBookmark: vi.fn(async () => err(appError("not-found", "missing"))),
		deleteBookmark: vi.fn(async () => ok(emptyCacheState())),
		syncFromDrive: vi.fn(async () => ok(emptyCacheState())),
	};
	const factory = vi.fn(() => app);
	const ping = vi.fn(async () => {});
	let id = 0;
	const jobs = createBookmarkJobs({
		createApp: factory,
		newId: () => `job-${++id}`,
		keepAlive: ping,
	});
	return { jobs, app, factory, ping, release };
}
afterEach(() => vi.useRealTimers());

it("accepts commands only from this extension's popup/options, never content scripts", () => {
	const base = "chrome-extension://extension-id/";
	expect(
		isBookmarkUiSender(
			{ id: "extension-id", url: `${base}src/popup/index.html` },
			"extension-id",
			base,
		),
	).toBe(true);
	expect(
		isBookmarkUiSender(
			{ id: "extension-id", url: "https://example.test" },
			"extension-id",
			base,
		),
	).toBe(false);
	expect(
		isBookmarkUiSender(
			{ id: "foreign", url: `${base}src/options/index.html` },
			"extension-id",
			base,
		),
	).toBe(false);
});

it("parses only bounded valid targets and canonicalizes bookmark keys", () => {
	expect(
		parseBookmarkCommand({ action: "bookmark-job", kind: "save", tab }),
	).toEqual({ kind: "save", tab });
	for (const bad of [
		null,
		{},
		{ kind: "save", tab },
		{ action: "bookmark-job", kind: "save", tab: { ...tab, id: -1 } },
		{
			action: "bookmark-job",
			kind: "save",
			tab: { ...tab, url: "chrome://settings" },
		},
	]) {
		expect(parseBookmarkCommand(bad)).toBeNull();
	}
	expect(
		parseBookmarkCommand({
			action: "bookmark-job",
			kind: "delete",
			canonicalUrl: "https://example.test/page#top",
		}),
	).toEqual({ kind: "delete", canonicalUrl: tab.url });
});

it("owns work after acknowledgment without any further UI messages, exposing resumable progress", async () => {
	const { jobs, factory, release } = setup();
	const accepted = jobs.handle({ kind: "save", tab });
	expect(accepted.ok).toBe(true);
	expect(factory).toHaveBeenCalledWith(tab);
	expect(jobs.handle({ kind: "status" })).toMatchObject({
		ok: true,
		job: { id: "job-1", state: "running", stage: "analyzing" },
	});
	release();
	await vi.waitFor(() =>
		expect(jobs.handle({ kind: "status", id: "job-1" })).toMatchObject({
			job: { state: "finished", result: { ok: false } },
		}),
	);
	expect(jobs.handle({ kind: "status" })).toEqual({ ok: true, job: null });
});

it("rejects duplicate save, sync and deletion while a save owns the mutation lock", async () => {
	const { jobs, app, release } = setup();
	jobs.handle({ kind: "save", tab });
	for (const command of [
		{ kind: "save", tab },
		{ kind: "sync" },
		{ kind: "delete", canonicalUrl: tab.url },
	] as const) {
		const parsed = parseBookmarkCommand({ action: "bookmark-job", ...command });
		if (!parsed) throw new Error("bad fixture");
		expect(jobs.handle(parsed)).toMatchObject({
			ok: false,
			error: { kind: "busy" },
		});
	}
	expect(app.saveCurrentTab).toHaveBeenCalledTimes(1);
	expect(app.deleteBookmark).not.toHaveBeenCalled();
	release();
});

it("a fresh worker reports a lost job, never replays or fabricates success", () => {
	const { jobs } = setup();
	expect(jobs.handle({ kind: "status", id: "previous-worker-id" })).toEqual({
		ok: true,
		job: null,
	});
});

it("bounds keepalive to four minutes, retains lock, then cleans up after completion", async () => {
	vi.useFakeTimers();
	const { jobs, ping, release } = setup();
	jobs.handle({ kind: "save", tab });
	await vi.advanceTimersByTimeAsync(250_000);
	expect(ping).toHaveBeenCalledTimes(9);
	await vi.advanceTimersByTimeAsync(100_000);
	expect(ping).toHaveBeenCalledTimes(9);
	expect(jobs.handle({ kind: "sync" })).toMatchObject({ ok: false });
	release();
	await vi.advanceTimersByTimeAsync(0);
	expect(vi.getTimerCount()).toBe(0);
});

it("sanitizes unexpected exceptions and releases the lock", async () => {
	const { jobs, app } = setup();
	vi.mocked(app.syncFromDrive).mockRejectedValueOnce(
		new Error("secret page text"),
	);
	jobs.handle({ kind: "sync" });
	await vi.waitFor(() =>
		expect(jobs.handle({ kind: "status", id: "job-1" })).toMatchObject({
			job: { state: "finished" },
		}),
	);
	expect(
		JSON.stringify(jobs.handle({ kind: "status", id: "job-1" })),
	).not.toContain("secret");
	expect(jobs.handle({ kind: "sync" }).ok).toBe(true);
});
