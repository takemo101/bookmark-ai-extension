import { describe, expect, it } from "vitest";

import { isoTimestamp } from "../bookmarks/index";
import type {
	DriveFileId,
	DriveFolderId,
	DriveRevision,
	RepositoryError,
	Result as DriveResult,
} from "../drive/index";
import { ok as driveOk, err as driveErr } from "../drive/index";
import type { SettingsRepositorySnapshot } from "../drive/settings-repository";
import { Settings, skillId } from "../settings/index";
import type { SettingsCache } from "../storage/settings-local-cache";
import type { SettingsCacheState } from "../storage/settings-types";
import { createSettingsApp } from "./settings-app";
import type { Clock } from "./ports";
import type { SettingsRepositoryPort, SkillIdGenerator } from "./settings-app";

const FOLDER = { id: "folder-1" as DriveFolderId, name: "bookmark-ai" };
function fileMeta(rev: number) {
	return {
		id: "file-1" as DriveFileId,
		name: "settings.json",
		revision: `rev-${rev}` as DriveRevision,
	};
}

/** In-memory repository mirroring the real last-writer-wins `save` semantics. */
class FakeSettingsRepository implements SettingsRepositoryPort {
	remote: Settings;
	revision = 1;
	failKind: RepositoryError["kind"] | null = null;
	saveCalls = 0;

	constructor(remote: Settings = Settings.empty()) {
		this.remote = remote;
	}

	async bootstrap(): Promise<DriveResult<never, RepositoryError>> {
		throw new Error("not used");
	}

	async load(): Promise<
		DriveResult<SettingsRepositorySnapshot, RepositoryError>
	> {
		if (this.failKind) {
			return driveErr({ kind: this.failKind, message: "load boom" });
		}
		return driveOk(this.snapshot());
	}

	async save(
		local: Settings,
	): Promise<DriveResult<SettingsRepositorySnapshot, RepositoryError>> {
		this.saveCalls += 1;
		if (this.failKind) {
			return driveErr({ kind: this.failKind, message: "save boom" });
		}
		// Last-writer-wins by file updatedAt, exactly like DriveSettingsRepository.
		if (this.remote.updatedAt > local.updatedAt) {
			this.revision += 1;
			return driveOk(this.snapshot());
		}
		this.remote = local;
		this.revision += 1;
		return driveOk(this.snapshot());
	}

	private snapshot(): SettingsRepositorySnapshot {
		return {
			settings: this.remote,
			problems: [],
			file: fileMeta(this.revision),
			folder: FOLDER,
		};
	}
}

class FakeSettingsCache implements SettingsCache {
	state: SettingsCacheState;
	saves: SettingsCacheState[] = [];
	constructor(state?: SettingsCacheState) {
		this.state = state ?? {
			settings: Settings.empty(),
			sync: { status: "idle" },
		};
	}
	async load(): Promise<SettingsCacheState> {
		return this.state;
	}
	async save(state: SettingsCacheState): Promise<void> {
		this.state = state;
		this.saves.push(state);
	}
	async clear(): Promise<void> {
		this.state = { settings: Settings.empty(), sync: { status: "idle" } };
	}
}

function fakeClock(): Clock {
	let minute = 0;
	return {
		now() {
			const mm = String(minute++).padStart(2, "0");
			return isoTimestamp(`2026-03-01T00:${mm}:00Z`);
		},
	};
}

function fakeIds(): SkillIdGenerator {
	let n = 0;
	return {
		next() {
			return skillId(`skill-${n++}`);
		},
	};
}

function makeHarness(
	opts: { remote?: Settings; cache?: SettingsCacheState } = {},
) {
	const repo = new FakeSettingsRepository(opts.remote);
	const cache = new FakeSettingsCache(opts.cache);
	const app = createSettingsApp({
		repository: repo,
		cache,
		clock: fakeClock(),
		ids: fakeIds(),
	});
	return { app, repo, cache };
}

