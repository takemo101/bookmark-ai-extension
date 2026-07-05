/**
 * Runtime theme store: one small subscribable state holder that both the
 * Popup and Options pages consume through `useSyncExternalStore` (via
 * `lib/theme/react`). Framework-free by itself, Chrome-free by injection —
 * the preference storage and the system-dark signal are ports, so tests run
 * with plain fakes and no browser.
 *
 * State flow: `init()` loads the persisted preference; while the preference
 * is `system` the resolved theme follows the injected system-dark signal;
 * `setPreference` updates the state synchronously (the open page recolors
 * immediately) and persists best-effort — a storage write failure keeps the
 * in-memory selection for this page rather than surfacing an error for a
 * cosmetic setting.
 */
import {
	DEFAULT_THEME_PREFERENCE,
	type ResolvedTheme,
	type ThemePreference,
	resolveTheme,
} from "./preference";
import type { ThemePreferenceStorage } from "./preference-storage";
import { type ThemePalette, themePaletteFor } from "./tokens";

/** One immutable snapshot of the active theme. */
export type ThemeState = {
	readonly preference: ThemePreference;
	readonly resolved: ResolvedTheme;
	readonly palette: ThemePalette;
};

/** The system `prefers-color-scheme: dark` signal as an injectable port. */
export interface SystemDarkSource {
	prefersDark(): boolean;
	/** Notifies when the system scheme changes; returns an unsubscribe. */
	subscribe(onChange: () => void): () => void;
}

/**
 * The real `matchMedia` adapter. A window without `matchMedia` (or none at
 * all — unit tests run in node) reads as light and never changes, per the
 * design's safe-fallback requirement for `system` resolution.
 */
export function createMatchMediaSystemDark(
	win?: Pick<Window, "matchMedia">,
): SystemDarkSource {
	const media = win?.matchMedia?.("(prefers-color-scheme: dark)");
	return {
		prefersDark: () => media?.matches === true,
		subscribe(onChange) {
			if (!media) {
				return () => {};
			}
			media.addEventListener("change", onChange);
			return () => media.removeEventListener("change", onChange);
		},
	};
}

export interface ThemeStore {
	/** Load the persisted preference; safe to call once on page mount. */
	init(): Promise<void>;
	/** The current snapshot; identity changes only when the state changes. */
	getState(): ThemeState;
	subscribe(listener: () => void): () => void;
	/** Apply and persist a new preference. Never rejects. */
	setPreference(preference: ThemePreference): Promise<void>;
}

function stateOf(preference: ThemePreference, systemDark: boolean): ThemeState {
	const resolved = resolveTheme(preference, systemDark);
	return { preference, resolved, palette: themePaletteFor(resolved) };
}

export function createThemeStore(deps: {
	storage: ThemePreferenceStorage;
	systemDark: SystemDarkSource;
}): ThemeStore {
	const listeners = new Set<() => void>();
	let state = stateOf(DEFAULT_THEME_PREFERENCE, deps.systemDark.prefersDark());

	function replace(next: ThemeState): void {
		if (
			next.preference === state.preference &&
			next.resolved === state.resolved
		) {
			return;
		}
		state = next;
		for (const listener of listeners) {
			listener();
		}
	}

	deps.systemDark.subscribe(() => {
		// Only `system` follows the OS signal; explicit choices stay put.
		replace(stateOf(state.preference, deps.systemDark.prefersDark()));
	});

	return {
		async init(): Promise<void> {
			const preference = await deps.storage.load();
			replace(stateOf(preference, deps.systemDark.prefersDark()));
		},
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async setPreference(preference: ThemePreference): Promise<void> {
			replace(stateOf(preference, deps.systemDark.prefersDark()));
			try {
				await deps.storage.save(preference);
			} catch {
				// Cosmetic setting: the in-memory theme already applied for this
				// page; a failed write only loses persistence for the next open.
			}
		},
	};
}
