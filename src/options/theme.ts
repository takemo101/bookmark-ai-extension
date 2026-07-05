/**
 * Options-side theme access: one hook combining the shared theme context
 * (`lib/theme`) with the options page's themed style objects. Options-local
 * by design — the Popup has its own equivalent — so neither layer imports
 * the other's styles (AGENTS.md "Architecture boundaries"). Without a
 * `ThemeProvider` (existing tests, embeds) it returns the static light Warm
 * Library theme with a no-op setter.
 */
import {
	type ResolvedTheme,
	type ThemePalette,
	type ThemePreference,
	useTheme,
} from "../lib/theme/index";
import { type OptionsStyles, optionsStylesFor } from "./styles";

export type OptionsTheme = {
	readonly preference: ThemePreference;
	readonly resolved: ResolvedTheme;
	readonly palette: ThemePalette;
	readonly styles: OptionsStyles;
	readonly setPreference: (preference: ThemePreference) => void;
};

export function useOptionsTheme(): OptionsTheme {
	const { preference, resolved, palette, setPreference } = useTheme();
	return {
		preference,
		resolved,
		palette,
		styles: optionsStylesFor(palette),
		setPreference,
	};
}
