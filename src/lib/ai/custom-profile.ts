/**
 * Convert a Drive-synced {@link CustomSkill} into the {@link AnalysisProfile}
 * shape `selectAnalysisProfile` already knows how to rank
 * (docs/ai-analysis-v2.md "Skill matching"). Built-ins stay defined in
 * `./profile.ts`; this is the only bridge from the settings domain into
 * analysis-profile selection, so `settings/*` itself never has to import
 * `ai/*` (docs/implementation-principles.md "Module boundary rules").
 *
 * Pattern synthesis rule: each configured domain `d` becomes two patterns —
 * `d/*` (the domain and any subpath, the common case: `github.com/*` matches
 * `github.com/owner/repo`) and bare `d` (the domain with no path at all, e.g.
 * a page whose pathname is empty). The skill's own explicit `urlPatterns` are
 * appended unchanged afterward, so a user can still hand-write a more specific
 * pattern (e.g. `github.com/my-org/*`) alongside or instead of a domain entry.
 */
import type { CustomSkill } from "../settings/index";
import type { AnalysisProfile } from "./profile";

export function toAnalysisProfile(skill: CustomSkill): AnalysisProfile {
	const domainPatterns = skill.domains.flatMap((domain) => [
		domain,
		`${domain}/*`,
	]);
	return {
		id: skill.id,
		name: skill.name,
		priority: skill.priority,
		urlPatterns: [...domainPatterns, ...skill.urlPatterns],
		instruction: skill.instruction,
	};
}
