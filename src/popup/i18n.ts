/**
 * Popup UI strings, English/Japanese (MIK-029).
 *
 * A plain typed dictionary — no i18n framework, no React state. The popup
 * resolves its language once per render from the browser UI language
 * (`lib/i18n`'s {@link detectUiLanguage}) or an injected override in tests, and
 * projects these strings. Domain state values (`ready`, `synced`,
 * `available`, …) intentionally stay as their internal spellings — they are
 * status enums the design keeps as-is (MIK-029 design, "UI localization").
 */
import type { SupportedLanguage } from "../lib/i18n/index";
import type { SaveStage } from "./use-cases";

export type PopupMessages = {
	readonly stopAnalysis: string;
	readonly stoppingAnalysis: string;
	readonly stopHint: string;
	readonly stopped: string;
	readonly stoppedReceipt: string;
	readonly tagline: string;
	readonly prepareAi: string;
	readonly preparationHint: string;
	readonly pendingHint: string;
	readonly currentTab: string;
	readonly readingTab: string;
	readonly noActiveTab: string;
	readonly alreadyBookmarked: string;
	readonly remove: string;
	readonly removing: string;
	readonly duplicateSaveHint: string;
	readonly removeFailed: (message: string) => string;
	readonly googleLabel: string;
	readonly promptApiLabel: string;
	readonly syncLabel: string;
	readonly localLabel: string;
	readonly changesPending: string;
	readonly connection: {
		readonly connected: string;
		readonly disconnected: string;
		readonly unknown: string;
	};
	readonly save: string;
	readonly saving: string;
	readonly runningNotice: string;
	readonly trail: Readonly<Record<SaveStage, string>>;
	readonly modelPreparing: string;
	readonly modelDownloading: (percent?: number) => string;
	readonly modelSetupHint: string;
	readonly savedLocally: string;
	readonly unavailableReceipt: string;
	readonly failedReceipt: (message: string) => string;
	readonly savedReceipt: string;
	/**
	 * Shown beside a normal `ready` status when the stored content came from the
	 * concise Summarizer fallback (docs/summarizer-fallback.md). Never exposes the
	 * underlying Prompt/browser error.
	 */
	readonly conciseFallbackNotice: string;
	readonly drivePending: (message: string) => string;
	readonly recentBookmarks: string;
	readonly reAnalyze: string;
	readonly back: string;
	readonly closeDetails: string;
	readonly updated: (date: string) => string;
	readonly manageInOptions: string;
};

const EN: PopupMessages = {
	stopAnalysis: "Stop analysis",
	stoppingAnalysis: "Stopping & saving…",
	stopHint:
		"Stops AI only. Your bookmark is kept; any Drive write finishes safely.",
	stopped: "stopped",
	stoppedReceipt:
		"Analysis stopped. Bookmark kept. Save & Analyze again from this page to retry.",
	prepareAi: "Prepare AI model",
	preparationHint:
		"Keep this popup open during preparation, then Save & Analyze. Saving itself never downloads a model.",
	pendingHint:
		"Analysis is pending. If processing was interrupted, open this page and Save & Analyze again.",
	tagline: "Save the current tab as an AI-enriched bookmark.",
	currentTab: "Current tab",
	readingTab: "Reading current tab…",
	noActiveTab: "No active tab",
	alreadyBookmarked: "Already bookmarked",
	remove: "Remove",
	removing: "Removing…",
	duplicateSaveHint:
		"Save & Analyze updates this bookmark and refreshes its AI analysis.",
	removeFailed: (message) => `Remove failed: ${message}`,
	googleLabel: "Google",
	promptApiLabel: "Prompt API",
	syncLabel: "Sync",
	localLabel: "Local",
	changesPending: "changes pending",
	connection: {
		connected: "connected",
		disconnected: "sign in",
		unknown: "unknown",
	},
	save: "Save & Analyze",
	saving: "Saving & Analyzing…",
	runningNotice:
		"You can close this popup; processing continues in the background. Keep the saved page open until page extraction finishes. Reopen to check progress. If Chrome stops processing, save the page again.",
	trail: {
		saving: "Pending bookmark saved",
		extracting: "Page excerpt extracted",
		analyzing: "AI analyzing",
		syncing: "Synced to Drive",
	},
	modelPreparing: "Preparing the AI model…",
	modelDownloading: (percent) =>
		percent === undefined
			? "Downloading the AI model…"
			: `Downloading the AI model… ${percent}%`,
	modelSetupHint:
		"Chrome is preparing the model. Keep this popup open while it finishes.",
	savedLocally: "saved locally",
	unavailableReceipt:
		"Saved without AI. Prepare the model if needed, then Save & Analyze again from this page.",
	failedReceipt: (message) =>
		`Saved, but analysis failed: ${message}. Save & Analyze again from this page to retry.`,
	savedReceipt:
		"Saved. Save & Analyze again from this page to refresh the analysis.",
	conciseFallbackNotice: "Concise summary — detailed analysis was unavailable",
	drivePending: (message) => `Drive sync pending: ${message}`,
	recentBookmarks: "Recent bookmarks",
	reAnalyze: "Re-analyze",
	back: "← Back",
	closeDetails: "Close details",
	updated: (date) => `Updated ${date}`,
	manageInOptions: "Manage in Options",
};

