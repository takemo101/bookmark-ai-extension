/**
 * A tiny, generic, sequential in-memory queue (MIK-019).
 *
 * Purely mechanical — no Chrome, Drive, AI, or bookmark-domain imports — so it
 * stays testable on its own and so `bookmark-app.ts` can instantiate it with
 * concrete `QueuedAnalysisItem`/`Result<SaveOutcome, AppError>` types without a
 * circular import. Items are processed one at a time, in enqueue order; a new
 * `enqueue` while the pump is already draining the queue just appends and lets
 * the running pump pick it up.
 *
 * `process` must be total (never throw): a throwing `process` would otherwise
 * wedge the pump for every item still waiting behind the one that threw. This
 * mirrors how the rest of `app/*` never throws for recoverable failures (see
 * docs/implementation-principles.md "Error handling policy") — callers should
 * pass a `process` function that already turns its own failures into a
 * `TResult` value (e.g. `Result`'s `Err` branch) rather than rejecting.
 *
 * The queue itself holds no durable state: it is a plain object owned by
 * whoever constructs it, so its lifetime is exactly that owner's lifetime
 * (`createBookmarkApp`'s instance, i.e. the popup/options JS context). Nothing
 * here is written to `chrome.storage`, Drive, or any other durable store.
 */

/** A generic sequential in-memory processing queue. */
export interface AnalysisQueue<TItem, TResult> {
	/** Append an item; processing starts/continues automatically, one item at a time. */
	enqueue(item: TItem): void;
	/** Subscribe to per-item completion (fires once per enqueued item, after it settles). */
	onSettled(listener: (item: TItem, result: TResult) => void): () => void;
	/** Items queued or currently processing — for tests/diagnostics only. */
	size(): number;
}

/**
 * Build a sequential in-memory queue around `process`. Enqueued items are
 * processed strictly one at a time (the next item's `process` call does not
 * start until the previous one's promise settles), and every settlement is
 * broadcast to all current `onSettled` listeners.
 */
export function createAnalysisQueue<TItem, TResult>(
	process: (item: TItem) => Promise<TResult>,
): AnalysisQueue<TItem, TResult> {
	const pending: TItem[] = [];
	const listeners = new Set<(item: TItem, result: TResult) => void>();
	let processing = false;

	async function pump(): Promise<void> {
		if (processing) {
			return;
		}
		processing = true;
		while (pending.length > 0) {
			const item = pending.shift() as TItem;
			try {
				const result = await process(item);
				for (const listener of listeners) {
					listener(item, result);
				}
			} catch {
				// `process` is documented to be total/non-throwing (recoverable
				// failures should already be encoded as a `TResult` value); a
				// rejection here is unexpected, but the queue must never wedge
				// because of it. Swallow it and move on to the next item rather than
				// leaving `pending` stuck behind a dead pump — no `TResult` can be
				// fabricated generically, so no `onSettled` event fires for this item.
			}
		}
		processing = false;
	}

	return {
		enqueue(item) {
			pending.push(item);
			void pump();
		},
		onSettled(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		size() {
			return pending.length + (processing ? 1 : 0);
		},
	};
}
