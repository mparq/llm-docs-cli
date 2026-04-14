/**
 * Output module: writes scraped pages as a directory tree with relative links.
 *
 * Given pages from reactrouter.com/start/modes, /api/hooks/useNavigate, etc.
 * produces:
 *
 *   <outdir>/
 *     start/
 *       modes.md
 *       framework/
 *         installation.md
 *         routing.md
 *     api/
 *       hooks/
 *         useNavigate.md
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { ExtractResult } from "./extract.ts";
import { filterMarkdown } from "./filter.ts";
import { applyVendorMarkdownRules } from "./vendors.ts";
import { CrawlResult } from "./crawl.ts";

/**
 * Convert a page URL to a relative file path within the output dir.
 * e.g. https://reactrouter.com/start/modes → start/modes.md
 *      https://reactrouter.com/api/hooks/useNavigate → api/hooks/useNavigate.md
 */
export function urlToRelPath(url: string, keepQueryStrings = false): string {
  const u = new URL(url);
  let pathname = u.pathname;

  // Strip leading/trailing slashes
  pathname = pathname.replace(/^\/+/, "").replace(/\/+$/, "");

  // Root page
  if (!pathname && (!keepQueryStrings || !u.search)) return "index.md";

  // Optionally encode query string into filename so different params produce
  // different files.  Uses URL-encoding (%3F, %3D, %26) which is
  // cross-platform safe and unambiguous.
  const query = keepQueryStrings && u.search
    ? encodeURIComponent(u.search)
    : "";

  return (pathname || "index") + query + ".md";
}

export interface WriteOutputOptions {
  outDir: string;
  result: CrawlResult;
  useFilter: boolean;
  keepQueryStrings?: boolean;
}

/**
 * Write all scraped pages as individual markdown files.
 * Link rewriting is handled separately by fixLinks().
 * Returns total bytes written.
 */
export function writeOutput(opts: WriteOutputOptions): { files: number; totalBytes: number } {
  const { outDir, result, useFilter, keepQueryStrings } = opts;

  let totalBytes = 0;
  let files = 0;

  for (const page of result.pages) {
    const relPath = urlToRelPath(page.url, keepQueryStrings);
    const filePath = join(outDir, relPath);

    let content = page.markdown;
    if (useFilter) {
      content = filterMarkdown(content, {
        aggressiveChrome: true,
      });
    }
    content = applyVendorMarkdownRules(content);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    totalBytes += content.length;
    files++;
  }

  return { files, totalBytes };
}
