export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFieldValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly string[]
	| readonly number[]
	| readonly boolean[];

export type LogFields = Readonly<Record<string, LogFieldValue>>;

export interface Logger {
	log(level: LogLevel, event: string, fields?: LogFields): void;
}

export interface LogEntry {
	level: LogLevel;
	event: string;
	fields: LogFields;
}

export const noopLogger: Logger = {
	log() {},
};

type ConsoleLike = Partial<Pick<Console, "debug" | "info" | "warn" | "error">>;

export function createConsoleLogger(
	options: { namespace?: string; console?: ConsoleLike } = {},
): Logger {
	const namespace = options.namespace ?? "bookmark-ai";
	const target = options.console ?? globalThis.console;
	return {
		log(level, event, fields = {}) {
			const method =
				target[level] ?? target.info ?? target.warn ?? target.error;
			if (!method) return;
			method.call(target, `[${namespace}]`, { level, event, ...fields });
		},
	};
}

export function errorLogFields(error: unknown): LogFields {
	const fields: Record<string, LogFieldValue> = {
		errorName: errorName(error),
	};
	const requested = numericErrorField(error, "requested");
	if (requested !== undefined) fields.requested = requested;
	const contextWindow = numericErrorField(error, "contextWindow");
	if (contextWindow !== undefined) fields.contextWindow = contextWindow;
	return fields;
}

function errorName(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		typeof error.name === "string" &&
		error.name.length > 0
	) {
		return error.name;
	}
	return typeof error;
}

function numericErrorField(error: unknown, field: string): number | undefined {
	if (typeof error !== "object" || error === null || !(field in error)) {
		return undefined;
	}
	const value = (error as Record<string, unknown>)[field];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export interface MemoryLogger extends Logger {
	entries: LogEntry[];
}

export function createMemoryLogger(): MemoryLogger {
	const entries: LogEntry[] = [];
	return {
		entries,
		log(level, event, fields = {}) {
			entries.push({ level, event, fields });
		},
	};
}
