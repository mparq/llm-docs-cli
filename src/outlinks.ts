/**
 * Scan an output directory for outbound links — same-domain URLs referenced
 * in the markdown that don't have a corresponding local file. These represent
 * pages the crawl discovered but didn't fetch.
 */

import { readFileSync, globSync } from "fs";
import { basename, join } from "path";
import { urlToRelPath } from "./output.ts";

export interface OutLink {
  url: string;
  /** Number of files that reference this URL */
  references: number;
}

/**
 * Return same-domain URLs that appear in markdown links but have no local
 * .md file, sorted by reference count descending.
 */
export function outlinks(outDir: string, keepQueryStrings = false, hostname?: string): OutLink[] {
  hostname = hostname ?? basename(outDir);
  const mdFiles = globSync("**/*.md", { cwd: outDir });
  const existingRelPaths = new Set(mdFiles);

  // url → set of files that reference it
  const counts = new Map<string, Set<string>>();

  for (const relPath of mdFiles) {
    const filePath = join(outDir, relPath);
    const content = readFileSync(filePath, "utf-8");

    // Match markdown links
    const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(content)) !== null) {
      const href = m[2].replace(/\s+"[^"]*"$/, ""); // strip title
      try {
        const parsed = new URL(href);
        if (parsed.hostname !== hostname) continue;
        const targetRelPath = urlToRelPath(href, keepQueryStrings);
        if (existingRelPaths.has(targetRelPath)) continue;
        // Same domain, no local file
        const normalized = parsed.origin + parsed.pathname;
        if (!counts.has(normalized)) counts.set(normalized, new Set());
        counts.get(normalized)!.add(relPath);
      } catch {
        // Not an absolute URL
      }
    }
  }

  return [...counts.entries()]
    .map(([url, refs]) => ({ url, references: refs.size }))
    .sort((a, b) => b.references - a.references);
}

/**
 * Group outlinks by truncating URL paths to `level` segments.
 * e.g. level=2 turns https://shopify.dev/docs/api/admin-graphql into
 * https://shopify.dev/docs/api with an aggregated count.
 */
export function groupOutlinks(links: OutLink[], level: number): OutLink[] {
  const groups = new Map<string, number>();

  for (const { url, references } of links) {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const truncated = "/" + segments.slice(0, level).join("/");
    const key = parsed.origin + truncated;
    groups.set(key, (groups.get(key) ?? 0) + references);
  }

  return [...groups.entries()]
    .map(([url, references]) => ({ url, references }))
    .sort((a, b) => b.references - a.references);
}
