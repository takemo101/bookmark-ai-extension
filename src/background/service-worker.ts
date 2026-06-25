/**
 * MV3 background service worker.
 *
 * Runtime wiring only. Popup/options compose their own adapters for the MVP;
 * this worker must not contain bookmark-domain decisions, Drive conflict logic,
 * or Prompt API parsing — see docs/implementation-principles.md.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.info('[bookmark-ai] service worker installed:', details.reason)
})

export {}
