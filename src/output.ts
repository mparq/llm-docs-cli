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
import { join, dirname, relative, posix } from "path";
import { ExtractResult } from "./extract.ts";
import { filterMarkdown } from "./filter.ts";
import { CrawlResult } from "./crawl.ts";

export interface PageFile {
  /** Absolute file path on disk */
  filePath: string;
  /** Relative path from outdir (e.g. "start/modes.md") */
  relPath: string;
  /** Original URL */
  url: string;
  /** Page title */
  title: string;
}

/**
 * Convert a page URL to a relative file path within the output dir.
 * e.g. https://reactrouter.com/start/modes → start/modes.md
 *      https://reactrouter.com/api/hooks/useNavigate → api/hooks/useNavigate.md
 */
export function urlToRelPath(url: string): string {
  const u = new URL(url);
  let pathname = u.pathname;

  // Strip leading/trailing slashes
  pathname = pathname.replace(/^\/+/, "").replace(/\/+$/, "");

  // Root page
  if (!pathname) return "index.md";

  return pathname + ".md";
}

/**
 * Build a mapping of absolute URLs → relative file paths for link rewriting.
 */
export function buildUrlMap(pages: ExtractResult[], outDir: string): Map<string, PageFile> {
  const map = new Map<string, PageFile>();

  for (const page of pages) {
    const relPath = urlToRelPath(page.url);
    map.set(page.url, {
      filePath: join(outDir, relPath),
      relPath,
      url: page.url,
      title: page.title,
    });
  }

  return map;
}

/**
 * Rewrite absolute URLs in markdown content to relative file paths.
 * Only rewrites links that point to pages we've scraped.
 */
export function rewriteLinks(
  markdown: string,
  currentRelPath: string,
  urlMap: Map<string, PageFile>,
  hostname: string
): string {
  // Match markdown links: [text](url) and [text](url "title")
  return markdown.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (match, text, href) => {
      // Split off title if present: url "title"
      const titleMatch = href.match(/^(.+?)\s+"([^"]*)"$/);
      const rawUrl = titleMatch ? titleMatch[1] : href;
      const title = titleMatch ? titleMatch[2] : null;

      // Try to resolve as absolute URL on same host
      let targetUrl: string | null = null;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.hostname === hostname) {
          // Normalize: strip hash/search, trailing slash
          parsed.hash = "";
          parsed.search = "";
          let normalized = parsed.toString();
          if (normalized.endsWith("/") && parsed.pathname !== "/") {
            normalized = normalized.slice(0, -1);
          }
          targetUrl = normalized;
        }
      } catch {
        // Not a valid absolute URL — leave as-is
      }

      if (!targetUrl) return match;

      const targetPage = urlMap.get(targetUrl);
      if (!targetPage) return match; // Not a page we scraped — keep absolute

      // Compute relative path from current file to target file
      const currentDir = posix.dirname(currentRelPath);
      let relLink = posix.relative(currentDir, targetPage.relPath);

      // Ensure it starts with ./ for same-dir or parent refs
      if (!relLink.startsWith(".")) {
        relLink = "./" + relLink;
      }

      if (title) {
        return `[${text}](${relLink} "${title}")`;
      }
      return `[${text}](${relLink})`;
    }
  );
}

export interface WriteOutputOptions {
  outDir: string;
  startUrl: string;
  result: CrawlResult;
  useFilter: boolean;
}

/**
 * Write all scraped pages as individual markdown files with relative links.
 * Returns total bytes written.
 */
export function writeOutput(opts: WriteOutputOptions): { files: number; totalBytes: number } {
  const { outDir, startUrl, result, useFilter } = opts;
  const hostname = new URL(startUrl).hostname;

  // Build URL → file mapping
  const urlMap = buildUrlMap(result.pages, outDir);
  const pageFiles = Array.from(urlMap.values());

  let totalBytes = 0;
  let files = 0;

  // Write each page
  for (const page of result.pages) {
    const pf = urlMap.get(page.url)!;

    let content = page.markdown;
    if (useFilter) {
      content = filterMarkdown(content, {
        aggressiveChrome: page.usedFallback,
      });
    }

    // Rewrite links to relative paths
    content = rewriteLinks(content, pf.relPath, urlMap, hostname);

    // Ensure directory exists
    mkdirSync(dirname(pf.filePath), { recursive: true });
    writeFileSync(pf.filePath, content, "utf-8");
    totalBytes += content.length;
    files++;
  }

  return { files, totalBytes };
}
