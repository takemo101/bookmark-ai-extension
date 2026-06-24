/**
 * Injectable ports for the use-case layer.
 *
 * Use cases depend only on these small interfaces, never on Chrome, Drive, the
 * Prompt API, or real page extraction. That is the whole point of the layer:
 * with fakes implementing each port, every flow is unit-testable in Node (see
 * AGENTS.md "Testability rules" and docs/implementation-principles.md). Concrete
 * adapters that wire these to the real subsystems live in `./adapters.ts` and in
 * the UI; nothing here imports a browser global.
 *
 * Boundary discipline:
 *   - {@link BookmarkRepositoryPort} exposes only the I/O the Drive repository
 *     already offers; use cases never reach past it into Drive API details.
 *   - {@link AnalyzerPort} exposes only "analyze this input"; use cases never
 *     touch Prompt API prompting/parsing.
 *   - {@link PageExtractorPort} returns already-parsed {@link ExtractedPage}; use
 *     cases never run extraction algorithms themselves.
 */
import type {
	BookmarkId,
	Bookmarks,
	IsoTimestamp,
} from "../bookmarks/index";
import type {
	DriveLocation,
	RepositoryError,
	Result as DriveResult,
} from "../drive/index";
import type { RepositorySnapshot } from "../drive/repository";
import type { AnalysisInput, AnalysisOutcome } from "../ai/index";
import type {
	ExtractedPage,
	ExtractionError,
	Result as ExtractionResult,
} from "../extraction/index";
import type { LocalCache } from "../storage/index";
import type { AppError } from "./errors";
import type { Result } from "./result";

/**
 * The Drive repository, reduced to the three operations the app needs. The
 * concrete `DriveBookmarkRepository` satisfies this structurally, so wiring is a
 * direct pass-through; a fake satisfies it for tests.
 */
export interface BookmarkRepositoryPort {
	bootstrap(): Promise<DriveResult<DriveLocation, RepositoryError>>;
	load(): Promise<DriveResult<RepositorySnapshot, RepositoryError>>;
	save(
		local: Bookmarks,
	): Promise<DriveResult<RepositorySnapshot, RepositoryError>>;
}

/** The AI analyzer, reduced to a single "analyze this excerpt" call. */
export interface AnalyzerPort {
	analyze(input: AnalysisInput): Promise<AnalysisOutcome>;
}

/**
 * A page to extract. `tabId`, when present, lets a Chrome adapter inject the
 * extractor into an already-open tab (the save-current-tab case); without it an
 * adapter must resolve the page itself (the re-analyze-by-URL case).
 */
export type ExtractionTarget = {
	readonly url: string;
	readonly title: string;
	readonly tabId?: number;
};

/** Page extraction, returning an already-parsed, trusted {@link ExtractedPage}. */
export interface PageExtractorPort {
	extract(
		target: ExtractionTarget,
	): Promise<ExtractionResult<ExtractedPage, ExtractionError>>;
}

/** The active tab the user wants to save. */
export type ActiveTab = {
	readonly id: number;
	readonly url: string;
	readonly title: string;
};

/** Resolves the current active tab. */
export interface TabProviderPort {
	activeTab(): Promise<Result<ActiveTab, AppError>>;
}

/** A clock, so use cases never read `Date` directly and stay deterministic. */
export interface Clock {
	now(): IsoTimestamp;
}

/** An id source for new bookmark records, injected for the same reason. */
export interface IdGenerator {
	next(): BookmarkId;
}

export type LogLevel = "info" | "warn" | "error";

/**
 * Optional structured logger. The app only ever passes already-safe messages and
 * short details; a {@link Redactor}, when supplied, scrubs the detail first.
 */
export interface Logger {
	log(level: LogLevel, event: string, detail?: string): void;
}

/** Optional redactor for log/detail text (e.g. to strip tokens defensively). */
export interface Redactor {
	redact(text: string): string;
}

/** Everything a {@link createBookmarkApp} instance needs, all injectable. */
export type AppDeps = {
	readonly repository: BookmarkRepositoryPort;
	readonly analyzer: AnalyzerPort;
	readonly extractor: PageExtractorPort;
	readonly tabs: TabProviderPort;
	readonly cache: LocalCache;
	readonly clock: Clock;
	readonly ids: IdGenerator;
	readonly logger?: Logger;
	readonly redactor?: Redactor;
};
