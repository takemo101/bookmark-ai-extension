import React from "react";
import { createRoot } from "react-dom/client";

import { Options } from "./Options";
import { createRuntimeSkillsUseCases, createRuntimeUseCases } from "./runtime";
import { createSkillsController } from "./skills-view-model";
import { createOptionsController } from "./view-model";

const container = document.getElementById("root");
if (!container) {
	throw new Error("Options root element #root not found");
}

// Composition root: build the real use cases, wrap them in the controller, and
// inject it. The component itself stays free of Chrome/Drive/AI wiring.
const controller = createOptionsController(createRuntimeUseCases());
const skillsController = createSkillsController(createRuntimeSkillsUseCases());

createRoot(container).render(
	<React.StrictMode>
		<Options controller={controller} skillsController={skillsController} />
	</React.StrictMode>,
);
