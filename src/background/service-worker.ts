/**
 * MV3 background service worker.
 *
 * Scaffold placeholder. Later issues add the real responsibilities (e.g.
 * orchestrating Drive sync and handling messages from popup/options). It must
 * not contain bookmark-domain decisions, Drive conflict logic, or Prompt API
 * parsing — see docs/implementation-principles.md.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.info('[bookmark-ai] service worker installed:', details.reason)
})

export {}
