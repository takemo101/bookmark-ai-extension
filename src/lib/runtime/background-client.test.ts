import { expect, it, vi } from "vitest";
import { createBackgroundBookmarkClient } from "./background-client";
import { type BookmarkReply } from "../../background/bookmark-jobs";
import { emptyCacheState } from "../storage/index";
import { ok } from "../app/index";

const tab = { id: 7, url: "https://example.test", title: "Clicked tab" };
const cache = {
	load: async () => emptyCacheState(),
	save: async () => {},
	clear: async () => {},
};
it("captures the selected tab once, then only observes the accepted job", async () => {
	const tabs = { activeTab: vi.fn(async () => ok(tab)) };
	const send = vi.fn(
		async (command): Promise<BookmarkReply> =>
			command.kind === "save"
				? {
						ok: true,
						job: {
							id: "j",
							kind: "save",
							state: "running",
							stage: "analyzing",
							startedAt: Date.now(),
						},
					}
				: { ok: true, job: null },
	);
	const client = createBackgroundBookmarkClient({
		tabs,
		cache,
		send,
		wait: async () => {},
	});
	const result = await client.saveCurrentTab();
	expect(tabs.activeTab).toHaveBeenCalledOnce();
	expect(send.mock.calls[0]?.[0]).toEqual({ kind: "save", tab });
	expect(result).toMatchObject({ ok: false, error: { kind: "interrupted" } });
});
it("reconnects without a second save or tab query and relays progress", async () => {
	const tabs = { activeTab: vi.fn(async () => ok(tab)) };
	const progress = vi.fn();
	const send = vi.fn(
		async (): Promise<BookmarkReply> => ({
			ok: true,
			job: {
				id: "j",
				kind: "save",
				state: "finished",
				stage: "syncing",
				startedAt: Date.now(),
				result: { ok: false, error: { kind: "drive", message: "offline" } },
			},
		}),
	);
	const client = createBackgroundBookmarkClient({ tabs, cache, send });
	expect(await client.waitForSave("j", progress)).toMatchObject({
		ok: false,
		error: { kind: "drive" },
	});
	expect(progress).toHaveBeenCalledWith("syncing");
	expect(tabs.activeTab).not.toHaveBeenCalled();
	expect(send).toHaveBeenCalledWith({ kind: "status", id: "j" });
});
it.each([
	"save",
	"reconnect",
])("stops the observed %s by ID without ending observation or retargeting a later job", async (mode) => {
	let finished = false;
	let release!: () => void;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tabs = { activeTab: vi.fn(async () => ok(tab)) };
	const progress = vi.fn();
	const send = vi.fn(
		async (_command): Promise<BookmarkReply> => ({
			ok: true,
			job: {
				id: "original-job",
				kind: "save",
				startedAt: Date.now(),
				state: finished ? "finished" : "running",
				stage: finished ? "syncing" : "analyzing",
				...(finished
					? {
							result: {
								ok: false as const,
								error: { kind: "drive" as const, message: "offline" },
							},
						}
					: {}),
			},
		}),
	);
	const client = createBackgroundBookmarkClient({
		tabs,
		cache,
		send,
		wait: () => waiting,
	});
	const run =
		mode === "save"
			? client.saveCurrentTab(progress)
			: client.waitForSave("original-job", progress);
	let settled = false;
	void run.then(() => {
		settled = true;
	});
	await vi.waitFor(() => expect(progress).toHaveBeenCalledWith("analyzing"));
	expect(await client.stopAnalysis()).toEqual({ ok: true, value: undefined });
	expect(send).toHaveBeenCalledWith({ kind: "cancel", id: "original-job" });
	expect(settled).toBe(false);
	if (mode === "reconnect") expect(tabs.activeTab).not.toHaveBeenCalled();
	finished = true;
	release();
	await run;
	const messages = send.mock.calls.length;
	expect(await client.stopAnalysis()).toMatchObject({
		ok: false,
		error: { kind: "not-found" },
	});
	expect(send).toHaveBeenCalledTimes(messages);
});

it("handles a missing response after an extension reload", async () => {
	const client = createBackgroundBookmarkClient({
		tabs: { activeTab: async () => ok(tab) },
		cache,
		send: async () => undefined as unknown as BookmarkReply,
	});
	expect(await client.saveCurrentTab()).toMatchObject({
		ok: false,
		error: { kind: "interrupted" },
	});
});
it("does not poll indefinitely or surface transport error content", async () => {
	const client = createBackgroundBookmarkClient({
		tabs: { activeTab: async () => ok(tab) },
		cache,
		send: async () => {
			throw new Error("private data");
		},
	});
	expect(await client.saveCurrentTab()).toMatchObject({
		ok: false,
		error: { kind: "interrupted" },
	});
	const stale = createBackgroundBookmarkClient({
		tabs: { activeTab: async () => ok(tab) },
		cache,
		send: async () => ({
			ok: true,
			job: {
				id: "j",
				kind: "save",
				state: "running",
				stage: "analyzing",
				startedAt: 0,
			},
		}),
	});
	expect(await stale.waitForSave("j")).toMatchObject({
		ok: false,
		error: { kind: "interrupted" },
	});
});
