/**
 * React binding for the theme store: one provider + hook pair shared by the
 * Popup and Options pages (the only React code under `lib/theme`; everything
 * else in this module stays framework-free).
 *
 * Without a provider the hook returns the static light Warm Library theme
 * with a no-op setter, so existing component tests and embeds render
 * unchanged. The provider subscribes to a {@link ThemeStore} through
 * `useSyncExternalStore` (the third argument keeps `renderToStaticMarkup`
 * tests working, mirroring the controllers) and calls `init()` on mount.
 */
import type { ReactNode } from "react";
import {
	createContext,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";

import { DEFAULT_THEME_PREFERENCE } from "./preference";
import type { ThemeState, ThemeStore } from "./store";
import { lightThemePalette } from "./tokens";

export type ThemeContextValue = ThemeState & {
	setPreference: (preference: ThemeState["preference"]) => void;
};

/** The providerless default: light Warm Library, `system` preference. */
const STATIC_LIGHT: ThemeContextValue = {
	preference: DEFAULT_THEME_PREFERENCE,
	resolved: "light",
	palette: lightThemePalette,
	setPreference: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(STATIC_LIGHT);

export function ThemeProvider({
	store,
	children,
}: {
	store: ThemeStore;
	children: ReactNode;
}) {
	const state = useSyncExternalStore(
		store.subscribe,
		store.getState,
		store.getState,
	);

	useEffect(() => {
		void store.init();
	}, [store]);

	return (
		<ThemeContext.Provider
			value={{
				...state,
				setPreference: (preference) => void store.setPreference(preference),
			}}
		>
			{children}
		</ThemeContext.Provider>
	);
}

/** The active theme (and its setter) for the surrounding provider. */
export function useTheme(): ThemeContextValue {
	return useContext(ThemeContext);
}
