import React from "react";
import { createRoot } from "react-dom/client";

import {
	ThemeProvider,
	createMatchMediaSystemDark,
	createThemePreferenceStorage,
	createThemeStore,
} from "../lib/theme/index";
import { Popup } from "./Popup";
import { applyPopupPageReset } from "./page-reset";
import { createRuntimeUseCases } from "./runtime";
import { createPopupController } from "./view-model";

// The document body must match the receipt surface before first paint: zero
// margin, paper background (MIK-056). The reset paints the light default; the
// mounted popup repaints once the persisted theme preference resolves.
applyPopupPageReset(document.body);

const container = document.getElementById("root");
if (!container) {
	throw new Error("Popup root element #root not found");
}

// Composition root: build the real use cases, wrap them in the controller, and
// inject it. The component itself stays free of Chrome/Drive/AI wiring. The
// theme store reads the local-only preference (`chrome.storage.local`) and the
// system color scheme; the popup reflects it but exposes no selector.
const controller = createPopupController(createRuntimeUseCases());
const themeStore = createThemeStore({
	storage: createThemePreferenceStorage(),
	systemDark: createMatchMediaSystemDark(window),
});

createRoot(container).render(
	<React.StrictMode>
		<ThemeProvider store={themeStore}>
			<Popup controller={controller} />
		</ThemeProvider>
	</React.StrictMode>,
);
