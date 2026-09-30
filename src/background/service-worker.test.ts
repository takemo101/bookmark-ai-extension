import { afterEach, expect, it, vi } from "vitest";
import { type BookmarkApp, appError, err, ok } from "../lib/app/index";
import { emptyCacheState } from "../lib/storage/index";
import type { BookmarkReply } from "./bookmark-jobs";

const { createApp } = vi.hoisted(() => ({ createApp: vi.fn() }));
vi.mock("./bookmark-runtime", () => ({ createWorkerBookmarkApp: createApp }));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	createApp.mockReset();
});

it("clears stale badges at startup and updates analysis after accepting a save without a UI observer", async () => {
	const listeners: Array<
		(
			message: unknown,
			sender: { id: string; url: string },
			sendResponse: (reply: BookmarkReply) => void,
		) => void
	> = [];
	const action = {
		setBadgeText: vi.fn(async (_details: { text: string }) => {}),
		setBadgeBackgroundColor: vi.fn(async (_details: { color: string }) => {}),
		setTitle: vi.fn(async (_details: { title: string }) => {}),
	};
	const keepAlive = vi.fn(async () => ({}));
	vi.stubGlobal("chrome", {
		action,
		i18n: { getUILanguage: () => "ja" },
		runtime: {
			id: "extension-id",
			getURL: (path: string) => `chrome-extension://extension-id/${path}`,
			getPlatformInfo: keepAlive,
			onInstalled: { addListener() {} },
			onMessage: {
				addListener(listener: (typeof listeners)[number]) {
					listeners.push(listener);
				},
			},
		},
	});
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const app: BookmarkApp = {
		loadCachedState: async () => emptyCacheState(),
		saveCurrentTab: async (progress) => {
			progress?.("analyzing");
			await pending;
			return err(appError("interrupted", "test failure"));
		},
		reAnalyzeBookmark: async () => err(appError("not-found", "missing")),
		deleteBookmark: async () => ok(emptyCacheState()),
		syncFromDrive: async () => ok(emptyCacheState()),
	};
	createApp.mockReturnValue(app);
	await import("./service-worker");
	await vi.waitFor(() =>
		expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "" }),
	);
	expect(keepAlive).not.toHaveBeenCalled();
	const sendResponse = vi.fn<(reply: BookmarkReply) => void>();
	try {
		listeners[0]?.(
			{
				action: "bookmark-job",
				kind: "save",
				tab: { id: 7, url: "https://example.test/page", title: "Selected" },
			},
			{
				id: "extension-id",
				url: "chrome-extension://extension-id/src/popup/index.html",
			},
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith(
			expect.objectContaining({ ok: true }),
		);
		await vi.waitFor(() =>
			expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "AI" }),
		);
		expect(action.setTitle.mock.lastCall?.[0].title).toContain("AI分析中");
		const accepted = sendResponse.mock.lastCall?.[0];
		if (!accepted?.ok || !accepted.job) throw new Error("missing accepted job");
		const signal = createApp.mock.calls[0]?.[1];
		expect(signal).toBeInstanceOf(AbortSignal);
		const cancel = {
			action: "bookmark-job",
			kind: "cancel",
			id: accepted.job.id,
		};
		sendResponse.mockClear();
		listeners[0]?.(
			cancel,
			{ id: "extension-id", url: "https://example.test/page" },
			sendResponse,
		);
		expect(sendResponse).not.toHaveBeenCalled();
		expect(signal.aborted).toBe(false);
		listeners[0]?.(
			cancel,
			{
				id: "extension-id",
				url: "chrome-extension://extension-id/src/popup/index.html",
			},
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith(
			expect.objectContaining({ ok: true }),
		);
		expect(signal.aborted).toBe(true);
		await vi.waitFor(() =>
			expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "STOP" }),
		);
		expect(createApp).toHaveBeenCalledOnce();
	} finally {
		release();
	}
	await vi.waitFor(() =>
		expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" }),
	);
});
