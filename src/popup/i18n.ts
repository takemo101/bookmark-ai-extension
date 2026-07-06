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
	readonly tagline: string;
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
	readonly drivePending: (message: string) => string;
	readonly recentBookmarks: string;
	readonly reAnalyze: string;
	readonly back: string;
	readonly closeDetails: string;
	readonly updated: (date: string) => string;
	readonly manageInOptions: string;
};

const EN: PopupMessages = {
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
		"AI analysis is running in the foreground and may take a while. Keep " +
		"this popup open and stay on the saved page until it finishes.",
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
		"Saved without AI — the Prompt API was unavailable. Re-analyze later from Options.",
	failedReceipt: (message) =>
		`Saved, but analysis failed: ${message}. Re-analyze later from Options.`,
	savedReceipt: "Saved. Re-analyze later from Options.",
	drivePending: (message) => `Drive sync pending: ${message}`,
	recentBookmarks: "Recent bookmarks",
	reAnalyze: "Re-analyze",
	back: "← Back",
	closeDetails: "Close details",
	updated: (date) => `Updated ${date}`,
	manageInOptions: "Manage in Options",
};

const JA: PopupMessages = {
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
		"AI分析をフォアグラウンドで実行中です。完了するまでこのポップアップを開いたまま、" +
		"保存したページに留まってください。",
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
		"AIなしで保存しました（Prompt APIが利用できません）。後で設定ページから再分析できます。",
	failedReceipt: (message) =>
		`保存しましたが、分析に失敗しました: ${message}。後で設定ページから再分析できます。`,
	savedReceipt: "保存しました。後で設定ページから再分析できます。",
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
