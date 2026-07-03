/**
 * The settings application use cases: the settings-side sibling of
 * `bookmark-app.ts`. The only place that orchestrates the custom-skill domain
 * (`settings/*`), the Drive settings repository, and the settings cache
 * together. It mixes none of their internals — every external dependency
 * arrives as a port, so the whole surface is testable with fakes
 * (docs/implementation-principles.md "Module boundary rules").
 *
 * State-transition decisions (add/update/remove/enable) are delegated to the
 * first-class {@link Settings} collection rather than performed by hand here
 * ("Tell, don't ask"). The cache is written as a cache; Drive remains the
 * source of truth, with file-level `updatedAt` last-writer-wins conflict
 * handling owned by {@link DriveSettingsRepository} (MIK-018).
 */
import type { DriveLocation, RepositoryError } from "../drive/index";
import type { Result as DriveResult } from "../drive/index";
import type { SettingsRepositorySnapshot } from "../drive/settings-repository";
import {
	type NewCustomSkillInput,
	type SkillError,
	type SkillId,
	Settings,
} from "../settings/index";
import type { SettingsCacheState } from "../storage/settings-types";
import type { SettingsCache } from "../storage/settings-local-cache";
import {
	type AppError,
	appError,
	fromRepositoryError,
	fromSkillError,
	toSyncError,
} from "./errors";
import type { Clock, LogLevel, Logger, Redactor } from "./ports";
import { type Result, err, ok } from "./result";

/** A skill-id source for new custom skills, injected like `IdGenerator`. */
export interface SkillIdGenerator {
	next(): SkillId;
}

/** The Drive settings repository, reduced to the operations the app needs. */
export interface SettingsRepositoryPort {
	bootstrap(): Promise<DriveResult<DriveLocation, RepositoryError>>;
	load(): Promise<DriveResult<SettingsRepositorySnapshot, RepositoryError>>;
	save(
		local: Settings,
	): Promise<DriveResult<SettingsRepositorySnapshot, RepositoryError>>;
}

/** The use-case surface exposed to the options UI's custom-skill CRUD. */
export interface SettingsApp {
	/** Render-fast read of the last cached settings. Never hits Drive. */
	loadCachedSettings(): Promise<SettingsCacheState>;
	/** Pull the authoritative settings from Drive and refresh the cache. */
	syncSettingsFromDrive(): Promise<Result<SettingsCacheState, AppError>>;
	/** Create a new custom skill. */
	createSkill(
		input: NewCustomSkillInput,
	): Promise<Result<SettingsCacheState, AppError>>;
	/** Update an existing custom skill by id. */
	updateSkill(
		id: SkillId,
		patch: Partial<NewCustomSkillInput>,
	): Promise<Result<SettingsCacheState, AppError>>;
	/** Delete a custom skill by id. */
	deleteSkill(id: SkillId): Promise<Result<SettingsCacheState, AppError>>;
	/** Enable/disable a custom skill by id. */
	setSkillEnabled(
		id: SkillId,
		enabled: boolean,
	): Promise<Result<SettingsCacheState, AppError>>;
}

export type SettingsAppDeps = {
	readonly repository: SettingsRepositoryPort;
	readonly cache: SettingsCache;
	readonly clock: Clock;
	readonly ids: SkillIdGenerator;
	readonly logger?: Logger;
	readonly redactor?: Redactor;
};

type DrivePush = {
	readonly state: SettingsCacheState;
	readonly driveSynced: boolean;
	readonly driveError?: AppError;
};

