import React from "react";
import { createRoot } from "react-dom/client";

import { Options } from "./Options";
import { createRuntimeSkillsUseCases, createRuntimeUseCases } from "./runtime";
import { createSkillsController } from "./skills-view-model";
import { createOptionsSyncRequestSource } from "./sync-request";
import { createOptionsController } from "./view-model";

const container = document.getElementById("root");
if (!container) {
	throw new Error("Options root element #root not found");
}

// Composition root: build the real use cases, wrap them in the controller, and
// inject it. The component itself stays free of Chrome/Drive/AI wiring.
const controller = createOptionsController(createRuntimeUseCases());
const skillsController = createSkillsController(createRuntimeSkillsUseCases());

// Manage-in-Options sync requests (MIK-026): a marker written before this page
// mounted is only consumed — the controller's init() already pulls Drive — and
// a request arriving while the page is open re-runs the Drive refresh.
const syncRequests = createOptionsSyncRequestSource();
syncRequests.subscribe(() => void controller.refresh());
void syncRequests.consumePending();

createRoot(container).render(
	<React.StrictMode>
		<Options controller={controller} skillsController={skillsController} />
	</React.StrictMode>,
);
