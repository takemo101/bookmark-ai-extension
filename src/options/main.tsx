import React from "react";
import { createRoot } from "react-dom/client";

import { Options } from "./Options";
import { createRuntimeUseCases } from "./runtime";
import { createOptionsController } from "./view-model";

const container = document.getElementById("root");
if (!container) {
	throw new Error("Options root element #root not found");
}

// Composition root: build the real use cases, wrap them in the controller, and
// inject it. The component itself stays free of Chrome/Drive/AI wiring.
const controller = createOptionsController(createRuntimeUseCases());

createRoot(container).render(
	<React.StrictMode>
		<Options controller={controller} />
	</React.StrictMode>,
);
