import {
	type ActiveTab,
	type AppError,
	type BookmarkApp,
	type Result,
	type SaveOutcome,
	type SaveStage,
	appError,
	err,
	ok,
} from "../lib/app/index";
import { type CanonicalUrl, canonicalizeUrl } from "../lib/bookmarks/index";

export type BookmarkCommand =
	| { kind: "save"; tab: ActiveTab }
	| { kind: "reanalyze"; tab: ActiveTab; canonicalUrl: CanonicalUrl }
	| { kind: "delete"; canonicalUrl: CanonicalUrl }
	| { kind: "sync" }
	| { kind: "cancel"; id: string }
	| { kind: "status"; id?: string };
export type BookmarkJob = {
	id: string;
	startedAt: number;
	kind: "save" | "change";
	state: "running" | "finished";
	stage: SaveStage;
	cancelRequested?: boolean;
	result?: Result<SaveOutcome | null, AppError>;
};
export type BookmarkReply =
	| { ok: true; job: BookmarkJob | null }
	| { ok: false; error: AppError };

export function isBookmarkUiSender(
	sender: { id?: string; url?: string },
	id: string,
	baseUrl: string,
): boolean {
	if (sender.id !== id || !sender.url) return false;
	try {
		const url = new URL(sender.url);
		return ["src/popup/index.html", "src/options/index.html"].some(
			(path) =>
				`${url.protocol}//${url.host}${url.pathname}` === `${baseUrl}${path}`,
		);
	} catch {
		return false;
	}
}

/** Runtime messages are untrusted; do not accept an arbitrary command or tab. */
export function parseBookmarkCommand(raw: unknown): BookmarkCommand | null {
	if (!raw || typeof raw !== "object") return null;
	const value = raw as Record<string, unknown>;
	if (value.action !== "bookmark-job") return null;
	if (value.kind === "cancel")
		return typeof value.id === "string" &&
			value.id.length > 0 &&
			value.id.length <= 100
			? { kind: "cancel", id: value.id }
			: null;
	if (value.kind === "status") {
		if (
			value.id !== undefined &&
			(typeof value.id !== "string" || value.id.length > 100)
		)
			return null;
		return { kind: "status", id: value.id as string | undefined };
	}
	if (value.kind === "sync") return { kind: "sync" };
	const canonical =
		typeof value.canonicalUrl === "string"
			? canonicalizeUrl(value.canonicalUrl)
			: null;
	if (value.kind === "delete")
		return canonical?.ok
			? { kind: "delete", canonicalUrl: canonical.value }
			: null;
	if (value.kind !== "save" && value.kind !== "reanalyze") return null;
	if (!value.tab || typeof value.tab !== "object") return null;
	const tab = value.tab as Record<string, unknown>;
	if (
		typeof tab.id !== "number" ||
		!Number.isSafeInteger(tab.id) ||
		tab.id < 0 ||
		typeof tab.url !== "string" ||
		tab.url.length > 16_384 ||
		!canonicalizeUrl(tab.url).ok ||
		typeof tab.title !== "string" ||
		tab.title.length > 16_384
	)
		return null;
	const target = { id: tab.id, url: tab.url, title: tab.title };
	if (value.kind === "save") return { kind: "save", tab: target };
	return canonical?.ok
		? { kind: "reanalyze", tab: target, canonicalUrl: canonical.value }
		: null;
}

/** One worker owns every bookmark mutation. No durable job queue or excerpts. */
export function createBookmarkJobs(deps: {
	createApp(tab?: ActiveTab, analysisSignal?: AbortSignal): BookmarkApp;
	newId(): string;
	keepAlive(): Promise<unknown>;
	/** Best-effort UI effects only; never a dependency of saving. */
	onChange?: (job: BookmarkJob) => void;
}) {
	// ponytail: one global mutation lock; per-record concurrency requires a
	// transactional collection writer, not just parallel AI promises.
	let active: BookmarkJob | undefined;
	let analysisAbort: AbortController | undefined;
	const recent = new Map<string, BookmarkJob>();

	function report(job: BookmarkJob) {
		if (job.kind !== "save") return;
		try {
			deps.onChange?.({ ...job });
		} catch {
			// A badge/display failure must not interrupt the bookmark operation.
		}
	}

	async function run(
		job: BookmarkJob,
		command: Exclude<BookmarkCommand, { kind: "status" | "cancel" }>,
		signal: AbortSignal,
	) {
		// Chrome's documented exceptional long-operation pattern, bounded even
		// when a dependency hangs. Never run this on startup or while idle.
		const interval = setInterval(() => {
			void deps.keepAlive().catch(() => {});
		}, 25_000);
		const deadline = setTimeout(() => clearInterval(interval), 240_000);
		const onProgress = (stage: SaveStage) => {
			if (
				job.state !== "running" ||
				(job.cancelRequested && stage !== "syncing")
			)
				return;
			job.stage = stage;
			report(job);
		};
		try {
			const app = deps.createApp(
				"tab" in command ? command.tab : undefined,
				signal,
			);
			switch (command.kind) {
				case "save":
					job.result = await app.saveCurrentTab(onProgress);
					break;
				case "reanalyze":
					job.result = await app.reAnalyzeBookmark(
						command.canonicalUrl,
						onProgress,
					);
					break;
				case "delete": {
					const result = await app.deleteBookmark(command.canonicalUrl);
					job.result = result.ok ? ok(null) : result;
					break;
				}
				case "sync": {
					const result = await app.syncFromDrive();
					job.result = result.ok ? ok(null) : result;
					break;
				}
				default: {
					const unexpected: never = command;
					throw new Error(`Unsupported operation: ${typeof unexpected}`);
				}
			}
		} catch {
			job.result = err(
				appError(
					"interrupted",
					"Operation interrupted. Check saved bookmarks and retry from the page.",
				),
			);
		} finally {
			clearInterval(interval);
			clearTimeout(deadline);
			job.state = "finished";
			active = undefined;
			analysisAbort = undefined;
			report(job);
		}
	}

	return {
		handle(command: BookmarkCommand): BookmarkReply {
			if (command.kind === "status")
				return {
					ok: true,
					job: command.id ? (recent.get(command.id) ?? null) : (active ?? null),
				};
			if (command.kind === "cancel") {
				if (
					active?.id !== command.id ||
					active.kind !== "save" ||
					active.stage !== "analyzing"
				)
					return {
						ok: false,
						error: appError(
							"not-found",
							"This analysis is no longer running. Check progress before retrying.",
						),
					};
				if (!active.cancelRequested) {
					active.cancelRequested = true;
					analysisAbort?.abort();
					report(active);
				}
				return { ok: true, job: active };
			}
			if (active)
				return {
					ok: false,
					error: appError(
						"busy",
						"Another bookmark operation is running. Please retry when it finishes.",
					),
				};
			const job: BookmarkJob = {
				id: deps.newId(),
				startedAt: Date.now(),
				kind:
					command.kind === "save" || command.kind === "reanalyze"
						? "save"
						: "change",
				state: "running",
				stage: "saving",
			};
			active = job;
			analysisAbort = new AbortController();
			recent.set(job.id, job);
			// Bounded receipts only; never retain extracted pages in job metadata.
			if (recent.size > 20) {
				const first = recent.keys().next().value;
				if (first) recent.delete(first);
			}
			report(job);
			void run(job, command, analysisAbort.signal);
			return { ok: true, job };
		},
	};
}
