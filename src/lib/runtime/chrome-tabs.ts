import { type TabProviderPort, appError, err, ok } from "../app/index";

/** Capture once at the user's action; the worker never re-queries active tabs. */
export function createChromeTabProvider(): TabProviderPort {
	return {
		async activeTab() {
			try {
				const [tab] = await chrome.tabs.query({
					active: true,
					currentWindow: true,
				});
				if (!tab || tab.id === undefined || !tab.url)
					return err(appError("no-active-tab", "No active tab to save."));
				return ok({ id: tab.id, url: tab.url, title: tab.title ?? tab.url });
			} catch {
				return err(appError("no-active-tab", "Could not read the active tab."));
			}
		},
	};
}
