/**
 * `i18n/*` boundary (MIK-029).
 *
 * Owns the shared English/Japanese language contract: UI-language resolution
 * and the deterministic page-output-language inference. Pure and
 * dependency-free (the one browser read, {@link detectUiLanguage}, is
 * defensive and injectable via {@link resolveUiLanguage}); UI string
 * dictionaries live with their UI (`popup/i18n.ts`, `options/i18n.ts`).
 */
export type { SupportedLanguage } from "./language";
export {
	DEFAULT_LANGUAGE,
	detectUiLanguage,
	inferOutputLanguage,
	normalizeLanguageTag,
	resolveUiLanguage,
} from "./language";
