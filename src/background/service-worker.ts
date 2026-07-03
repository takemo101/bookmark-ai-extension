/**
 * MV3 background service worker.
 *
 * Runtime wiring only. Popup/options compose their own adapters for the MVP;
 * this worker must not contain bookmark-domain decisions, Drive conflict logic,
 * or Prompt API parsing — see docs/implementation-principles.md.
 */
import {
	PROMPT_API_EXPERIMENT_MESSAGE_ACTION,
	runPromptApiServiceWorkerExperiment,
} from "./experiments/prompt-api-service-worker-experiment";

chrome.runtime.onInstalled.addListener((details) => {
	console.info("[bookmark-ai] service worker installed:", details.reason);
});

/**
 * MIK-020 experiment only: diagnostic trigger for manual Chrome DevTools use.
 * Inert unless a caller explicitly sends this exact message action; never
 * invoked by production save/re-analyze flows. See
 * docs/prompt-api-service-worker-experiment.md.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (
		typeof message === "object" &&
		message !== null &&
		(message as { action?: unknown }).action ===
			PROMPT_API_EXPERIMENT_MESSAGE_ACTION
	) {
		runPromptApiServiceWorkerExperiment()
			.then((report) => sendResponse({ ok: true, report }))
			.catch((error) =>
				sendResponse({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		return true;
	}
	return undefined;
});

export {};
