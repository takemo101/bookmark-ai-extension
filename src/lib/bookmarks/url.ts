/**
 * Bookmark URL parsing and canonicalization.
 *
 * `BookmarkUrl` is the URL the user actually visited (preserved for display and
 * opening). `CanonicalUrl` is the normalized dedup key used for upsert and
 * merge. Keeping both means we can show the original link while still treating
 * `https://example.com/a?utm_source=x` and `https://example.com/a` as the same
 * bookmark.
 *
 * MVP normalization rules (deterministic, see docs/design.md "Duplicate
 * Behavior"):
 *   1. only http/https URLs are accepted;
 *   2. scheme and host are lowercased;
 *   3. a leading `www.` is dropped from the host;
 *   4. default ports (80/443) are removed;
 *   5. the fragment (`#...`) is removed;
 *   6. known tracking query params (utm_*, gclid, fbclid, ...) are removed;
 *   7. remaining query params are sorted by key for stable ordering;
 *   8. a trailing slash is removed from non-root paths.
 */
import type { BookmarkUrl, CanonicalUrl } from "./values";
import { type Result, err, ok } from "./result";

export type UrlError = { readonly field: string; readonly message: string };

const TRACKING_PARAMS = new Set([
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
	"utm_id",
	"gclid",
	"dclid",
	"fbclid",
	"msclkid",
	"mc_cid",
	"mc_eid",
	"igshid",
	"ref",
	"ref_src",
	"spm",
]);

function parseHttpUrl(value: unknown, field: string): Result<URL, UrlError> {
	if (typeof value !== "string") {
		return err({ field, message: `${field} must be a string` });
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return err({ field, message: `${field} must not be empty` });
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return err({ field, message: `${field} is not a valid URL: ${trimmed}` });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return err({
			field,
			message: `${field} must be http(s): ${url.protocol}`,
		});
	}
	return ok(url);
}

/** Parse the user-visited URL for display/opening, applying standard URL normalization. */
export function parseBookmarkUrl(
	value: unknown,
): Result<BookmarkUrl, UrlError> {
	const parsed = parseHttpUrl(value, "url");
	if (!parsed.ok) {
		return parsed;
	}
	return ok(parsed.value.toString() as BookmarkUrl);
}

/** Normalize any http(s) URL into the canonical dedup key. */
export function canonicalizeUrl(
	value: unknown,
): Result<CanonicalUrl, UrlError> {
	const parsed = parseHttpUrl(value, "canonicalUrl");
	if (!parsed.ok) {
		return parsed;
	}
	const url = parsed.value;

	url.protocol = url.protocol.toLowerCase();
	url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
	url.hash = "";

	// URL already drops default ports, but normalize explicitly for safety.
	if (
		(url.protocol === "http:" && url.port === "80") ||
		(url.protocol === "https:" && url.port === "443")
	) {
		url.port = "";
	}

	const kept: Array<[string, string]> = [];
	for (const [key, val] of url.searchParams) {
		if (!TRACKING_PARAMS.has(key.toLowerCase())) {
			kept.push([key, val]);
		}
	}
	kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	url.search = "";
	for (const [key, val] of kept) {
		url.searchParams.append(key, val);
	}

	if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
		url.pathname = url.pathname.replace(/\/+$/, "");
	}

	return ok(url.toString() as CanonicalUrl);
}

/** Validate an already-stored canonical URL string from an external record. */
export function parseCanonicalUrl(
	value: unknown,
): Result<CanonicalUrl, UrlError> {
	const parsed = parseHttpUrl(value, "canonicalUrl");
	if (!parsed.ok) {
		return parsed;
	}
	return ok(parsed.value.toString() as CanonicalUrl);
}
