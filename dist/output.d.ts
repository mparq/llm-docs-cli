/**
 * Output module: writes scraped pages as a directory tree with relative links.
 *
 * Given pages from reactrouter.com/start/modes, /api/hooks/useNavigate, etc.
 * produces:
 *
 *   <outdir>/
 *     LLMTOC.md
 *     start/
 *       modes.md
 *       framework/
 *         installation.md
 *         routing.md
 *     api/
 *       hooks/
 *         useNavigate.md
 */
import { CrawlResult } from "./crawl.js";
export interface WriteOutputOptions {
    outDir: string;
    startUrl: string;
    result: CrawlResult;
    useFilter: boolean;
}
/**
 * Write all scraped pages as individual files with an LLMTOC.md entry point.
 * Returns total bytes written.
 */
export declare function writeOutput(opts: WriteOutputOptions): {
    files: number;
    totalBytes: number;
};
