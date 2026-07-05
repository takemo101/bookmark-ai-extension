/**
 * Popup-side theme access: one hook combining the shared theme context
 * (`lib/theme`) with the popup's themed style objects. Popup-local by design
 * — Options has its own equivalent — so neither layer imports the other's
 * styles (AGENTS.md "Architecture boundaries"). Without a `ThemeProvider`
 * (existing tests, embeds) it returns the static light Warm Library theme.
 */
import {
	type ResolvedTheme,
	type ThemePalette,
	useTheme,
} from "../lib/theme/index";
import { type PopupStyles, popupStylesFor } from "./styles";

export type PopupTheme = {
	readonly resolved: ResolvedTheme;
	readonly palette: ThemePalette;
	readonly styles: PopupStyles;
};

export function usePopupTheme(): PopupTheme {
	const { resolved, palette } = useTheme();
	return { resolved, palette, styles: popupStylesFor(palette) };
}
