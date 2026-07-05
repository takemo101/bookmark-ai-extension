/**
 * Theme preference domain (pure, Chrome-free).
 *
 * The user picks `light`, `dark`, or `system` (the default); `system` resolves
 * against the OS/browser `prefers-color-scheme` signal at runtime. Parsing
 * happens at the boundary: whatever `chrome.storage.local` (or anything else)
 * hands us becomes a valid {@link ThemePreference} or falls back to `system`,
 * so downstream code never branches on invalid values.
 */

/** The user-selectable theme preference. */
export type ThemePreference = "light" | "dark" | "system";

/** The concrete theme a page renders with after resolving `system`. */
export type ResolvedTheme = "light" | "dark";

/** Every valid preference value, for selectors and validation. */
export const THEME_PREFERENCES: readonly ThemePreference[] = [
	"light",
	"dark",
	"system",
];

/** The default preference when nothing valid is stored. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/**
 * Parse an untrusted persisted value into an always-valid preference.
 * Missing, non-string, or unknown values fall back to `system`.
 */
export function parseThemePreference(value: unknown): ThemePreference {
	if (value === "light" || value === "dark" || value === "system") {
		return value;
	}
	return DEFAULT_THEME_PREFERENCE;
}

/**
 * Resolve a preference to the concrete theme: explicit choices win, `system`
 * follows the injected system-dark signal.
 */
export function resolveTheme(
	preference: ThemePreference,
	systemDark: boolean,
): ResolvedTheme {
	if (preference === "light" || preference === "dark") {
		return preference;
	}
	return systemDark ? "dark" : "light";
}
