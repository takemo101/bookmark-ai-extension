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
export type FacetUnit = "domains" | "genres" | "tags";

export type OptionsMessages = {
	readonly researchLedger: string;
	readonly navAria: string;
	readonly library: string;
	/** Accessible name of the Library title-adjacent help trigger (MIK-053). */
	readonly libraryHelpAria: string;
	/** Label opening the Library help guidance (MIK-053). */
	readonly libraryAbout: string;
	/** What the Library search/filter rail covers (MIK-053). */
	readonly libraryHelpSearch: string;
	/** How the row detail drawer and quick delete behave (MIK-053). */
	readonly libraryHelpDetail: string;
	/** Where sync status/actions live — the app-header hub (MIK-053). */
	readonly libraryHelpSync: string;
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
	/** Accessible label for the round app-header theme toggle. */
	readonly themeToggleAria: (current: string, next: string) => string;
	/** The three theme preference labels. */
	readonly themeSystem: string;
	readonly themeLight: string;
	readonly themeDark: string;
	readonly themePreference: (preference: "system" | "light" | "dark") => string;
	/** Accessible label of the shared app-header sync hub (MIK-051). */
	readonly syncHubAria: string;
	/** Glance summary texts of the sync hub pill (MIK-051). */
	readonly syncHubSynced: string;
	readonly syncHubSyncing: string;
	readonly syncHubPending: string;
	readonly syncHubError: string;
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
	readonly askAi: string;
	readonly askAiScreenAria: string;
	/** User-facing one-line subtitle under the Ask AI screen title (MIK-045). */
	readonly askAiSubtitle: string;
	/** Label for the Ask AI scope/privacy notes (chat context and header help). */
	readonly askAiAbout: string;
	/** Accessible name of the Ask AI title-adjacent help toggle (MIK-052). */
	readonly askAiHelpAria: string;
	/** Local-cache/all-saved-bookmarks scope note — not the open web. */
	readonly askAiScopeNote: string;
	/** Short-bookmark-info usage and chat-is-never-saved note. */
	readonly askAiPrivacyNote: string;
	readonly askAiEmptyIntro: string;
	/** Clickable example prompts shown in the empty chat state. */
	readonly askAiExamples: readonly string[];
	readonly askAiInputAria: string;
	readonly askAiPlaceholder: string;
	readonly askAiSubmit: string;
	/** Label of the clear-session action that hard-resets the chat (MIK-048). */
	readonly askAiClear: string;
	/** Accessible label of the chat transcript log (MIK-048). */
	readonly askAiTranscriptAria: string;
	/** Faint role label above a user turn bubble (MIK-049). */
	readonly askAiUserTurnLabel: string;
	/** Faint role label above an assistant turn (MIK-049). */
	readonly askAiAssistantTurnLabel: string;
	/** Visible text of the jump-to-latest overlay button (MIK-049). */
	readonly askAiLatest: string;
	/** Accessible label of the jump-to-latest overlay button (MIK-049). */
	readonly askAiLatestAria: string;
	/** Non-streaming in-flight placeholder line while an answer is running. */
	readonly askAiAnswering: string;
	readonly askAiSetupTitle: string;
	readonly askAiSetupPreparing: string;
	readonly askAiSetupDownloading: (percent?: number) => string;
	readonly askAiSetupHint: string;
	/** Safe status copy for the MIK-046 non-answer results. */
	readonly askAiTooShort: string;
	readonly askAiEmptyLibrary: string;
	readonly askAiClarify: string;
	readonly askAiError: string;
	/** Notice above local-fallback cards when the AI could not answer. */
	readonly askAiFallbackNotice: string;
	readonly askAiResultsAria: string;
	readonly askAiCardAria: (title: string) => string;
	readonly skillsScreenAria: string;
	/** User-facing one-line subtitle under the Analysis skills screen title. */
	readonly skillsSubtitle: string;
	/** Header-help guidance label holding the settings-file context (MIK-052). */
	readonly skillsAbout: string;
	readonly skillsIntro: { readonly before: string; readonly after: string };
	/** Accessible name of the Analysis skills title-adjacent help toggle (MIK-052). */
	readonly skillsHelpAria: string;
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
	libraryHelpAria: "Library help",
	libraryAbout: "About the Library",
	libraryHelpSearch:
		"Search and filters narrow your saved bookmarks by title, URL, summary, tags, domain, genre, and AI status.",
	libraryHelpDetail:
		"Click a row to open its full details in the right-side drawer; the row's ✕ deletes a bookmark without opening it.",
	libraryHelpSync:
		"Sync status and manual sync actions live in the sync hub in the app header.",
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
	themeToggleAria: (current, next) => `Theme: ${current}. Switch to ${next}.`,
	themeSystem: "System",
	themeLight: "Light",
	themeDark: "Dark",
	themePreference: (preference) =>
		preference === "system"
			? EN.themeSystem
			: preference === "light"
				? EN.themeLight
				: EN.themeDark,
	syncHubAria: "Sync status",
	syncHubSynced: "Synced",
	syncHubSyncing: "Syncing…",
	syncHubPending: "Pending",
	syncHubError: "Sync error",
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
	askAi: "Ask AI",
	askAiScreenAria: "Ask AI about saved bookmarks",
	askAiSubtitle:
		"Ask in your own words and get recommendations from your saved bookmarks",
	askAiAbout: "About Ask AI",
	askAiHelpAria: "Ask AI help",
	askAiScopeNote:
		"Ask AI searches all your saved bookmarks in the local cache — it does not search the open web. Use Sync Drive in the app header to refresh the cache.",
	askAiPrivacyNote:
		"Only short saved-bookmark info (title, domain, description, genre, tags) is used, and this chat is never saved.",
	askAiEmptyIntro:
		"No questions yet. Ask about your saved bookmarks, or try an example:",
	askAiExamples: [
		"Find saved bookmarks about TypeScript testing",
		"Show me GitHub repositories about AI tools",
		"What should I read about Chrome extensions?",
	],
	askAiInputAria: "Ask AI question",
	askAiPlaceholder:
		"Ask about your saved bookmarks… (Enter to send, Shift+Enter for a new line)",
	askAiSubmit: "Ask",
	askAiClear: "Clear chat",
	askAiTranscriptAria: "Ask AI conversation",
	askAiUserTurnLabel: "You",
	askAiAssistantTurnLabel: "AI",
	askAiLatest: "Latest",
	askAiLatestAria: "Jump to latest",
	askAiAnswering: "Looking through your saved bookmarks…",
	askAiSetupTitle: "Assistant setup",
	askAiSetupPreparing: "Preparing AI model…",
	askAiSetupDownloading: (percent) =>
		percent !== undefined && percent > 0
			? `Downloading AI model… ${percent}%`
			: "Downloading AI model…",
	askAiSetupHint:
		"Keep this tab open while Chrome prepares the on-device model. You can still fall back to local bookmark matches if setup fails.",
	askAiTooShort: "Please ask a slightly longer question.",
	askAiEmptyLibrary:
		"You have no saved bookmarks yet — save a page from the popup first.",
	askAiClarify:
		"I could not find a strong match in your saved bookmarks. Try adding a topic, technology, or site name and ask again.",
	askAiError:
		"Something went wrong while checking your saved bookmarks. Please try again.",
	askAiFallbackNotice:
		"On-device AI is not available right now, so these are keyword matches from your saved bookmarks.",
	askAiResultsAria: "Ask AI recommendations",
	askAiCardAria: (title) => `Open details for ${title}`,
	skillsScreenAria: "Analysis skills settings",
	skillsSubtitle: "Tune how the AI analyzes the pages you save",
	skillsAbout: "About custom skills",
	skillsIntro: {
		before:
			"Custom skills tune the AI analysis for matching pages. They are stored in ",
		after: " in your Google Drive.",
	},
	skillsHelpAria: "Analysis skills help",
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
			"analysisMarkdown: use exactly the requested headings and do not add extra headings.",
			"description: keep it short, for example one sentence within 100 characters.",
			"genre: choose one broad category that is easy to filter by.",
			"tags: prefer searchable keywords that should appear in Library search.",
			"Video page: “Use only ## Video overview, ## Comment picks, and ## Comment reaction analysis; summarize the overview within 100 characters.”",
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
	libraryHelpAria: "ライブラリのヘルプ",
	libraryAbout: "ライブラリについて",
	libraryHelpSearch:
		"検索とフィルタで、タイトル・URL・要約・タグ・ドメイン・ジャンル・AIステータスから保存済みブックマークを絞り込めます。",
	libraryHelpDetail:
		"行をクリックすると右側のドロワーで詳細が開きます。行の✕は詳細を開かずにブックマークを削除します。",
	libraryHelpSync:
		"同期の状態と手動同期は、アプリヘッダーの同期ハブにあります。",
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
	themeToggleAria: (current, next) =>
		`テーマ: ${current}。次は${next}に切り替え。`,
	themeSystem: "システム",
	themeLight: "ライト",
	themeDark: "ダーク",
	themePreference: (preference) =>
		preference === "system"
			? JA.themeSystem
			: preference === "light"
				? JA.themeLight
				: JA.themeDark,
	syncHubAria: "同期状態",
	syncHubSynced: "同期済み",
	syncHubSyncing: "同期中…",
	syncHubPending: "未同期あり",
	syncHubError: "同期エラー",
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
	askAi: "AIに聞く",
	askAiScreenAria: "保存済みブックマークについてAIに聞く",
	askAiSubtitle:
		"自然な言葉で質問して、保存済みブックマークからおすすめを受け取ります",
	askAiAbout: "AIに聞くについて",
	askAiHelpAria: "AIに聞くのヘルプ",
	askAiScopeNote:
		"AIに聞くは、ローカルキャッシュ内のすべての保存済みブックマークを検索します。ウェブ全体は検索しません。キャッシュを最新にするにはヘッダーの「Driveと同期」を実行してください。",
	askAiPrivacyNote:
		"使うのは保存済みブックマークの短い情報（タイトル・ドメイン・説明・ジャンル・タグ）だけで、このチャットは保存されません。",
	askAiEmptyIntro:
		"まだ質問はありません。保存済みブックマークについて質問するか、例を試してください:",
	askAiExamples: [
		"TypeScriptのテストについて保存済みから探す",
		"AIツール関連のGitHubリポジトリを見つける",
		"Chrome拡張について読むべきものは？",
	],
	askAiInputAria: "AIへの質問",
	askAiPlaceholder:
		"保存済みブックマークについて質問…（Enterで送信 / Shift+Enterで改行）",
	askAiSubmit: "質問する",
	askAiClear: "チャットをクリア",
	askAiTranscriptAria: "AIとの会話",
	askAiUserTurnLabel: "あなた",
	askAiAssistantTurnLabel: "AI",
	askAiLatest: "最新へ",
	askAiLatestAria: "最新のメッセージへ移動",
	askAiAnswering: "保存済みブックマークを確認中…",
	askAiSetupTitle: "アシスタントの準備",
	askAiSetupPreparing: "AIモデルを準備中…",
	askAiSetupDownloading: (percent) =>
		percent !== undefined && percent > 0
			? `AIモデルをダウンロード中… ${percent}%`
			: "AIモデルをダウンロード中…",
	askAiSetupHint:
		"Chromeがオンデバイスモデルを準備している間、このタブを開いたままにしてください。準備に失敗してもローカルのブックマーク一致に戻れます。",
	askAiTooShort: "もう少し長い質問を入力してください。",
	askAiEmptyLibrary:
		"保存済みブックマークがまだありません。まずポップアップからページを保存してください。",
	askAiClarify:
		"保存済みブックマークからはっきり合うものが見つかりませんでした。トピック・技術名・サイト名などを足して聞き直してください。",
	askAiError:
		"保存済みブックマークの確認中に問題が発生しました。もう一度お試しください。",
	askAiFallbackNotice:
		"オンデバイスAIが今は使えないため、保存済みブックマークからのキーワード一致を表示しています。",
	askAiResultsAria: "AIのおすすめ",
	askAiCardAria: (title) => `「${title}」の詳細を開く`,
	skillsScreenAria: "分析スキル設定",
	skillsSubtitle: "保存するページのAI分析を調整します",
	skillsAbout: "カスタムスキルについて",
	skillsIntro: {
		before:
			"カスタムスキルは、一致するページのAI分析を調整します。Google Driveの ",
		after: " に保存されます。",
	},
	skillsHelpAria: "分析スキルのヘルプ",
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
			"analysisMarkdown: 必ず指定した見出しだけを使う。余計な見出しは追加しない。",
			"description: 1文で短く要約する。例: 100文字以内。",
			"genre: フィルタしやすい大きめのカテゴリを1つ選ぶ。",
			"tags: 検索しやすいキーワードを優先する。",
			"動画ページ:「## 動画概要、## コメントピックアップ、## コメントの反応分析 だけを使い、概要は100文字以内にする。」",
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
