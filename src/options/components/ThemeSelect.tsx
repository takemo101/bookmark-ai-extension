/**
 * App-header theme preference selector: the one place the user picks
 * `light | dark | system` (default `system`). A native `<select>` — no
 * dependency, keyboard/screen-reader accessible via its visible label — that
 * writes through the shared theme context's `setPreference`, which persists
 * to `chrome.storage.local` only (never Google Drive or
 * `bookmark-ai/settings.json`). The Popup reflects the saved preference but
 * intentionally has no selector of its own.
 */
import { useId } from "react";

import { parseThemePreference } from "../../lib/theme/index";
import type { OptionsMessages } from "../i18n";
import { useOptionsTheme } from "../theme";

export function ThemeSelect({ m }: { m: OptionsMessages }) {
	const { preference, palette, styles, setPreference } = useOptionsTheme();
	const selectId = useId();
	return (
		<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
			<label
				htmlFor={selectId}
				style={{ fontSize: 12, color: palette.inkSoft }}
			>
				{m.themeLabel}
			</label>
			<select
				id={selectId}
				value={preference}
				aria-label={m.themeSelectAria}
				style={styles.themeSelect}
				onChange={(event) =>
					// Parse at the boundary even for our own <option> values so the
					// stored preference is always valid.
					setPreference(parseThemePreference(event.target.value))
				}
			>
				<option value="system">{m.themeSystem}</option>
				<option value="light">{m.themeLight}</option>
				<option value="dark">{m.themeDark}</option>
			</select>
		</span>
	);
}
