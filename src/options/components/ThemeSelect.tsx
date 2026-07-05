/**
 * App-header theme preference control: the one place the user picks
 * `light | dark | system` (default `system`). A compact round native button —
 * no dependency, keyboard/screen-reader accessible through icon-hidden text —
 * cycles through the three valid preferences and writes through the shared
 * theme context's `setPreference`, which persists to `chrome.storage.local`
 * only (never Google Drive or `bookmark-ai/settings.json`). The Popup reflects
 * the saved preference but intentionally has no selector of its own.
 */
import type { ThemePreference } from "../../lib/theme/index";
import type { OptionsMessages } from "../i18n";
import { useOptionsTheme } from "../theme";

const THEME_ICON: Record<ThemePreference, string> = {
	system: "◐",
	light: "☀",
	dark: "☾",
};

export function nextThemePreference(
	preference: ThemePreference,
): ThemePreference {
	if (preference === "system") {
		return "light";
	}
	if (preference === "light") {
		return "dark";
	}
	return "system";
}

export function ThemeSelect({ m }: { m: OptionsMessages }) {
	const { preference, styles, setPreference } = useOptionsTheme();
	const next = nextThemePreference(preference);
	const label = m.themeToggleAria(
		m.themePreference(preference),
		m.themePreference(next),
	);
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			style={styles.themeToggleButton}
			onClick={() => setPreference(next)}
		>
			<span aria-hidden="true">{THEME_ICON[preference]}</span>
		</button>
	);
}
