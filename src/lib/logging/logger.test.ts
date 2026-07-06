import { describe, expect, it, vi } from "vitest";

import {
	createConsoleLogger,
	createMemoryLogger,
	errorLogFields,
	noopLogger,
} from "./logger";

describe("shared logger", () => {
	it("records structured memory log entries for tests", () => {
		const logger = createMemoryLogger();

		logger.log("warn", "ai.analysis.parse-failed", {
			kind: "no-json",
			promptLength: 123,
		});

		expect(logger.entries).toEqual([
			{
				level: "warn",
				event: "ai.analysis.parse-failed",
				fields: { kind: "no-json", promptLength: 123 },
			},
		]);
	});

	it("writes console logs with a namespace and structured fields", () => {
		const warn = vi.fn();
		const logger = createConsoleLogger({
			namespace: "bookmark-ai",
			console: { warn },
		});

		logger.log("warn", "ask-ai.recommendation.parse-failed", {
			kind: "invalid-json",
		});

		expect(warn).toHaveBeenCalledWith("[bookmark-ai]", {
			level: "warn",
			event: "ask-ai.recommendation.parse-failed",
			kind: "invalid-json",
		});
	});

	it("noop logger accepts entries without side effects", () => {
		expect(() =>
			noopLogger.log("error", "ai.analysis.prompt-failed", {
				errorName: "Error",
			}),
		).not.toThrow();
	});

	it("extracts safe quota fields from Prompt API errors", () => {
		const error = Object.assign(new Error("too large"), {
			name: "QuotaExceededError",
			requested: 30_000,
			contextWindow: 20_000,
		});

		expect(errorLogFields(error)).toEqual({
			errorName: "QuotaExceededError",
			requested: 30_000,
			contextWindow: 20_000,
		});
	});
});
