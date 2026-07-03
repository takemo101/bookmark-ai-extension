/**
 * The options page's custom-skill use-case boundary: the sibling of
 * `use-cases.ts` for the custom analysis-skill CRUD (MIK-018,
 * docs/ai-analysis-v2.md "Settings file"). The controller
 * (`./skills-view-model`) talks only to {@link SkillsUseCases}; it never
 * imports a Drive client, the JSONL/settings parser, or merge internals.
 * Tests pass a fake {@link SkillsUseCases}; the real runtime passes the
 * adapter built by {@link createSkillsUseCases} (wired in `./runtime`).
 *
 * Every method maps 1:1 to a {@link SettingsApp} use case.
 */
import type { SettingsApp } from "../lib/app/index";
import type { AppError, Result } from "../lib/app/index";
import type { NewCustomSkillInput, SkillId } from "../lib/settings/index";
import type { SettingsCacheState } from "../lib/storage/index";

export type { SettingsCacheState } from "../lib/storage/index";
export type { AppError, Result } from "../lib/app/index";
export type { NewCustomSkillInput, SkillId } from "../lib/settings/index";

/**
 * The only surface the skills controller is allowed to touch. None of these
 * methods leak a Drive, JSONL, or settings-parse type.
 */
export interface SkillsUseCases {
	/** Render-fast read of the last cached custom-skill settings. */
	loadCachedSettings(): Promise<SettingsCacheState>;
	/** Pull the authoritative settings from Drive and refresh the cache. */
	syncSettingsFromDrive(): Promise<Result<SettingsCacheState, AppError>>;
	createSkill(
		input: NewCustomSkillInput,
	): Promise<Result<SettingsCacheState, AppError>>;
	updateSkill(
		id: SkillId,
		patch: Partial<NewCustomSkillInput>,
	): Promise<Result<SettingsCacheState, AppError>>;
	deleteSkill(id: SkillId): Promise<Result<SettingsCacheState, AppError>>;
	setSkillEnabled(
		id: SkillId,
		enabled: boolean,
	): Promise<Result<SettingsCacheState, AppError>>;
}

/**
 * Adapt the `app/*` {@link SettingsApp} into the {@link SkillsUseCases} the
 * controller consumes. A direct, type-narrowing pass-through.
 */
export function createSkillsUseCases(app: SettingsApp): SkillsUseCases {
	return {
		loadCachedSettings() {
			return app.loadCachedSettings();
		},
		syncSettingsFromDrive() {
			return app.syncSettingsFromDrive();
		},
		createSkill(input) {
			return app.createSkill(input);
		},
		updateSkill(id, patch) {
			return app.updateSkill(id, patch);
		},
		deleteSkill(id) {
			return app.deleteSkill(id);
		},
		setSkillEnabled(id, enabled) {
			return app.setSkillEnabled(id, enabled);
		},
	};
}