export function createSettingsApp(deps: SettingsAppDeps): SettingsApp {
	function log(level: LogLevel, event: string, detail?: string): void {
		if (!deps.logger) {
			return;
		}
		const safe =
			detail === undefined
				? undefined
				: (deps.redactor?.redact(detail) ?? detail);
		deps.logger.log(level, event, safe);
	}

	/**
	 * Write `desired` to Drive, then reconcile the cache — the settings-side
	 * twin of `bookmark-app.ts`'s `pushToDrive`. On success the cache reflects
	 * whichever settings value {@link DriveSettingsRepository.save}'s
	 * last-writer-wins comparison kept (`desired` or a strictly newer remote);
	 * on failure `desired` is kept locally with a typed sync error so the
	 * change is not lost.
	 */
	async function pushToDrive(
		desired: Settings,
		opts: { prevLocation?: DriveLocation },
	): Promise<DrivePush> {
		const result = await deps.repository.save(desired);
		if (result.ok) {
			const snapshot = result.value;
			const state: SettingsCacheState = {
				settings: snapshot.settings,
				location: { folder: snapshot.folder, file: snapshot.file },
				sync: { status: "synced", lastSyncedAt: deps.clock.now() },
			};
			await deps.cache.save(state);
			return { state, driveSynced: true };
		}

		const state: SettingsCacheState = {
			settings: desired,
			location: opts.prevLocation,
			sync: {
				status: "error",
				error: toSyncError(result.error),
				pending: true,
			},
		};
		await deps.cache.save(state);
		log(
			"warn",
			"settings-drive-save-failed",
			`${result.error.kind}: ${result.error.message}`,
		);
		return {
			state,
			driveSynced: false,
			driveError: fromRepositoryError(result.error),
		};
	}

	/** Load the cache, apply a `Settings` mutation, then push the result. */
	async function mutate(
		apply: (
			settings: Settings,
			now: ReturnType<Clock["now"]>,
		) => Result<Settings, SkillError>,
	): Promise<Result<SettingsCacheState, AppError>> {
		const cached = await deps.cache.load();
		const now = deps.clock.now();
		const applied = apply(cached.settings, now);
		if (!applied.ok) {
			return err(fromSkillError(applied.error));
		}
		const push = await pushToDrive(applied.value, {
			prevLocation: cached.location,
		});
		return ok(push.state);
	}

	return {
		async loadCachedSettings(): Promise<SettingsCacheState> {
			return deps.cache.load();
		},

		async syncSettingsFromDrive(): Promise<
			Result<SettingsCacheState, AppError>
		> {
			const cached = await deps.cache.load();

			if (cached.sync.pending) {
				const push = await pushToDrive(cached.settings, {
					prevLocation: cached.location,
				});
				if (push.driveSynced) {
					log(
						"info",
						"settings-drive-pending-pushed",
						`${push.state.settings.size} custom skills`,
					);
					return ok(push.state);
				}
				log(
					"warn",
					"settings-drive-pending-push-failed",
					push.driveError
						? `${push.driveError.detail ?? push.driveError.kind}: ${push.driveError.message}`
						: "pending push failed",
				);
				return err(
					push.driveError ??
						appError("drive", "pending settings changes could not be pushed"),
				);
			}

			const result = await deps.repository.load();
			if (!result.ok) {
				const state: SettingsCacheState = {
					settings: cached.settings,
					location: cached.location,
					sync: { status: "error", error: toSyncError(result.error) },
				};
				await deps.cache.save(state);
				log(
					"warn",
					"settings-drive-sync-failed",
					`${result.error.kind}: ${result.error.message}`,
				);
				return err(fromRepositoryError(result.error));
			}

			const snapshot = result.value;
			const state: SettingsCacheState = {
				settings: snapshot.settings,
				location: { folder: snapshot.folder, file: snapshot.file },
				sync: { status: "synced", lastSyncedAt: deps.clock.now() },
			};
			await deps.cache.save(state);
			log(
				"info",
				"settings-drive-synced",
				`${snapshot.settings.size} custom skills`,
			);
			return ok(state);
		},

		async createSkill(
			input: NewCustomSkillInput,
		): Promise<Result<SettingsCacheState, AppError>> {
			return mutate((settings, now) =>
				settings.add(input, { id: deps.ids.next(), now }),
			);
		},

		async updateSkill(
			id: SkillId,
			patch: Partial<NewCustomSkillInput>,
		): Promise<Result<SettingsCacheState, AppError>> {
			return mutate((settings, now) => settings.update(id, patch, now));
		},

		async deleteSkill(
			id: SkillId,
		): Promise<Result<SettingsCacheState, AppError>> {
			const cached = await deps.cache.load();
			const now = deps.clock.now();
			const reduced = cached.settings.remove(id, now);
			const push = await pushToDrive(reduced, {
				prevLocation: cached.location,
			});
			return ok(push.state);
		},

		async setSkillEnabled(
			id: SkillId,
			enabled: boolean,
		): Promise<Result<SettingsCacheState, AppError>> {
			return mutate((settings, now) => settings.setEnabled(id, enabled, now));
		},
	};
}
