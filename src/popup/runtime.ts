/** Popup reads locally; the worker owns all accepted bookmark mutations. */
import { createChromePromptClient } from "../lib/ai/index";
import { prepareChromePromptModel } from "../lib/ai/prompt-api";
import { appError, err, ok } from "../lib/app/index";
import { detectUiLanguage } from "../lib/i18n/index";
import { createChromeDriveRuntime } from "../lib/runtime/index";
import { createBackgroundBookmarkClient } from "../lib/runtime/background-client";
import { createChromeTabProvider } from "../lib/runtime/chrome-tabs";
import { createChromeLocalCache } from "../lib/storage/index";
import { createPopupUseCases, type PopupUseCases } from "./use-cases";

export function createRuntimeUseCases(): PopupUseCases {
	const tabs = createChromeTabProvider();
	const drive = createChromeDriveRuntime();
	const prompt = createChromePromptClient();
	const app = createBackgroundBookmarkClient({
		tabs,
		cache: createChromeLocalCache(),
		send: (command) =>
			chrome.runtime.sendMessage({ action: "bookmark-job", ...command }),
	});
	return {
		...createPopupUseCases(app, {
			async currentTab() {
				const tab = await tabs.activeTab();
				return tab.ok
					? ok({ title: tab.value.title, url: tab.value.url })
					: tab;
			},
			async environment() {
				const [connection, promptApi] = await Promise.all([
					drive.probeConnection(),
					prompt.availability(detectUiLanguage()),
				]);
				return { connection, promptApi };
			},
		}),
		activeSave: () => app.activeSave(),
		waitForSave: (id, progress) =>
			app.waitForSave(id, (stage) => progress?.({ stage })),
		async prepareAi() {
			try {
				await prepareChromePromptModel(detectUiLanguage());
				return ok(undefined);
			} catch {
				return err(
					appError(
						"interrupted",
						"Model preparation failed. Keep this popup open and try again.",
					),
				);
			}
		},
	};
}