const JA: PopupMessages = {
	stopAnalysis: "分析を停止",
	stoppingAnalysis: "停止・保存処理中…",
	stopHint:
		"AI分析のみを停止します。ブックマークは残り、Driveへの保存は最後まで行います。",
	stopped: "停止済み",
	stoppedReceipt:
		"分析を停止しました。ブックマークは残っています。このページから保存＆分析を再実行できます。",
	prepareAi: "AIモデルを準備",
	preparationHint:
		"準備中はポップアップを開いたままお待ちください。準備後に保存＆分析を実行できます。保存時にはモデルをダウンロードしません。",
	pendingHint:
		"分析が保留中です。処理が中断された場合は、このページを開いて保存＆分析を再実行してください。",
	tagline: "現在のタブをAI付きブックマークとして保存します。",
	currentTab: "現在のタブ",
	readingTab: "現在のタブを読み込み中…",
	noActiveTab: "アクティブなタブがありません",
	alreadyBookmarked: "ブックマーク済み",
	remove: "削除",
	removing: "削除中…",
	duplicateSaveHint:
		"保存＆分析を実行すると、このブックマークを更新してAI分析を作り直します。",
	removeFailed: (message) => `削除に失敗しました: ${message}`,
	googleLabel: "Google",
	promptApiLabel: "Prompt API",
	syncLabel: "同期",
	localLabel: "ローカル",
	changesPending: "未同期の変更あり",
	connection: {
		connected: "接続済み",
		disconnected: "サインイン",
		unknown: "不明",
	},
	save: "保存＆分析",
	saving: "保存＆分析中…",
	runningNotice:
		"ポップアップを閉じても処理は続きます。ページ抽出が終わるまでは保存対象のページを閉じずにお待ちください。再表示すると進捗を確認できます。Chromeが処理を中断した場合は保存を再実行してください。",
	trail: {
		saving: "保留中のブックマークを保存",
		extracting: "ページ抜粋を抽出",
		analyzing: "AIが分析中",
		syncing: "Driveへ同期",
	},
	modelPreparing: "AIモデルを準備中…",
	modelDownloading: (percent) =>
		percent === undefined
			? "AIモデルをダウンロード中…"
			: `AIモデルをダウンロード中… ${percent}%`,
	modelSetupHint:
		"Chromeのモデルを準備しています。ポップアップを開いたままお待ちください。",
	savedLocally: "ローカル保存のみ",
	unavailableReceipt:
		"AIなしで保存しました。必要に応じてモデルを準備し、このページから保存＆分析を再実行してください。",
	failedReceipt: (message) =>
		`保存しましたが、分析に失敗しました: ${message}。このページから保存＆分析を再実行してください。`,
	savedReceipt:
		"保存しました。このページから保存＆分析を再実行すると分析を更新できます。",
	conciseFallbackNotice: "簡易要約 — 詳細分析を取得できなかったため",
	drivePending: (message) => `Drive同期が保留中: ${message}`,
	recentBookmarks: "最近のブックマーク",
	reAnalyze: "再分析",
	back: "← 戻る",
	closeDetails: "詳細を閉じる",
	updated: (date) => `更新 ${date}`,
	manageInOptions: "設定ページで管理",
};

const MESSAGES: Readonly<Record<SupportedLanguage, PopupMessages>> = {
	en: EN,
	ja: JA,
};

/** The popup dictionary for one UI language. */
export function popupMessages(language: SupportedLanguage): PopupMessages {
	return MESSAGES[language];
}
