import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { Favicon } from "./favicon";

/**
 * Static-markup tests for the MIK-032 favicon tile: image vs fallback is
 * decided by whether the (stubbed) Chrome runtime resolves a `_favicon` URL.
 * The image-error fallback is runtime DOM behavior (`onError` state) that
 * static rendering cannot drive; the no-src path pins the same fallback
 * markup.
 */

afterEach(() => {
	delete (globalThis as { chrome?: unknown }).chrome;
});

function stubChromeRuntime(): void {
	(globalThis as { chrome?: unknown }).chrome = {
		runtime: {
			getURL: (path: string) => `chrome-extension://test-ext${path}`,
		},
	};
}

describe("Favicon", () => {
	it("renders a decorative _favicon image when the Chrome runtime resolves", () => {
		stubChromeRuntime();

		const html = renderToStaticMarkup(
			<Favicon pageUrl="https://example.test/page" size={22} />,
		);

		expect(html).toContain(
			"chrome-extension://test-ext/_favicon/?pageUrl=https%3A%2F%2Fexample.test%2Fpage&amp;size=22",
		);
		expect(html).toContain('alt=""');
		expect(html).toContain("aria-hidden");
		expect(html).not.toContain(">E<");
	});

	it("renders the hostname-initial fallback tile off-extension", () => {
		const html = renderToStaticMarkup(
			<Favicon pageUrl="https://example.test/page" size={22} />,
		);

		expect(html).not.toContain("<img");
		expect(html).toContain(">E</span>");
		expect(html).toContain("aria-hidden");
	});

	it("renders a neutral glyph for an unparseable URL", () => {
		stubChromeRuntime();

		const html = renderToStaticMarkup(<Favicon pageUrl="::::" size={22} />);

		expect(html).not.toContain("<img");
		expect(html).toContain(">•</span>");
	});
});
