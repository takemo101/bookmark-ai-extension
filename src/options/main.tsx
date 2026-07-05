import React from "react";
import { createRoot } from "react-dom/client";

import {
	ThemeProvider,
	createMatchMediaSystemDark,
	createThemePreferenceStorage,
	createThemeStore,
} from "../lib/theme/index";
import { createAskAiController } from "./ask-ai-view-model";
import { Options } from "./Options";
import { applyOptionsPageReset } from "./page-reset";
import {
	createRuntimeAskAiDeps,
	createRuntimeSkillsUseCases,
	createRuntimeUseCases,
} from "./runtime";
import { createSkillsController } from "./skills-view-model";
import { createOptionsSyncRequestSource } from "./sync-request";
import { createOptionsController } from "./view-model";

const container = document.getElementById("root");
if (!container) {
	throw new Error("Options root element #root not found");
}

// Chrome keeps the browser default body margin for extension pages; the Options
// shell owns its spacing explicitly, so reset the outer page chrome before
// mounting React. The reset paints the light default; the mounted page
// repaints once the persisted theme preference resolves.
applyOptionsPageReset(document.body);

// Theme store: the local-only light/dark/system preference from
// `chrome.storage.local` plus the system color scheme; the app-header
// ThemeSelect writes through it.
const themeStore = createThemeStore({
	storage: createThemePreferenceStorage(),
	systemDark: createMatchMediaSystemDark(window),
});

// Composition root: build the real use cases, wrap them in the controller, and
// inject it. The component itself stays free of Chrome/Drive/AI wiring.
const controller = createOptionsController(createRuntimeUseCases());
const skillsController = createSkillsController(createRuntimeSkillsUseCases());
// Ask AI chat state is ephemeral by design (MIK-045/MIK-046): the controller
// holds it in memory only and dies with the page. Its deps read the local
// bookmark cache (never Drive) and run the Prompt API recommendation prompt.
const askAiController = createAskAiController(createRuntimeAskAiDeps());

// Manage-in-Options sync requests (MIK-026): a marker written before this page
// mounted is only consumed — the controller's init() already pulls Drive — and
// a request arriving while the page is open re-runs the Drive refresh.
const syncRequests = createOptionsSyncRequestSource();
syncRequests.subscribe(() => void controller.refresh());
void syncRequests.consumePending();

createRoot(container).render(
	<React.StrictMode>
		<ThemeProvider store={themeStore}>
			<Options
				controller={controller}
				skillsController={skillsController}
				askAiController={askAiController}
			/>
		</ThemeProvider>
	</React.StrictMode>,
);
