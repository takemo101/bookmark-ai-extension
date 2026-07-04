/**
 * `favicon/*` boundary (MIK-032).
 *
 * Owns render-time favicon resolution against Chrome's extension-local
 * `_favicon` endpoint plus the hostname-initial fallback. Display-only derived
 * data: nothing here is persisted, and no external favicon provider is used.
 */
export type { FaviconRuntime, FaviconView } from "./favicon";
export { faviconFallback, faviconView } from "./favicon";
