/**
 * The narrow set of domain types the options view layer is allowed to read.
 *
 * Re-exporting them here (rather than importing across components from each
 * domain module) keeps a single, auditable list of what the Research Ledger UI
 * touches: read-only record/status/collection shapes, never a Drive client, the
 * Prompt API client, the JSONL parser, or merge internals (AGENTS.md
 * "Architecture boundaries").
 */
export type {
	AiStatus,
	BookmarkRecord,
} from "../lib/bookmarks/index";
export type { SyncStatus } from "../lib/storage/index";
