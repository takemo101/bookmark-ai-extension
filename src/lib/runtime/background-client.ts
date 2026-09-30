import type {
	BookmarkCommand,
	BookmarkJob,
	BookmarkReply,
} from "../../background/bookmark-jobs";
import {
	type AppError,
	type BookmarkApp,
	type Result,
	type SaveOutcome,
	type SaveProgress,
	type TabProviderPort,
	appError,
	err,
	ok,
} from "../app/index";
import type { LocalCache } from "../storage/index";

export function createBackgroundBookmarkClient(deps: {
	tabs: TabProviderPort;
	cache: LocalCache;
	send(command: BookmarkCommand): Promise<BookmarkReply>;
	wait?: () => Promise<void>;
}): BookmarkApp & {
	activeSave(): Promise<string | null>;
	stopAnalysis(): Promise<Result<void, AppError>>;
	waitForSave(
		id: string,
		onProgress?: SaveProgress,
	): Promise<Result<SaveOutcome, AppError>>;
} {
	let observedSaveId: string | undefined;
	const interrupted = () =>
		err(
			appError(
				"interrupted",
				"Could not confirm background completion. Check saved bookmarks; save the page again only if needed.",
			),
		);
	async function send(command: BookmarkCommand): Promise<BookmarkReply> {
		try {
			const reply = await deps.send(command);
			return reply && typeof reply.ok === "boolean" ? reply : interrupted();
		} catch {
			return interrupted();
		}
	}
	async function observe(
		initial: BookmarkReply,
		progress?: SaveProgress,
	): Promise<Result<SaveOutcome | null, AppError>> {
		let reply = initial;
		while (reply.ok && reply.job) {
			const job: BookmarkJob = reply.job;
			progress?.(job.stage);
			if (job.state === "finished") return job.result ?? interrupted();
			// Polling must not become an unbounded keepalive for a stuck worker.
			if (Date.now() - job.startedAt >= 240_000) return interrupted();
			await (deps.wait?.() ??
				new Promise<void>((resolve) => setTimeout(resolve, 750)));
			reply = await send({ kind: "status", id: job.id });
		}
		return reply.ok ? interrupted() : reply;
	}
	async function saveResult(
		reply: BookmarkReply,
		progress?: SaveProgress,
	): Promise<Result<SaveOutcome, AppError>> {
		const id =
			reply.ok && reply.job?.kind === "save" ? reply.job.id : undefined;
		if (id) observedSaveId = id;
		try {
			const result = await observe(reply, progress);
			if (!result.ok) return result;
			return result.value ? ok(result.value) : interrupted();
		} finally {
			if (observedSaveId === id) observedSaveId = undefined;
		}
	}
	async function change(command: BookmarkCommand) {
		const result = await observe(await send(command));
		return result.ok ? ok(await deps.cache.load()) : result;
	}
	return {
		loadCachedState: () => deps.cache.load(),
		syncFromDrive: () => change({ kind: "sync" }),
		deleteBookmark: (canonicalUrl) => change({ kind: "delete", canonicalUrl }),
		async saveCurrentTab(progress) {
			const tab = await deps.tabs.activeTab();
			if (!tab.ok) return tab;
			return saveResult(await send({ kind: "save", tab: tab.value }), progress);
		},
		async reAnalyzeBookmark(canonicalUrl, progress) {
			const tab = await deps.tabs.activeTab();
			if (!tab.ok) return tab;
			return saveResult(
				await send({ kind: "reanalyze", canonicalUrl, tab: tab.value }),
				progress,
			);
		},
		async stopAnalysis() {
			// Never ask the worker to stop whatever happens to be active now.
			if (!observedSaveId)
				return err(appError("not-found", "No observed analysis is running."));
			const reply = await send({ kind: "cancel", id: observedSaveId });
			return reply.ok && reply.job
				? ok(undefined)
				: reply.ok
					? interrupted()
					: reply;
		},
		async activeSave() {
			const reply = await send({ kind: "status" });
			return reply.ok && reply.job?.kind === "save" ? reply.job.id : null;
		},
		async waitForSave(id, progress) {
			return saveResult(await send({ kind: "status", id }), progress);
		},
	};
}
