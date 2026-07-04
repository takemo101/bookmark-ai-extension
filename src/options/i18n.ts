/**
 * Options UI strings, English/Japanese (MIK-029).
 *
 * A plain typed dictionary — no i18n framework, no React state. The options
 * page resolves its language once per render from the browser UI language
 * (`lib/i18n`'s {@link detectUiLanguage}) or an injected override in tests.
 * Domain state values (`ready`, `synced`, …) intentionally stay as their
 * internal spellings — they are status enums the design keeps as-is (MIK-029
 * design, "UI localization"). Controller-produced error/notice text also stays
 * as produced; only static component copy lives here.
 */
import type { SupportedLanguage } from "../lib/i18n/index";

/** The growable facets whose Show all/fewer copy needs a plural noun. */
export type FacetUnit = "domains" | "tags";

export type OptionsMessages = {
	readonly researchLedger: string;
	readonly navAria: string;
	readonly library: string;
	readonly analysisSkills: string;
	readonly search: string;
	readonly searchPlaceholder: string;
	readonly searchAria: string;
	readonly shownOf: (filtered: number, total: number) => string;
	readonly clearFilters: string;
	readonly driveSync: string;
	readonly loadingCached: string;
	readonly syncingDrive: string;
	readonly writingDrive: string;
	readonly pendingLocal: string;
	readonly lastSynced: (time: string) => string;
	readonly syncButton: string;
	readonly syncAria: string;
	readonly syncDetail: {
		readonly loading: string;
		readonly syncing: string;
		readonly writing: string;
	};
	readonly filters: string;
	readonly filtersAria: string;
	readonly domain: string;
	readonly genre: string;
	readonly tags: string;
	readonly aiStatus: string;
	readonly showAll: (count: number, unit: FacetUnit) => string;
	readonly showFewer: (unit: FacetUnit) => string;
	/** Option count shown while a facet group is collapsed (MIK-035). */
	readonly facetCount: (count: number) => string;
	readonly loadingLibrary: string;
	readonly emptyLibrary: string;
	readonly noMatches: string;
	readonly deleteRowAria: (title: string) => string;
	readonly deleteRowTitle: string;
	readonly detailPending: string;
	readonly detailNoDescription: string;
	readonly profileLabel: string;
	readonly editProfileAria: (name: string) => string;
	readonly analysisLabel: string;
	readonly createdLabel: string;
	readonly updatedLabel: string;
	readonly analyzedLabel: string;
	readonly open: string;
	readonly deleteAction: string;
	readonly close: string;
	readonly closeDetailsAria: string;
	readonly busyNotice: string;
	readonly skillsScreenAria: string;
	/** User-facing one-line subtitle under the Analysis skills screen title. */
	readonly skillsSubtitle: string;
	/** Rail guidance panel label holding the settings-file context (MIK-038). */
	readonly skillsAbout: string;
	readonly skillsIntro: { readonly before: string; readonly after: string };
	readonly settingsSync: string;
	readonly settingsSyncingDrive: string;
	readonly settingsWritingDrive: string;
	readonly syncSettingsButton: string;
	readonly settingsSyncAria: string;
	readonly loadingSkills: string;
	readonly builtIn: string;
	readonly custom: string;
	readonly addCustom: string;
	readonly noCustom: string;
	readonly priority: (value: number) => string;
	readonly disabledMark: string;
	readonly enable: string;
	readonly disable: string;
	readonly edit: string;
	readonly newSkill: string;
	readonly editSkill: string;
	readonly closeSkillFormAria: string;
	readonly formName: string;
	readonly formPriority: string;
	readonly formDomains: string;
	readonly formUrlPatterns: string;
	readonly formInstruction: string;
	readonly saveChanges: string;
	readonly createSkill: string;
	readonly cancel: string;
	readonly guidance: {
		readonly aria: string;
		readonly title: string;
		readonly intro: string;
		readonly examplesHeading: string;
		readonly examples: readonly string[];
		readonly neverHeading: string;
		readonly never: readonly string[];
		readonly matchingHeading: string;
		readonly matching: readonly string[];
	};
};

