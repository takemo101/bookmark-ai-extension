import { afterEach, expect, it, vi } from "vitest";
import {
	createBookmarkJobs,
	parseBookmarkCommand,
	isBookmarkUiSender,
	type BookmarkJob,
} from "./bookmark-jobs";
import {
	type ActiveTab,
	type BookmarkApp,
	ok,
	err,
	appError,
} from "../lib/app/index";
import { emptyCacheState } from "../lib/storage/index";

const tab = { id: 42, url: "https://example.test/page", title: "Selected" };
function setup(onChange?: (job: BookmarkJob) => void) {
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
	const factory = vi.fn((_tab?: ActiveTab, _signal?: AbortSignal) => app);
	const ping = vi.fn(async () => {});
	let id = 0;
	const jobs = createBookmarkJobs({
		createApp: factory,
		newId: () => `job-${++id}`,
		keepAlive: ping,
		onChange,
	});
	return { jobs, app, factory, ping, release };
}
afterEach(() => vi.useRealTimers());

it("parses only a bounded nonempty cancel job ID", () => {
	const command = { action: "bookmark-job", kind: "cancel", id: "job-1" };
	expect(parseBookmarkCommand(command)).toEqual({
		kind: "cancel",
		id: "job-1",
	});
	for (const id of [undefined, null, 1, "", "x".repeat(101)])
		expect(parseBookmarkCommand({ ...command, id })).toBeNull();
});

it("cancels only the selected analysis, idempotently, while retaining the mutation lock", async () => {
	const onChange = vi.fn();
	const { jobs, factory, release } = setup(onChange);
	jobs.handle({ kind: "save", tab });
	const signal = factory.mock.calls[0]?.[1];
	expect(signal?.aborted).toBe(false);
	expect(jobs.handle({ kind: "cancel", id: "old-job" }).ok).toBe(false);
	expect(signal?.aborted).toBe(false);
	expect(jobs.handle({ kind: "cancel", id: "job-1" })).toMatchObject({
		ok: true,
		job: { state: "running", cancelRequested: true },
	});
	expect(signal?.aborted).toBe(true);
	const reports = onChange.mock.calls.length;
	expect(jobs.handle({ kind: "cancel", id: "job-1" }).ok).toBe(true);
	expect(onChange).toHaveBeenCalledTimes(reports);
	expect(jobs.handle({ kind: "sync" })).toMatchObject({
		ok: false,
		error: { kind: "busy" },
	});
	release();
	await vi.waitFor(() =>
		expect(jobs.handle({ kind: "status" })).toEqual({ ok: true, job: null }),
	);
	expect(jobs.handle({ kind: "cancel", id: "job-1" }).ok).toBe(false);
	expect(jobs.handle({ kind: "sync" }).ok).toBe(true);
});

it.each([
	"saving",
	"extracting",
	"syncing",
] as const)("cannot cancel during %s", async (stage) => {
	const { jobs, factory, app, release } = setup();
	vi.mocked(app.saveCurrentTab).mockImplementationOnce(async (progress) => {
		progress?.(stage);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		return err(appError("cache", "test outcome"));
	});
	jobs.handle({ kind: "save", tab });
	expect(jobs.handle({ kind: "cancel", id: "job-1" }).ok).toBe(false);
	expect(factory.mock.calls[0]?.[1]?.aborted).toBe(false);
	release();
	await vi.waitFor(() =>
		expect(jobs.handle({ kind: "status" })).toEqual({ ok: true, job: null }),
	);
});

it("reports save stages and completion without polling; busy/status do not overwrite the badge", async () => {
	const onChange = vi.fn();
	const { jobs, release } = setup(onChange);
	jobs.handle({ kind: "save", tab });
	expect(onChange.mock.calls.map(([job]) => [job.stage, job.state])).toEqual([
		["saving", "running"],
		["analyzing", "running"],
	]);
	jobs.handle({ kind: "status" });
	jobs.handle({ kind: "save", tab });
	expect(onChange).toHaveBeenCalledTimes(2);
	release();
	await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(3));
	expect(onChange.mock.lastCall?.[0]).toMatchObject({
		state: "finished",
		result: { ok: false },
	});
});

