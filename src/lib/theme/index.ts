/**
 * `lib/theme` boundary.
 *
 * Owns the user-facing color theme: the `light | dark | system` preference
 * domain, its local-only persistence (`chrome.storage.local`, never Drive or
 * `bookmark-ai/settings.json`), the semantic light/dark palettes shared by
 * Popup and Options, the runtime store resolving `system` against
 * `prefers-color-scheme`, and the React provider/hook both pages mount.
 *
 * Layout tokens and composed style objects stay in the layer-local
 * `popup/styles.ts` / `options/styles.ts`; only semantic theme concerns live
 * here (AGENTS.md "Architecture boundaries").
 */
export type { ThemePreference, ResolvedTheme } from "./preference";
export {
	THEME_PREFERENCES,
	DEFAULT_THEME_PREFERENCE,
	parseThemePreference,
	resolveTheme,
} from "./preference";

export type { ThemePalette, StatusTone } from "./tokens";
export {
	lightThemePalette,
	darkThemePalette,
	themePaletteFor,
	statusColor,
} from "./tokens";

export type {
	ThemePreferenceStorage,
	ThemePreferenceStorageArea,
} from "./preference-storage";
export {
	THEME_PREFERENCE_KEY,
	createThemePreferenceStorage,
} from "./preference-storage";

export type { ThemeState, ThemeStore, SystemDarkSource } from "./store";
export { createThemeStore, createMatchMediaSystemDark } from "./store";

export type { ThemeContextValue } from "./react";
export { ThemeProvider, useTheme } from "./react";
