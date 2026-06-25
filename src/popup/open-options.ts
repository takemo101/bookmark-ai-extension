/**
 * Open the extension's options page, guarded so it is a no-op outside the
 * extension (a standalone render, a unit test) instead of throwing.
 *
 * Reading the bare `chrome` identifier throws `ReferenceError` when the global
 * is undeclared, so the popup footer must never do `chrome?.runtime?.…`.
 * `globalThis.chrome` is always safe to read — it is simply `undefined`
 * off-extension — and the optional chaining then no-ops (MIK-015).
 */
export function openOptionsPage(): void {
	const runtime = (
		globalThis as {
			chrome?: { runtime?: { openOptionsPage?: () => void } };
		}
	).chrome?.runtime;
	runtime?.openOptionsPage?.();
}
