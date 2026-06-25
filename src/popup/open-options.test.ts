import { afterEach, describe, expect, it, vi } from "vitest";

import { openOptionsPage } from "./open-options";

/**
 * The popup footer's "Manage in Options" action must be safe to invoke even when
 * the extension globals are absent (a standalone render, a unit test). Reading
 * the bare `chrome` identifier would throw `ReferenceError`; the guard reads
 * `globalThis.chrome` instead, which is simply `undefined` off-extension
 * (MIK-015).
 */
describe("openOptionsPage", () => {
	const g = globalThis as { chrome?: unknown };

	afterEach(() => {
		delete g.chrome;
	});

	it("does not throw when `chrome` is undeclared (standalone / test render)", () => {
		delete g.chrome;
		expect(() => openOptionsPage()).not.toThrow();
	});

	it("opens the options page when the extension runtime is present", () => {
		const open = vi.fn();
		g.chrome = { runtime: { openOptionsPage: open } };

		openOptionsPage();

		expect(open).toHaveBeenCalledTimes(1);
	});

	it("is a safe no-op when `runtime.openOptionsPage` is missing", () => {
		g.chrome = { runtime: {} };
		expect(() => openOptionsPage()).not.toThrow();
	});
});