const EN: OptionsMessages = {
	researchLedger: "Research Ledger",
	navAria: "Options screens",
	library: "Library",
	analysisSkills: "Analysis skills",
	search: "Search",
	searchPlaceholder: "Title, URL, summary, tags…",
	searchAria: "Search bookmarks",
	shownOf: (filtered, total) => `${filtered} of ${total} shown`,
	clearFilters: "Clear filters",
	driveSync: "Drive sync",
	loadingCached: "Loading cached bookmarks…",
	syncingDrive: "Syncing with Google Drive…",
	writingDrive: "Writing changes to Google Drive…",
	pendingLocal: "Local changes pending — will retry on next sync",
	lastSynced: (time) => `Last synced ${time}`,
	syncButton: "Sync Drive",
	syncAria: "Sync with Google Drive",
	syncDetail: {
		loading: "loading…",
		syncing: "syncing…",
		writing: "writing…",
	},
	filters: "Filters",
	filtersAria: "Bookmark filters",
	domain: "Domain",
	genre: "Genre",
	tags: "Tags",
	aiStatus: "AI status",
	showAll: (count, unit) => `Show all ${count} ${unit}`,
	showFewer: (unit) => `Show fewer ${unit}`,
	facetCount: (count) => `${count} options`,
	loadingLibrary: "Loading your library…",
	emptyLibrary:
		"No bookmarks yet. Save the current tab from the popup to start your ledger.",
	noMatches: "No bookmarks match the current search and filters.",
	deleteRowAria: (title) => `Delete ${title}`,
	deleteRowTitle: "Delete bookmark",
	detailPending: "AI analysis has not finished for this bookmark yet.",
	detailNoDescription: "No AI description yet.",
	profileLabel: "Profile",
	editProfileAria: (name) => `Edit analysis skill ${name}`,
	analysisLabel: "Analysis",
	createdLabel: "Created",
	updatedLabel: "Updated",
	analyzedLabel: "Analyzed",
	open: "Open",
	deleteAction: "Delete",
	close: "Close",
	closeDetailsAria: "Close details",
	busyNotice: "Working — keep this page open until it finishes.",
	skillsScreenAria: "Analysis skills settings",
	skillsSubtitle: "Tune how the AI analyzes the pages you save",
	skillsAbout: "About custom skills",
	skillsIntro: {
		before:
			"Custom skills tune the AI analysis for matching pages. They are stored in ",
		after: " in your Google Drive.",
	},
	settingsSync: "Settings sync",
	settingsSyncingDrive: "Syncing settings with Google Drive…",
	settingsWritingDrive: "Writing settings changes to Google Drive…",
	syncSettingsButton: "Sync settings",
	settingsSyncAria: "Sync analysis skill settings",
	loadingSkills: "Loading analysis skills…",
	builtIn: "Built-in (read-only)",
	custom: "Custom (Drive-synced)",
	addCustom: "Add custom skill",
	noCustom: "No custom skills yet.",
	priority: (value) => `priority ${value}`,
	disabledMark: "disabled",
	enable: "Enable",
	disable: "Disable",
	edit: "Edit",
	newSkill: "New custom skill",
	editSkill: "Edit custom skill",
	closeSkillFormAria: "Close skill form",
	formName: "Name",
	formPriority: "Priority",
	formDomains: "Domains (comma-separated, e.g. github.com)",
	formUrlPatterns:
		"URL patterns (comma-separated, `*` wildcard, e.g. example.com/docs/*)",
	formInstruction: "Instruction",
	saveChanges: "Save changes",
	createSkill: "Create skill",
	cancel: "Cancel",
	guidance: {
		aria: "Instruction writing guidance",
		title: "Writing a good instruction",
		intro:
			"The instruction refines what the AI analysis emphasizes for matching pages, and can also control the output shape of the analysis note — its headings, sections, and length — which takes priority over the default long-form format. It cannot change the JSON keys, the output language, what is stored, or where your data goes.",
		examplesHeading: "Examples",
		examples: [
			"GitHub repository: “Emphasize architecture, key APIs, setup steps, and adoption risks.”",
			"Technical article: “Summarize the main claims, prerequisites, and caveats.”",
			"Official docs: “Highlight the covered version, concrete steps, and integration constraints.”",
			"Video page: “Use only the two headings ## Video overview and ## Comment picks, with a one-sentence overview within 100 characters.”",
		],
		neverHeading: "Never write instructions that",
		never: [
			"request secrets, tokens, or credentials;",
			"ask to persist raw page content or excerpts;",
			"ask to call external APIs or AI providers;",
			"ask to change the output language or the AI model;",
			"try to change the output schema or the privacy contract.",
		],
		matchingHeading: "How matching works",
		matching: [
			"Domains match the page’s host (e.g. github.com).",
			"URL patterns narrow matches with * wildcards (e.g. example.com/docs/*).",
			"When several skills match, the higher priority wins first, then the more specific match.",
		],
	},
};

