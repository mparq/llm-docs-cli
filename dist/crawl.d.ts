/**
 * Crawler: BFS link discovery with depth control, concurrency, and deduplication.
 */
import { ExtractResult, ExtractOptions } from "./extract.js";
export interface CrawlOptions extends ExtractOptions {
    /** Max crawl depth (0 = single page) */
    depth?: number;
    /** Max total URLs to process */
    maxUrls?: number;
    /** Concurrent page fetches */
    concurrency?: number;
    /** Filter to only follow links matching this path prefix */
    pathPrefix?: string;
    /** Exclude URLs matching these patterns (strings or regexes) */
    exclude?: (string | RegExp)[];
    /** Skip the file cache */
    noCache?: boolean;
    /** Called when a page starts processing */
    onPageStart?: (url: string, current: number, total: number) => void;
    /** Called when a page completes */
    onPageComplete?: (result: ExtractResult, current: number, total: number) => void;
    /** Called when a page errors */
    onPageError?: (url: string, error: Error) => void;
}
export interface CrawlResult {
    pages: ExtractResult[];
    errors: Array<{
        url: string;
        error: string;
    }>;
    totalTime: number;
}
/**
 * Crawl a documentation site starting from a URL.
 */
export declare function crawl(startUrl: string, options?: CrawlOptions): Promise<CrawlResult>;
