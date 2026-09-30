/**
 * MV3 background service worker.
 *
 * Owns accepted bookmark operations independently of popup/options lifetime.
 * Domain, Drive and AI rules remain behind their existing app ports.
 */
import { detectUiLanguage } from "../lib/i18n/index";
import { createBookmarkBadge } from "./bookmark-badge";
import {
	createBookmarkJobs,
	isBookmarkUiSender,
	parseBookmarkCommand,
} from "./bookmark-jobs";
import { createWorkerBookmarkApp } from "./bookmark-runtime";

const badge = createBookmarkBadge(chrome.action, detectUiLanguage());
// In-memory jobs do not survive restart. Never leave an old "AI" badge implying
// that a terminated job is still running, or restore success from a cache guess.
void badge.update(null);

const jobs = createBookmarkJobs({
	createApp: createWorkerBookmarkApp,
	newId: () => crypto.randomUUID(),
	keepAlive: () => chrome.runtime.getPlatformInfo(),
	onChange: (job) => {
		void badge.update(job);
	},
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (!isBookmarkUiSender(sender, chrome.runtime.id, chrome.runtime.getURL("")))
		return undefined;
	const command = parseBookmarkCommand(message);
	if (!command) {
		if (message?.action === "bookmark-job")
			sendResponse({
				ok: false,
				error: {
					kind: "invalid-tab",
					message: "Select a valid web page and try again.",
				},
			});
		return undefined;
	}
	// Acknowledge promptly; the worker owns the promise, not this message port.
	sendResponse(jobs.handle(command));
	return undefined;
});

chrome.runtime.onInstalled.addListener((details) => {
	console.info("[bookmark-ai] service worker installed:", details.reason);
});

export {};