const JA: OptionsMessages = {
	researchLedger: "リサーチ台帳",
	navAria: "設定画面の切り替え",
	library: "ライブラリ",
	analysisSkills: "分析スキル",
	search: "検索",
	searchPlaceholder: "タイトル・URL・要約・タグ…",
	searchAria: "ブックマークを検索",
	shownOf: (filtered, total) => `全${total}件中${filtered}件を表示`,
	clearFilters: "フィルタをクリア",
	driveSync: "Drive同期",
	loadingCached: "キャッシュ済みブックマークを読み込み中…",
	syncingDrive: "Google Driveと同期中…",
	writingDrive: "Google Driveに変更を書き込み中…",
	pendingLocal: "未同期のローカル変更があります — 次回の同期で再試行します",
	lastSynced: (time) => `最終同期 ${time}`,
	syncButton: "Driveと同期",
	syncAria: "Google Driveと同期",
	syncDetail: {
		loading: "読み込み中…",
		syncing: "同期中…",
		writing: "書き込み中…",
	},
	filters: "フィルタ",
	filtersAria: "ブックマークフィルタ",
	domain: "ドメイン",
	genre: "ジャンル",
	tags: "タグ",
	aiStatus: "AIステータス",
	showAll: (count) => `すべて表示（${count}件）`,
	showFewer: () => "表示を減らす",
	facetCount: (count) => `${count}件`,
	loadingLibrary: "ライブラリを読み込み中…",
	emptyLibrary:
		"まだブックマークがありません。ポップアップから現在のタブを保存して台帳を始めましょう。",
	noMatches: "現在の検索・フィルタに一致するブックマークはありません。",
	deleteRowAria: (title) => `${title}を削除`,
	deleteRowTitle: "ブックマークを削除",
	detailPending: "このブックマークのAI分析はまだ完了していません。",
	detailNoDescription: "AIによる説明はまだありません。",
	profileLabel: "プロファイル",
	editProfileAria: (name) => `分析スキル「${name}」を編集`,
	analysisLabel: "分析",
	createdLabel: "作成",
	updatedLabel: "更新",
	analyzedLabel: "分析日時",
	open: "開く",
	deleteAction: "削除",
	close: "閉じる",
	closeDetailsAria: "詳細を閉じる",
	busyNotice: "処理中です — 完了までこのページを開いたままにしてください。",
	skillsScreenAria: "分析スキル設定",
	skillsSubtitle: "保存するページのAI分析を調整します",
	skillsAbout: "カスタムスキルについて",
	skillsIntro: {
		before:
			"カスタムスキルは、一致するページのAI分析を調整します。Google Driveの ",
		after: " に保存されます。",
	},
	settingsSync: "設定の同期",
	settingsSyncingDrive: "設定をGoogle Driveと同期中…",
	settingsWritingDrive: "設定の変更をGoogle Driveに書き込み中…",
	syncSettingsButton: "設定を同期",
	settingsSyncAria: "分析スキル設定を同期",
	loadingSkills: "分析スキルを読み込み中…",
	builtIn: "組み込み（読み取り専用）",
	custom: "カスタム（Drive同期）",
	addCustom: "カスタムスキルを追加",
	noCustom: "カスタムスキルはまだありません。",
	priority: (value) => `優先度 ${value}`,
	disabledMark: "無効",
	enable: "有効にする",
	disable: "無効にする",
	edit: "編集",
	newSkill: "新しいカスタムスキル",
	editSkill: "カスタムスキルを編集",
	closeSkillFormAria: "スキルフォームを閉じる",
	formName: "名前",
	formPriority: "優先度",
	formDomains: "ドメイン（カンマ区切り、例: github.com）",
	formUrlPatterns:
		"URLパターン（カンマ区切り、`*` ワイルドカード、例: example.com/docs/*）",
	formInstruction: "指示",
	saveChanges: "変更を保存",
	createSkill: "スキルを作成",
	cancel: "キャンセル",
	guidance: {
		aria: "指示の書き方ガイド",
		title: "良い指示の書き方",
		intro:
			"指示は、一致するページのAI分析で何を重視するかに加えて、分析ノートの出力の形（見出し構成・セクション・長さ）も指定できます。指定した形は既定の長文形式より優先されます。JSONのキー・出力言語・保存内容・データの送信先を変えることはできません。",
		examplesHeading: "例",
		examples: [
			"GitHubリポジトリ:「アーキテクチャ、主要API、セットアップ手順、導入リスクを重視する。」",
			"技術記事:「主な主張、前提条件、注意点を要約する。」",
			"公式ドキュメント:「対象バージョン、具体的な手順、統合時の制約を強調する。」",
			"動画ページ:「## 動画概要 と ## コメントピックアップ の2つの見出しだけにして、100文字以内の要約と短い箇条書きにする。」",
		],
		neverHeading: "次のような指示は書かないでください",
		never: [
			"シークレット・トークン・認証情報を要求する。",
			"ページ本文や抜粋の生データの保存を求める。",
			"外部APIや外部AIプロバイダの呼び出しを求める。",
			"出力言語や使用するAIモデルの変更を求める。",
			"出力スキーマやプライバシー契約の変更を試みる。",
		],
		matchingHeading: "マッチングの仕組み",
		matching: [
			"ドメインはページのホストに一致します（例: github.com）。",
			"URLパターンは * ワイルドカードで一致範囲を絞ります（例: example.com/docs/*）。",
			"複数のスキルが一致した場合、優先度が高いものが先に勝ち、次により具体的な一致が勝ちます。",
		],
	},
};

const MESSAGES: Readonly<Record<SupportedLanguage, OptionsMessages>> = {
	en: EN,
	ja: JA,
};

/** The options dictionary for one UI language. */
export function optionsMessages(language: SupportedLanguage): OptionsMessages {
	return MESSAGES[language];
}
