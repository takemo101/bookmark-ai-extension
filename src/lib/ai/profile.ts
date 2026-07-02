/**
 * Built-in analysis profiles and deterministic URL-based selection.
 *
 * Each profile carries a Markdown-analysis instruction that the prompt layer
 * (./prompt.ts) layers on top of the fixed core contract (Japanese, JSON-only,
 * no raw excerpt). Profiles are fixed in code for Phase 1 — see
 * docs/ai-analysis-v2.md "Built-in skills"; custom/Drive-synced profiles are a
 * later phase and are out of scope here.
 *
 * Selection matches by domain + wildcard URL pattern (docs/ai-analysis-v2.md
 * "Skill matching"): the highest-priority match wins; ties break by the most
 * specific (most literal characters) pattern, then by pattern length, then by
 * profile id for full determinism. A page that matches nothing falls back to
 * the generic profile, which matches every URL at the lowest priority.
 */

export type AnalysisProfile = {
	readonly id: string;
	readonly name: string;
	readonly priority: number;
	readonly urlPatterns: readonly string[];
	/** Domain-specific analysis emphasis layered onto the fixed core prompt contract. */
	readonly instruction: string;
};

const GENERIC_PROFILE: AnalysisProfile = {
	id: "generic-page",
	name: "汎用ページ",
	priority: 0,
	urlPatterns: ["*"],
	instruction: [
		"- このページが何かを簡潔に説明する。",
		"- 主要なポイントを箇条書きで挙げる。",
		"- 後で見返す価値がある理由を書く。",
		"- 関連する検索用キーワードを挙げる。",
	].join("\n"),
};

export const BUILT_IN_PROFILES: readonly AnalysisProfile[] = [
	{
		id: "github-repository",
		name: "GitHubリポジトリ",
		priority: 20,
		urlPatterns: ["github.com/*/*"],
		instruction: [
			"- どのようなツール/ライブラリ/アプリケーションかを説明する。",
			"- どんな問題を解決するかを説明する。",
			"- 主な機能を挙げる。",
			"- 想定される利用者を挙げる。",
			"- 採用事例やユースケースがあれば触れる。",
			"- ページから読み取れる注意点・制約があれば挙げる。",
		].join("\n"),
	},
	{
		id: "technical-article",
		name: "技術記事",
		priority: 20,
		urlPatterns: ["zenn.dev/*", "qiita.com/*", "dev.to/*", "medium.com/*"],
		instruction: [
			"- 記事の主張・結論を説明する。",
			"- 背景にある課題や文脈を説明する。",
			"- 実装や設計のアイデアを挙げる。",
			"- 再利用できる教訓を挙げる。",
			"- 保存しておく価値がある理由を書く。",
		].join("\n"),
	},
	{
		id: "official-documentation",
		name: "公式ドキュメント",
		priority: 20,
		urlPatterns: ["developer.mozilla.org/*", "docs.*", "*.dev/docs/*"],
		instruction: [
			"- ドキュメントが説明しているAPI/機能を明らかにする。",
			"- 中心となる概念を説明する。",
			"- よくある操作方法を挙げる。",
			"- 制約や注意点を挙げる。",
			"- 実装時に参照すべきポイントを挙げる。",
		].join("\n"),
	},
	GENERIC_PROFILE,
];

/** `hostname + pathname`, lowercased, no scheme/query/hash. `null` when unparseable. */
function matchTarget(url: string): string | null {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
	} catch {
		return null;
	}
}

/** Compile a `*`-wildcard pattern into a whole-string, case-insensitive regex. */
function patternToRegex(pattern: string): RegExp {
	const escaped = pattern
		.split("*")
		.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${escaped}$`, "i");
}

type Candidate = {
	readonly profile: AnalysisProfile;
	readonly priority: number;
	readonly specificity: number;
	readonly patternLength: number;
};

/** `true` when `a` should be preferred over the current best candidate `b`. */
function isBetter(a: Candidate, b: Candidate): boolean {
	if (a.priority !== b.priority) return a.priority > b.priority;
	if (a.specificity !== b.specificity) return a.specificity > b.specificity;
	if (a.patternLength !== b.patternLength)
		return a.patternLength > b.patternLength;
	return a.profile.id < b.profile.id;
}

/**
 * Select the single best-matching profile for a page URL. Always returns a
 * profile — an unparseable URL or one that matches no built-in falls back to
 * the generic profile.
 */
export function selectAnalysisProfile(
	url: string,
	profiles: readonly AnalysisProfile[] = BUILT_IN_PROFILES,
): AnalysisProfile {
	const target = matchTarget(url);
	if (target === null) {
		return GENERIC_PROFILE;
	}

	let best: Candidate | undefined;
	for (const profile of profiles) {
		for (const pattern of profile.urlPatterns) {
			if (!patternToRegex(pattern).test(target)) {
				continue;
			}
			const candidate: Candidate = {
				profile,
				priority: profile.priority,
				specificity: pattern.replace(/\*/g, "").length,
				patternLength: pattern.length,
			};
			if (best === undefined || isBetter(candidate, best)) {
				best = candidate;
			}
		}
	}
	return best?.profile ?? GENERIC_PROFILE;
}
