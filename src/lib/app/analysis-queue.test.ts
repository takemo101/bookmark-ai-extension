import { describe, expect, it } from "vitest";

import { createAnalysisQueue } from "./analysis-queue";

/** A promise plus its externally-controlled resolve, for deterministic ordering tests. */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe("createAnalysisQueue", () => {
	it("processes items sequentially: the next process call does not start until the previous settles", async () => {
		const started: string[] = [];
		const finished: string[] = [];
		const gates = new Map<string, ReturnType<typeof deferred<string>>>();

		const queue = createAnalysisQueue<string, string>(async (item) => {
			started.push(item);
			const gate = deferred<string>();
			gates.set(item, gate);
			const result = await gate.promise;
			finished.push(item);
			return result;
		});

		queue.enqueue("a");
		queue.enqueue("b");

		// Only "a" has started; "b" must not start until "a"'s process resolves.
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toEqual(["a"]);
		expect(finished).toEqual([]);

		gates.get("a")?.resolve("a-result");
		// Let the pump advance to "b".
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toEqual(["a", "b"]);
		expect(finished).toEqual(["a"]);

		gates.get("b")?.resolve("b-result");
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(finished).toEqual(["a", "b"]);
	});

	it("delivers success and failure results via onSettled, in order", async () => {
		type Result = { ok: true; value: string } | { ok: false; error: string };
		const queue = createAnalysisQueue<string, Result>(async (item) => {
			if (item === "bad") {
				return { ok: false, error: "boom" };
			}
			return { ok: true, value: `processed-${item}` };
		});

		const events: Array<{ item: string; result: Result }> = [];
		queue.onSettled((item, result) => events.push({ item, result }));

		queue.enqueue("good");
		queue.enqueue("bad");

		await vi_flush();

		expect(events).toEqual([
			{ item: "good", result: { ok: true, value: "processed-good" } },
			{ item: "bad", result: { ok: false, error: "boom" } },
		]);
	});

	it("notifies multiple listeners for the same settlement", async () => {
		const queue = createAnalysisQueue<number, number>(async (n) => n * 2);
		const a: number[] = [];
		const b: number[] = [];
		queue.onSettled((_item, result) => a.push(result));
		queue.onSettled((_item, result) => b.push(result));

		queue.enqueue(1);
		queue.enqueue(2);
		await vi_flush();

		expect(a).toEqual([2, 4]);
		expect(b).toEqual([2, 4]);
	});

	it("stops notifying a listener after it unsubscribes", async () => {
		const queue = createAnalysisQueue<number, number>(async (n) => n);
		const seen: number[] = [];
		const unsubscribe = queue.onSettled((_item, result) => seen.push(result));

		queue.enqueue(1);
		await vi_flush();
		unsubscribe();
		queue.enqueue(2);
		await vi_flush();

		expect(seen).toEqual([1]);
	});

	it("accounts queued and in-flight items via size()", async () => {
		const gate = deferred<void>();
		const queue = createAnalysisQueue<number, void>(async () => {
			await gate.promise;
		});

		expect(queue.size()).toBe(0);
		queue.enqueue(1);
		// The pump picks the item up asynchronously (microtask), so give it a tick.
		await Promise.resolve();
		expect(queue.size()).toBe(1); // processing, none queued behind it

		queue.enqueue(2);
		queue.enqueue(3);
		expect(queue.size()).toBe(3); // 1 processing + 2 queued

		gate.resolve();
		await vi_flush();
		expect(queue.size()).toBe(0);
	});

	it("does not wedge the pump when process rejects for one item", async () => {
		const queue = createAnalysisQueue<string, string>(async (item) => {
			if (item === "throws") {
				throw new Error("unexpected");
			}
			return `ok-${item}`;
		});

		const events: Array<{ item: string; result: string }> = [];
		queue.onSettled((item, result) => events.push({ item, result }));

		queue.enqueue("throws");
		queue.enqueue("after");
		await vi_flush();

		// The throwing item produced no settlement event, but the queue kept
		// draining and the item behind it still completed.
		expect(events).toEqual([{ item: "after", result: "ok-after" }]);
		expect(queue.size()).toBe(0);
	});

	it("keeps a newly enqueued item processed by the same pump run", async () => {
		const order: string[] = [];
		const queue = createAnalysisQueue<string, void>(async (item) => {
			order.push(item);
			if (item === "a") {
				queue.enqueue("b");
			}
		});

		queue.enqueue("a");
		await vi_flush();

		expect(order).toEqual(["a", "b"]);
	});
});

/** Flush a handful of microtask turns — enough for a small queue's pump to settle. */
async function vi_flush(): Promise<void> {
	for (let i = 0; i < 10; i += 1) {
		await Promise.resolve();
	}
}
