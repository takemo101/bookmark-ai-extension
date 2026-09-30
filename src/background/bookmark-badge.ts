import type { SupportedLanguage } from "../lib/i18n/index";
import type { BookmarkJob } from "./bookmark-jobs";

const LABELS = {
	ja: {
		saving: "ブックマークを保存中",
		extracting: "ページを抽出中",
		analyzing: "AI分析中",
		syncing: "Driveへ同期中",
		saved: "分析結果を保存し、Driveへ同期しました",
		failed: "保存・分析に失敗しました。ポップアップで確認してください",
		unavailable: "AIは利用できません。ブックマークは保存しました",
		unsynced: "ローカル保存のみです。Drive同期を確認してください",
		pending: "分析が保留中です。ポップアップで確認してください",
		stopping: "AI分析を停止中です。ブックマークの保存は続きます",
		stopped: "AI分析を停止しました。ブックマークはDriveへ保存しました",
		stoppedUnsynced:
			"AI分析を停止しました。ローカル保存のみです。Drive同期を確認してください",
	},
	en: {
		saving: "Saving bookmark",
		extracting: "Reading page",
		analyzing: "Analyzing with AI",
		syncing: "Syncing to Drive",
		saved: "Saved analysis and synced to Drive",
		failed: "Save or analysis failed. Check the popup",
		unavailable: "AI unavailable. Bookmark saved",
		unsynced: "Saved locally only. Check Drive sync",
		pending: "Analysis pending. Check the popup",
		stopping: "Stopping AI analysis. Bookmark saving continues",
		stopped: "AI analysis stopped. Bookmark saved to Drive",
		stoppedUnsynced:
			"AI analysis stopped. Saved locally only. Check Drive sync",
	},
} as const;
const STAGE_TEXT = {
	saving: "SAVE",
	extracting: "READ",
	analyzing: "AI",
	syncing: "SYNC",
} as const;

function badgeFor(job: BookmarkJob | null, language: SupportedLanguage) {
	const labels = LABELS[language];
	if (!job) return { text: "", color: "#2563eb", title: "Bookmark AI" };
	if (
		job.state === "running" &&
		job.cancelRequested &&
		job.stage === "analyzing"
	)
		return {
			text: "STOP",
			color: "#b45309",
			title: `Bookmark AI — ${labels.stopping}`,
		};
	if (job.state === "running")
		return {
			text: STAGE_TEXT[job.stage],
			color: "#2563eb",
			title: `Bookmark AI — ${labels[job.stage]}`,
		};
	const result = job.result;
	if (result?.ok && result.value?.cancelled)
		return {
			text: result.value.driveSynced ? "STOP" : "!",
			color: "#b45309",
			title: `Bookmark AI — ${result.value.driveSynced ? labels.stopped : labels.stoppedUnsynced}`,
		};
	if (!result?.ok || !result.value || result.value.aiStatus === "failed") {
		return {
			text: "!",
			color: "#b91c1c",
			title: `Bookmark AI — ${labels.failed}`,
		};
	}
	const outcome = result.value;
	if (!outcome.driveSynced)
		return {
			text: "!",
			color: "#b45309",
			title: `Bookmark AI — ${labels.unsynced}`,
		};
	if (outcome.aiStatus !== "ready")
		return {
			text: "!",
			color: "#b45309",
			title: `Bookmark AI — ${outcome.aiStatus === "unavailable" ? labels.unavailable : labels.pending}`,
		};
	return {
		text: "✓",
		color: "#15803d",
		title: `Bookmark AI — ${labels.saved}`,
	};
}

/** Display only: no bookmark content, storage, timers, or tab-specific overrides. */
export function createBookmarkBadge(
	action: {
		setBadgeText(details: { text: string }): Promise<void>;
		setBadgeBackgroundColor(details: { color: string }): Promise<void>;
		setTitle(details: { title: string }): Promise<void>;
	},
	language: SupportedLanguage,
) {
	let writes = Promise.resolve();
	return {
		update(job: BookmarkJob | null): Promise<void> {
			if (job && job.kind !== "save") return Promise.resolve();
			// Capture now: the job can advance before Chrome finishes an older write.
			const view = badgeFor(job, language);
			writes = writes.then(async () => {
				for (const write of [
					() => action.setBadgeBackgroundColor({ color: view.color }),
					() => action.setBadgeText({ text: view.text }),
					() => action.setTitle({ title: view.title }),
				]) {
					try {
						await write();
					} catch {
						/* Best-effort display; saving must continue. */
					}
				}
			});
			return writes;
		},
	};
}
