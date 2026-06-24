/**
 * The narrow set of domain types the popup view layer is allowed to read.
 *
 * Re-exporting them here (rather than importing across the codebase from each
 * component) keeps a single, auditable list of what the receipt UI touches:
 * read-only record/status shapes, never a Drive client, the Prompt API client,
 * the JSONL parser, or merge internals (AGENTS.md "Architecture boundaries").
 */
export type {
	AiStatus,
	BookmarkRecord,
} from "../lib/bookmarks/index";
export type { SyncStatus } from "../lib/storage/index";
