/**
 * Content filters for cleaning markdown output.
 * Ported from llm-codes, keeping only general-purpose filters.
 */
export interface FilterOptions {
    navigation?: boolean;
    legalBoilerplate?: boolean;
    emptySections?: boolean;
    formattingArtifacts?: boolean;
    deduplicate?: boolean;
    /** Enable aggressive chrome stripping (for Readability fallback pages) */
    aggressiveChrome?: boolean;
}
/** Apply all content filters to markdown */
export declare function filterMarkdown(content: string, options?: FilterOptions): string;
