import { describe, expect, it } from "vitest";

import { isoTimestamp } from "../lib/bookmarks/index";
import { Settings, skillId } from "../lib/settings/index";
import type { SettingsCacheState } from "../lib/storage/index";
import type {
	AppError,
	NewCustomSkillInput,
	Result,
	SkillId,
	SkillsUseCases,
} from "./skills-use-cases";
import { createSkillsController } from "./skills-view-model";

/**
 * The controller is exercised entirely through a fake {@link SkillsUseCases} —
 * no React, Chrome, Drive. That is the structural proof the "Analysis skills"
 * panel never reaches past the view-model boundary.
 */

function settingsWith(
	skills: Array<{ name: string; id: string; enabled?: boolean }>,
): Settings {
	let settings = Settings.empty();
	for (const s of skills) {
		const result = settings.add(
			{ name: s.name, instruction: "Focus on X.", enabled: s.enabled },
			{ id: skillId(s.id), now: isoTimestamp("2026-01-01T00:00:00Z") },
		);
		if (!result.ok) throw new Error("fixture add failed");
		settings = result.value;
	}
	return settings;
}

function cacheOf(
	settings: Settings,
	sync: SettingsCacheState["sync"] = { status: "synced" },
): SettingsCacheState {
	return { settings, sync };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

class FakeSkillsUseCases implements SkillsUseCases {
	cache: SettingsCacheState = cacheOf(Settings.empty());
	syncResult: Result<SettingsCacheState, AppError> | null = null;
	syncPromise: Promise<Result<SettingsCacheState, AppError>> | null = null;
	createResult: Result<SettingsCacheState, AppError> | null = null;
	createPromise: Promise<Result<SettingsCacheState, AppError>> | null = null;
	updateResult: Result<SettingsCacheState, AppError> | null = null;
	deleteResult: Result<SettingsCacheState, AppError> | null = null;
	setEnabledResult: Result<SettingsCacheState, AppError> | null = null;
	createArgs: NewCustomSkillInput[] = [];
	updateArgs: Array<{ id: SkillId; patch: Partial<NewCustomSkillInput> }> = [];
	deleteArgs: SkillId[] = [];
	setEnabledArgs: Array<{ id: SkillId; enabled: boolean }> = [];

	async loadCachedSettings() {
		return this.cache;
	}
	async syncSettingsFromDrive() {
		return (
			this.syncPromise ??
			this.syncResult ?? { ok: true as const, value: this.cache }
		);
	}
	async createSkill(input: NewCustomSkillInput) {
		this.createArgs.push(input);
		if (this.createPromise) return this.createPromise;
		if (this.createResult) return this.createResult;
		const now = isoTimestamp("2026-01-02T00:00:00Z");
		const added = this.cache.settings.add(input, { id: skillId("new-1"), now });
		if (!added.ok) throw new Error("fixture add failed");
		this.cache = { ...this.cache, settings: added.value };
		return { ok: true as const, value: this.cache };
	}
	async updateSkill(id: SkillId, patch: Partial<NewCustomSkillInput>) {
		this.updateArgs.push({ id, patch });
		if (this.updateResult) return this.updateResult;
		const now = isoTimestamp("2026-01-03T00:00:00Z");
		const updated = this.cache.settings.update(id, patch, now);
		if (!updated.ok) {
			return {
				ok: false as const,
				error: {
					kind: "invalid-skill" as const,
					message: updated.error.message,
				},
			};
		}
		this.cache = { ...this.cache, settings: updated.value };
		return { ok: true as const, value: this.cache };
	}
	async deleteSkill(id: SkillId) {
		this.deleteArgs.push(id);
		if (this.deleteResult) return this.deleteResult;
		const now = isoTimestamp("2026-01-04T00:00:00Z");
		this.cache = {
			...this.cache,
			settings: this.cache.settings.remove(id, now),
		};
		return { ok: true as const, value: this.cache };
	}
	async setSkillEnabled(id: SkillId, enabled: boolean) {
		this.setEnabledArgs.push({ id, enabled });
		if (this.setEnabledResult) return this.setEnabledResult;
		const now = isoTimestamp("2026-01-05T00:00:00Z");
		const updated = this.cache.settings.setEnabled(id, enabled, now);
		if (!updated.ok) throw new Error("fixture setEnabled failed");
		this.cache = { ...this.cache, settings: updated.value };
		return { ok: true as const, value: this.cache };
	}
}

describe("createSkillsController", () => {
	it("loads cached settings then refreshes from Drive on init()", async () => {
		const useCases = new FakeSkillsUseCases();
		useCases.cache = cacheOf(settingsWith([{ name: "A", id: "a" }]));
		const controller = createSkillsController(useCases);

		await controller.init();

		const view = controller.getView();
		expect(view.loading).toBe(false);
		expect(view.custom).toHaveLength(1);
		expect(view.custom[0].name).toBe("A");
		expect(view.sync.status).toBe("synced");
	});

	it("lists built-in profiles read-only", async () => {
		const controller = createSkillsController(new FakeSkillsUseCases());
		await controller.init();
		const view = controller.getView();
		expect(view.builtIns.length).toBeGreaterThan(0);
		expect(view.builtIns.some((b) => b.id === "generic-page")).toBe(true);
	});

	it("marks refresh syncing while settings sync is pending", async () => {
		const useCases = new FakeSkillsUseCases();
		const pending = deferred<Result<SettingsCacheState, AppError>>();
		useCases.syncPromise = pending.promise;
		const controller = createSkillsController(useCases);
		const syncingSnapshots: boolean[] = [];
		controller.subscribe(() => {
			syncingSnapshots.push(controller.getView().sync.syncing);
		});

		const refresh = controller.refresh();

		expect(controller.getView().busy).toBe(false);
		expect(controller.getView().sync.syncing).toBe(true);
		expect(syncingSnapshots).toContain(true);

		pending.resolve({ ok: true, value: useCases.cache });
		await refresh;

		expect(controller.getView().sync.syncing).toBe(false);
		expect(syncingSnapshots.at(-1)).toBe(false);
	});

	it("marks custom skill writes as writing while submit is pending", async () => {
		const useCases = new FakeSkillsUseCases();
		const pending = deferred<Result<SettingsCacheState, AppError>>();
		useCases.createPromise = pending.promise;
		const controller = createSkillsController(useCases);
		await controller.init();

		controller.startCreate();
		controller.setFormField("name", "Slow skill");
		controller.setFormField("instruction", "Focus on slow pages.");
		const submit = controller.submit();

		expect(controller.getView().busy).toBe(true);
		expect(controller.getView().sync.writing).toBe(true);
		expect(controller.getView().sync.syncing).toBe(false);

		pending.resolve({ ok: true, value: useCases.cache });
		await submit;

		expect(controller.getView().busy).toBe(false);
		expect(controller.getView().sync.writing).toBe(false);
	});

	it("startCreate() opens an empty form; submit() creates a skill", async () => {
		const useCases = new FakeSkillsUseCases();
		const controller = createSkillsController(useCases);
		await controller.init();

		controller.startCreate();
		expect(controller.getView().formOpen).toBe(true);
		expect(controller.getView().editingId).toBeUndefined();

		controller.setFormField("name", "My skill");
		controller.setFormField("instruction", "Focus on X.");
		controller.setFormField("domains", "example.com, other.example");
		controller.setFormField("urlPatterns", "example.com/docs/*");
		controller.setFormField("priority", "25");

		await controller.submit();

		expect(useCases.createArgs).toHaveLength(1);
		expect(useCases.createArgs[0]).toMatchObject({
			name: "My skill",
			instruction: "Focus on X.",
			domains: ["example.com", "other.example"],
			urlPatterns: ["example.com/docs/*"],
			priority: 25,
		});
		const view = controller.getView();
		expect(view.formOpen).toBe(false);
		expect(view.custom.some((s) => s.name === "My skill")).toBe(true);
	});

	it("startEdit() populates the form from the existing skill and submit() updates it", async () => {
		const useCases = new FakeSkillsUseCases();
		useCases.cache = cacheOf(settingsWith([{ name: "Original", id: "s1" }]));
		const controller = createSkillsController(useCases);
		await controller.init();

		controller.startEdit("s1");
		const view = controller.getView();
		expect(view.editingId).toBe("s1");
		expect(view.form.name).toBe("Original");

		controller.setFormField("name", "Renamed");
		await controller.submit();

		expect(useCases.updateArgs).toHaveLength(1);
		expect(useCases.updateArgs[0].id).toBe("s1");
		expect(controller.getView().custom.find((s) => s.id === "s1")?.name).toBe(
			"Renamed",
		);
		expect(controller.getView().formOpen).toBe(false);
	});

	it("cancelEdit() closes the form without submitting", async () => {
		const useCases = new FakeSkillsUseCases();
		useCases.cache = cacheOf(settingsWith([{ name: "A", id: "s1" }]));
		const controller = createSkillsController(useCases);
		await controller.init();

		controller.startEdit("s1");
		controller.cancelEdit();

		expect(controller.getView().formOpen).toBe(false);
		expect(useCases.updateArgs).toHaveLength(0);
	});

	it("remove() deletes a skill through the use case", async () => {
		const useCases = new FakeSkillsUseCases();
		useCases.cache = cacheOf(settingsWith([{ name: "A", id: "s1" }]));
		const controller = createSkillsController(useCases);
		await controller.init();

		await controller.remove("s1");

		expect(useCases.deleteArgs).toEqual(["s1"]);
		expect(controller.getView().custom).toHaveLength(0);
	});

	it("setEnabled() toggles a skill through the use case", async () => {
		const useCases = new FakeSkillsUseCases();
		useCases.cache = cacheOf(
			settingsWith([{ name: "A", id: "s1", enabled: true }]),
		);
		const controller = createSkillsController(useCases);
		await controller.init();

		await controller.setEnabled("s1", false);

		expect(useCases.setEnabledArgs).toEqual([{ id: "s1", enabled: false }]);
		expect(controller.getView().custom[0].enabled).toBe(false);
	});

	it("surfaces a safe action error when create fails", async () => {
		const useCases = new FakeSkillsUseCases();
		useCases.createResult = {
			ok: false,
			error: {
				kind: "invalid-skill",
				message: "name must be a non-empty string",
			},
		};
		const controller = createSkillsController(useCases);
		await controller.init();

		controller.startCreate();
		controller.setFormField("instruction", "x");
		await controller.submit();

		expect(controller.getView().actionError).toContain("name");
		// The form stays open so the user can fix the input.
		expect(controller.getView().formOpen).toBe(true);
	});
});