describe("createSettingsApp", () => {
	describe("createSkill", () => {
		it("adds a skill and pushes it to Drive", async () => {
			const { app, repo, cache } = makeHarness();

			const result = await app.createSkill({
				name: "GitHub focus",
				instruction: "Focus on releases.",
				domains: ["github.com"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.settings.size).toBe(1);
				expect(result.value.sync.status).toBe("synced");
			}
			expect(repo.saveCalls).toBe(1);
			expect(cache.saves.length).toBeGreaterThan(0);
		});

		it("returns a typed invalid-skill error without touching the cache's settings", async () => {
			const { app, cache } = makeHarness();

			const result = await app.createSkill({ name: "", instruction: "x" });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid-skill");
			}
			expect(cache.state.settings.size).toBe(0);
		});

		it("marks the cache pending and keeps the desired value when Drive save fails", async () => {
			const { app, repo, cache } = makeHarness();
			repo.failKind = "network";

			const result = await app.createSkill({ name: "A", instruction: "x" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.settings.size).toBe(1);
				expect(result.value.sync.status).toBe("error");
				expect(result.value.sync.pending).toBe(true);
			}
			expect(cache.state.settings.size).toBe(1);
		});
	});

	describe("updateSkill / setSkillEnabled / deleteSkill", () => {
		it("updates an existing skill in place", async () => {
			const { app } = makeHarness();
			const created = await app.createSkill({ name: "A", instruction: "x" });
			if (!created.ok) throw new Error("fixture failed");
			const id = created.value.settings.customSkills()[0].id;

			const updated = await app.updateSkill(id, { name: "Renamed" });
			expect(updated.ok).toBe(true);
			if (updated.ok) {
				expect(updated.value.settings.get(id)?.name).toBe("Renamed");
			}
		});

		it("errors for an unknown id", async () => {
			const { app } = makeHarness();
			const result = await app.updateSkill(skillId("missing"), {
				name: "x",
			});
			expect(result.ok).toBe(false);
		});

		it("toggles enabled through setSkillEnabled", async () => {
			const { app } = makeHarness();
			const created = await app.createSkill({ name: "A", instruction: "x" });
			if (!created.ok) throw new Error("fixture failed");
			const id = created.value.settings.customSkills()[0].id;

			const disabled = await app.setSkillEnabled(id, false);
			expect(disabled.ok).toBe(true);
			if (disabled.ok) {
				expect(disabled.value.settings.get(id)?.enabled).toBe(false);
			}
		});

		it("deletes a skill", async () => {
			const { app } = makeHarness();
			const created = await app.createSkill({ name: "A", instruction: "x" });
			if (!created.ok) throw new Error("fixture failed");
			const id = created.value.settings.customSkills()[0].id;

			const result = await app.deleteSkill(id);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.settings.size).toBe(0);
			}
		});
	});

	describe("syncSettingsFromDrive", () => {
		it("pulls the authoritative settings from Drive and refreshes the cache", async () => {
			const remote = Settings.empty().add(
				{ name: "Remote", instruction: "x" },
				{ id: skillId("r1"), now: isoTimestamp("2026-01-01T00:00:00Z") },
			);
			if (!remote.ok) throw new Error("fixture failed");
			const { app, cache } = makeHarness({ remote: remote.value });

			const result = await app.syncSettingsFromDrive();

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.settings.size).toBe(1);
			}
			expect(cache.state.sync.status).toBe("synced");
		});

		it("re-pushes pending local changes instead of discarding them", async () => {
			const local = Settings.empty().add(
				{ name: "Local", instruction: "x" },
				{ id: skillId("l1"), now: isoTimestamp("2026-02-01T00:00:00Z") },
			);
			if (!local.ok) throw new Error("fixture failed");
			const { app, repo, cache } = makeHarness({
				cache: {
					settings: local.value,
					sync: { status: "error", pending: true },
				},
			});

			const result = await app.syncSettingsFromDrive();

			expect(result.ok).toBe(true);
			expect(repo.saveCalls).toBe(1);
			if (result.ok) {
				expect(result.value.settings.size).toBe(1);
			}
			expect(cache.state.sync.pending).toBeFalsy();
		});

		it("surfaces a typed drive error and keeps the cached settings when load fails", async () => {
			const { app, repo, cache } = makeHarness();
			repo.failKind = "auth";

			const result = await app.syncSettingsFromDrive();

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("drive");
			}
			expect(cache.state.sync.status).toBe("error");
		});
	});
});
