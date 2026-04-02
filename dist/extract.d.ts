/**
 * Core markdown extractor: URL → clean markdown
 *
 * Pipeline: Playwright (JS render) → Readability (main content) → Turndown (HTML→MD)
 */
import { Browser } from "playwright";
export interface ExtractOptions {
    /** Time to wait for JS rendering (ms) */
    waitFor?: number;
    /** Max time to wait for page load (ms) */
    timeout?: number;
    /** Whether to use Readability for main content extraction */
    useReadability?: boolean;
    /** CSS selector to wait for before extracting */
    waitForSelector?: string;
}
export interface ExtractResult {
    url: string;
    title: string;
    markdown: string;
    /** Same-domain links discovered in the raw HTML (for crawling) */
    links: string[];
    /** Raw HTML length before processing */
    rawHtmlLength: number;
    /** Whether Readability failed and we used fallback selectors */
    usedFallback: boolean;
    /** Time taken in ms */
    elapsed: number;
}
export declare function getBrowser(): Promise<Browser>;
export declare function closeBrowser(): Promise<void>;
/**
 * Extract markdown from a single URL
 */
export declare function extractMarkdown(url: string, options?: ExtractOptions): Promise<ExtractResult>;
