import { describe, expect, it } from "vitest";

import type { PromptModelNamespace } from "../../lib/ai/prompt-api";
import { runPromptApiServiceWorkerExperiment } from "./prompt-api-service-worker-experiment";

/**
 * These tests inject fake Prompt API namespaces (same style as
 * src/lib/ai/prompt-api.test.ts) rather than touching real Chrome globals, so
 * they stay pure, deterministic, and fast.
 */
describe("runPromptApiServiceWorkerExperiment", () => {
	it("reports fail/n/a when no namespace is present", async () => {
		const report = await runPromptApiServiceWorkerExperiment(null);
		expect(report.availability.status).toBe("fail");
		expect(report.availability.error).toBeTruthy();
		expect(report.sessionCreation.status).toBe("n/a");
		expect(report.promptExecution.status).toBe("n/a");
		expect(report.slowPromptLifecycle.status).toBe("n/a");
	});

	it("reports fail/n/a when availability() throws", async () => {
		const namespace: PromptModelNamespace = {
			availability: async () => {
				throw new Error("boom");
			},
			create: async () => ({ prompt: async () => "" }),
		};
		const report = await runPromptApiServiceWorkerExperiment(namespace);
		expect(report.availability.status).toBe("fail");
		expect(report.availability.error).toBe("boom");
		expect(report.sessionCreation.status).toBe("n/a");
		expect(report.promptExecution.status).toBe("n/a");
		expect(report.slowPromptLifecycle.status).toBe("n/a");
	});

	it("reports partial/n/a when availability resolves unavailable", async () => {
		const namespace: PromptModelNamespace = {
			availability: async () => "unavailable",
			create: async () => ({ prompt: async () => "" }),
		};
		const report = await runPromptApiServiceWorkerExperiment(namespace);
		expect(report.availability.status).toBe("partial");
		expect(report.sessionCreation.status).toBe("n/a");
		expect(report.promptExecution.status).toBe("n/a");
		expect(report.slowPromptLifecycle.status).toBe("n/a");
	});

	it("reports pass for all four points on the full success path", async () => {
		let destroyCount = 0;
		const createOptions: unknown[] = [];
		const namespace: PromptModelNamespace = {
			availability: async () => "available",
			create: async (options) => {
				createOptions.push(options);
				return {
					prompt: async () => "model output that must never appear in report",
					destroy: () => {
						destroyCount += 1;
					},
				};
			},
		};
		const report = await runPromptApiServiceWorkerExperiment(namespace);

		expect(report.availability.status).toBe("pass");
		expect(report.sessionCreation.status).toBe("pass");
		expect(report.promptExecution.status).toBe("pass");
		expect(report.slowPromptLifecycle.status).toBe("pass");

		expect(createOptions).toHaveLength(2);
		for (const options of createOptions) {
			expect(options).toMatchObject({
				expectedOutputs: [{ type: "text", languages: ["en"] }],
			});
		}

		// Both the promptExecution session and the slowPromptLifecycle session
		// must be destroyed.
		expect(destroyCount).toBe(2);

		const serialized = JSON.stringify(report);
		expect(serialized).not.toContain("model output");
		expect(serialized).not.toContain("Reply with exactly one word");
		expect(serialized).not.toContain("Count from one to ten");
	});

	it("has an ISO timestamp and a null-or-string userAgent", async () => {
		const report = await runPromptApiServiceWorkerExperiment(null);
		expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
		expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
		expect(
			report.userAgent === null || typeof report.userAgent === "string",
		).toBe(true);
	});

	it("reports sessionCreation fail and short-circuits promptExecution/slowPromptLifecycle to n/a", async () => {
		const namespace: PromptModelNamespace = {
			availability: async () => "available",
			create: async () => {
				throw new Error("create failed");
			},
		};
		const report = await runPromptApiServiceWorkerExperiment(namespace);
		expect(report.availability.status).toBe("pass");
		expect(report.sessionCreation.status).toBe("fail");
		expect(report.sessionCreation.error).toBe("create failed");
		expect(report.promptExecution.status).toBe("n/a");
		expect(report.slowPromptLifecycle.status).toBe("n/a");
	});

	it("still attempts slowPromptLifecycle independently when promptExecution fails", async () => {
		let callCount = 0;
		const destroyed: string[] = [];
		const namespace: PromptModelNamespace = {
			availability: async () => "available",
			create: async () => {
				callCount += 1;
				const sessionIndex = callCount;
				return {
					prompt: async () => {
						if (sessionIndex === 1) {
							throw new Error("first session prompt failed");
						}
						return "second session ok";
					},
					destroy: () => {
						destroyed.push(`session-${sessionIndex}`);
					},
				};
			},
		};
		const report = await runPromptApiServiceWorkerExperiment(namespace);

		expect(report.sessionCreation.status).toBe("pass");
		expect(report.promptExecution.status).toBe("fail");
		expect(report.promptExecution.error).toBe("first session prompt failed");
		expect(report.slowPromptLifecycle.status).toBe("pass");
		expect(destroyed).toEqual(["session-1", "session-2"]);
	});

	it("reports slowPromptLifecycle's own fail when its session creation throws after the first session succeeded", async () => {
		let callCount = 0;
		const namespace: PromptModelNamespace = {
			availability: async () => "available",
			create: async () => {
				callCount += 1;
				if (callCount === 1) {
					return { prompt: async () => "ok", destroy: () => {} };
				}
				throw new Error("second session create failed");
			},
		};
		const report = await runPromptApiServiceWorkerExperiment(namespace);

		expect(report.sessionCreation.status).toBe("pass");
		expect(report.promptExecution.status).toBe("pass");
		expect(report.slowPromptLifecycle.status).toBe("fail");
		expect(report.slowPromptLifecycle.error).toBe(
			"second session create failed",
		);
	});
});
