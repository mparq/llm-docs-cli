/**
 * Simple file-based cache for scraped pages.
 * Stores in ~/.cache/llm-docs/<url-hash>.json
 */
import { ExtractResult } from "./extract.js";
/** Get a cached result, or null if not found / expired */
export declare function cacheGet(url: string, ttlMs?: number): ExtractResult | null;
/** Store a result in cache */
export declare function cacheSet(url: string, result: ExtractResult): void;
/** Get cache stats */
export declare function cacheStats(): {
    entries: number;
    sizeKb: number;
};
/** Clear all cached entries */
export declare function cacheClear(): number;
