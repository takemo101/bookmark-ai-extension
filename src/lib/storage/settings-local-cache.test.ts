import { describe, expect, it } from "vitest";

import { isoTimestamp } from "../bookmarks/index";
import { Settings, skillId } from "../settings/index";
import type { LocalCacheStorageArea } from "./local-cache";
import { createChromeSettingsCache } from "./settings-local-cache";
import { SETTINGS_CACHE_KEY } from "./settings-types";

/**
 * The adapter is driven by an in-memory fake of the `chrome.storage.local`
 * area, exactly like `local-cache.test.ts`'s bookmark-cache tests. This
 * mirrors the parse-on-read/serialize-on-write/degrade-on-corruption behavior
 * for the settings cache's own key.
 */
class FakeStorageArea implements LocalCacheStorageArea {
	store = new Map<string, unknown>();

	async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
		const key = Array.isArray(keys) ? keys[0] : keys;
		if (key === null || key === undefined) {
			return Object.fromEntries(this.store);
		}
		return this.store.has(key) ? { [key]: this.store.get(key) } : {};
	}

	async set(items: Record<string, unknown>): Promise<void> {
		for (const [key, value] of Object.entries(items)) {
			this.store.set(key, value);
		}
	}

	async remove(keys: string | string[]): Promise<void> {
		for (const key of Array.isArray(keys) ? keys : [keys]) {
			this.store.delete(key);
		}
	}
}

function settingsOf(name: string, updatedAt: string): Settings {
	const now = isoTimestamp(updatedAt);
	const result = Settings.empty().add(
		{ name, instruction: "Focus on X." },
		{ id: skillId("s1"), now },
	);
	if (!result.ok) throw new Error("fixture add failed");
	return result.value;
}

describe("createChromeSettingsCache", () => {
	it("returns the empty state when nothing is stored", async () => {
		const cache = createChromeSettingsCache(new FakeStorageArea());
		const state = await cache.load();
		expect(state.settings.size).toBe(0);
		expect(state.sync.status).toBe("idle");
	});

	it("round-trips a saved settings snapshot", async () => {
		const area = new FakeStorageArea();
		const cache = createChromeSettingsCache(area);
		const settings = settingsOf("A", "2026-01-01T00:00:00Z");

		await cache.save({
			settings,
			sync: {
				status: "synced",
				lastSyncedAt: isoTimestamp("2026-01-01T00:00:00Z"),
			},
		});

		const loaded = await cache.load();
		expect(loaded.settings.size).toBe(1);
		expect(loaded.settings.customSkills()[0]?.name).toBe("A");
		expect(loaded.sync.status).toBe("synced");
	});

	it("degrades to the empty state when the stored payload is corrupt", async () => {
		const area = new FakeStorageArea();
		area.store.set(SETTINGS_CACHE_KEY, { garbage: true });
		const cache = createChromeSettingsCache(area);

		const state = await cache.load();
		expect(state.settings.size).toBe(0);
		expect(state.sync.status).toBe("idle");
	});

	it("clear() removes the stored settings-cache key without touching other keys", async () => {
		const area = new FakeStorageArea();
		area.store.set("some-other-key", "keep-me");
		const cache = createChromeSettingsCache(area);
		await cache.save({ settings: Settings.empty(), sync: { status: "idle" } });

		await cache.clear();

		expect(area.store.has(SETTINGS_CACHE_KEY)).toBe(false);
		expect(area.store.get("some-other-key")).toBe("keep-me");
	});
});