it("reports re-analysis stages and does not replace the latest save badge for Options changes", async () => {
	const onChange = vi.fn();
	const { jobs, app } = setup(onChange);
	vi.mocked(app.reAnalyzeBookmark).mockImplementationOnce(
		async (_url, progress) => {
			progress?.("extracting");
			progress?.("analyzing");
			progress?.("syncing");
			return err(appError("not-found", "missing"));
		},
	);
	const command = parseBookmarkCommand({
		action: "bookmark-job",
		kind: "reanalyze",
		tab,
		canonicalUrl: tab.url,
	});
	if (!command) throw new Error("bad fixture");
	jobs.handle(command);
	await vi.waitFor(() =>
		expect(onChange.mock.lastCall?.[0].state).toBe("finished"),
	);
	expect(onChange.mock.calls.map(([job]) => [job.stage, job.state])).toEqual([
		["saving", "running"],
		["extracting", "running"],
		["analyzing", "running"],
		["syncing", "running"],
		["syncing", "finished"],
	]);
	onChange.mockClear();
	jobs.handle({ kind: "sync" });
	await vi.waitFor(() =>
		expect(jobs.handle({ kind: "status" })).toEqual({ ok: true, job: null }),
	);
	expect(onChange).not.toHaveBeenCalled();
});

it("ignores a finished job's late progress instead of overwriting a newer job's badge", async () => {
	const onChange = vi.fn();
	const { jobs, app, release } = setup(onChange);
	let lateProgress: Parameters<BookmarkApp["saveCurrentTab"]>[0];
	vi.mocked(app.saveCurrentTab).mockImplementationOnce(async (progress) => {
		lateProgress = progress;
		return err(appError("interrupted", "first job ended"));
	});
	jobs.handle({ kind: "save", tab });
	await vi.waitFor(() =>
		expect(jobs.handle({ kind: "status" })).toEqual({ ok: true, job: null }),
	);
	jobs.handle({ kind: "save", tab });
	onChange.mockClear();
	lateProgress?.("analyzing");
	expect(onChange).not.toHaveBeenCalled();
	release();
});

it("ignores cancelled AI's late progress while final Drive persistence is still running", async () => {
	const { jobs, app } = setup();
	let lateProgress: Parameters<BookmarkApp["saveCurrentTab"]>[0];
	let finish!: () => void;
	vi.mocked(app.saveCurrentTab).mockImplementationOnce(async (progress) => {
		lateProgress = progress;
		progress?.("analyzing");
		await new Promise<void>((resolve) => {
			finish = resolve;
		});
		return err(appError("interrupted", "test outcome"));
	});
	jobs.handle({ kind: "save", tab });
	try {
		jobs.handle({ kind: "cancel", id: "job-1" });
		lateProgress?.("syncing");
		lateProgress?.("analyzing");
		expect(jobs.handle({ kind: "status" })).toMatchObject({
			job: { stage: "syncing", state: "running" },
		});
		expect(jobs.handle({ kind: "cancel", id: "job-1" }).ok).toBe(false);
	} finally {
		finish();
		await vi.waitFor(() =>
			expect(jobs.handle({ kind: "status" })).toEqual({ ok: true, job: null }),
		);
	}
});

it("a throwing progress observer cannot interrupt work or leave the mutation lock held", async () => {
	const { jobs, release } = setup(() => {
		throw new Error("Badge API failed");
	});
	expect(jobs.handle({ kind: "save", tab }).ok).toBe(true);
	release();
	await vi.waitFor(() =>
		expect(jobs.handle({ kind: "status", id: "job-1" })).toMatchObject({
			job: { state: "finished" },
		}),
	);
	expect(jobs.handle({ kind: "sync" }).ok).toBe(true);
});

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
	expect(factory).toHaveBeenCalledWith(tab, expect.any(AbortSignal));
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
