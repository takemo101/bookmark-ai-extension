import { describe, expect, it } from "vitest";

import { createAskAiController } from "./ask-ai-view-model";

/**
 * Controller tests for the MIK-045 Ask AI screen shell: pure in-memory
 * question state, the shared minimum-question-length submit policy, and inert
 * submit — no Prompt API, no Drive/cache use cases, no persistence. Chat state
 * must vanish with the controller instance.
 */
describe("Ask AI view model (MIK-045)", () => {
	it("starts with an empty, non-submittable, idle view", () => {
		const controller = createAskAiController();

		expect(controller.getView()).toEqual({
			question: "",
			canSubmit: false,
			answering: false,
		});
	});

	it("updates the question and allows submit at the minimum length", () => {
		const controller = createAskAiController();

		controller.setQuestion("ab");

		expect(controller.getView().question).toBe("ab");
		expect(controller.getView().canSubmit).toBe(true);
	});

	it("keeps submit disabled for an empty or too-short question", () => {
		const controller = createAskAiController();

		controller.setQuestion("a");
		expect(controller.getView().canSubmit).toBe(false);

		controller.setQuestion("");
		expect(controller.getView().canSubmit).toBe(false);
	});

	it("trims whitespace before applying the minimum length", () => {
		const controller = createAskAiController();

		controller.setQuestion("   a   ");
		expect(controller.getView().canSubmit).toBe(false);

		controller.setQuestion("  ab ");
		expect(controller.getView().canSubmit).toBe(true);
	});

	it("fills the question from a chosen example prompt", () => {
		const controller = createAskAiController();

		controller.useExample("Find saved bookmarks about TypeScript testing");

		expect(controller.getView().question).toBe(
			"Find saved bookmarks about TypeScript testing",
		);
		expect(controller.getView().canSubmit).toBe(true);
	});

	it("keeps submit inert in this slice — no state change, no answering flip", () => {
		const controller = createAskAiController();
		controller.setQuestion("TypeScriptのテストについて保存済みから探す");
		const before = controller.getView();

		controller.submit();

		expect(controller.getView()).toEqual(before);
		expect(controller.getView().answering).toBe(false);
	});

	it("notifies subscribers on question changes and stops after unsubscribe", () => {
		const controller = createAskAiController();
		let notified = 0;
		const unsubscribe = controller.subscribe(() => {
			notified += 1;
		});

		controller.setQuestion("chrome extensions");
		expect(notified).toBe(1);

		unsubscribe();
		controller.setQuestion("something else");
		expect(notified).toBe(1);
	});
});
