/**
 * `runtime/*` boundary — the extension composition helpers.
 *
 * This is where the Chrome-bound adapters that the popup and options pages share
 * are assembled: the `chrome.scripting` page extractor and the Drive repository
 * stack (identity → Drive client → repository) plus its connection probe. It is
 * the only layer that imports both the app ports and the concrete Chrome/Drive
 * subsystems, keeping that glue out of the React components and the controllers
 * (AGENTS.md "Architecture boundaries"). Every adapter takes injectable chrome/
 * fetch dependencies so the seams are testable without a real browser or network.
 */
export {
	type ScriptInjector,
	type ActiveTabResolver,
	type ChromeExtractorDeps,
	createChromeScriptingExtractor,
} from "./chrome-extractor";

export {
	type ConnectionStatus,
	type ChromeDriveDeps,
	type ChromeDriveRuntime,
	createChromeDriveRuntime,
} from "./drive-repository";
