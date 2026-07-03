/**
 * `app/*` boundary — application use cases.
 *
 * The orchestration layer that sits between the popup/options UI and the domain
 * modules. It depends only on injectable ports (Drive repository, AI analyzer,
 * page extractor, tab provider, local cache, clock, id generator, optional
 * logger/redactor), so every flow — load cached state, sync from Drive, save the
 * current tab, delete, re-analyze — is testable without Chrome, Drive, the
 * Prompt API, or real page extraction. It contains no Drive API, Prompt API,
 * JSONL/merge, or extraction logic of its own (docs/implementation-principles.md
 * "Module boundary rules"; AGENTS.md "Architecture boundaries").
 *
 * Surface:
 *   - {@link createBookmarkApp} + {@link BookmarkApp} — the use cases. AI
 *     analysis runs in the initiating UI's foreground flow; save/re-analyze
 *     resolves only after analysis and the final Drive push settle (MIK-021).
 *   - {@link createSettingsApp} + {@link SettingsApp} — the custom-skill CRUD
 *     use cases the options page drives (MIK-018).
 *   - Ports and their value types, for wiring real or fake dependencies.
 *   - {@link AppError} — the single, UI-safe error taxonomy callers handle.
 *   - Chrome-free default adapters ({@link createAnalyzerPort},
 *     {@link createSystemClock}, {@link createCryptoIdGenerator},
 *     {@link createCryptoSkillIdGenerator}, {@link createSettingsProviderPort}).
 */
export type { Result, Ok, Err } from "./result";
export { ok, err } from "./result";

export type { AppError, AppErrorKind } from "./errors";
export {
	appError,
	fromRepositoryError,
	fromExtractionError,
	fromCollectionError,
	fromSkillError,
	toSyncError,
} from "./errors";

export type {
	AppDeps,
	BookmarkRepositoryPort,
	AnalyzerPort,
	SettingsProviderPort,
	PageExtractorPort,
	ExtractionTarget,
	TabProviderPort,
	ActiveTab,
	SaveStage,
	SaveProgress,
	Clock,
	IdGenerator,
	Logger,
	LogLevel,
	Redactor,
} from "./ports";

export type { BookmarkApp, SaveOutcome } from "./bookmark-app";
export { createBookmarkApp } from "./bookmark-app";

export type {
	SettingsApp,
	SettingsAppDeps,
	SettingsRepositoryPort,
	SkillIdGenerator,
} from "./settings-app";
export { createSettingsApp } from "./settings-app";

export {
	createAnalyzerPort,
	createSettingsProviderPort,
	createSystemClock,
	createCryptoIdGenerator,
	createCryptoSkillIdGenerator,
} from "./adapters";
