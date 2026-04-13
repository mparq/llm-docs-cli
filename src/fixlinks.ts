/**
 * Post-processing pass: walk a directory of .md files and rewrite absolute
 * URLs to relative paths wherever a matching .md file exists on disk.
 *
 * Works across incremental runs — it doesn't care which run produced which
 * file, only what exists on the filesystem right now.
 */

import { readFileSync, writeFileSync, globSync, existsSync } from "fs";
import { basename, join, posix } from "path";
import { urlToRelPath } from "./output.ts";

/**
 * Walk outDir, rewrite absolute links to relative paths for any .md that
 * exists on disk. Returns the number of files modified.
 */
export function fixLinks(outDir: string): number {
  const hostname = basename(outDir);
  const mdFiles = globSync("**/*.md", { cwd: outDir });

  // Build set of relPaths that exist on disk for fast lookup
  const existingRelPaths = new Set(mdFiles);

  let modified = 0;

  for (const relPath of mdFiles) {
    const filePath = join(outDir, relPath);
    const original = readFileSync(filePath, "utf-8");
    let rewritten = rewriteAbsoluteLinks(original, relPath, existingRelPaths, hostname);
    rewritten = rewriteBrokenRelativeLinks(rewritten, relPath, outDir, hostname);

    if (rewritten !== original) {
      writeFileSync(filePath, rewritten, "utf-8");
      modified++;
    }
  }

  return modified;
}

/**
 * Rewrite absolute URLs in markdown content to relative file paths.
 * Only rewrites links whose target .md exists in the file set.
 */
export function rewriteAbsoluteLinks(
  markdown: string,
  currentRelPath: string,
  existingRelPaths: Set<string>,
  hostname: string
): string {
  return markdown.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (match, text, href) => {
      // Split off title if present: url "title"
      const titleMatch = href.match(/^(.+?)\s+"([^"]*)"$/);
      const rawUrl = titleMatch ? titleMatch[1] : href;
      const title = titleMatch ? titleMatch[2] : null;

      // Only rewrite absolute URLs on the same host
      let targetRelPath: string | null = null;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.hostname === hostname) {
          targetRelPath = urlToRelPath(rawUrl);
        }
      } catch {
        // Not a valid absolute URL — leave as-is
      }

      if (!targetRelPath) return match;
      if (!existingRelPaths.has(targetRelPath)) return match;

      // Compute relative path from current file to target file
      const currentDir = posix.dirname(currentRelPath);
      let relLink = posix.relative(currentDir, targetRelPath);

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

/**
 * Rewrite relative links that point to files no longer on disk back to
 * absolute URLs. This handles the case where files were deleted after a
 * previous fixLinks pass had already rewritten their URLs to relative paths.
 */
export function rewriteBrokenRelativeLinks(
  markdown: string,
  currentRelPath: string,
  outDir: string,
  hostname: string
): string {
  const currentDir = posix.dirname(currentRelPath);

  return markdown.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (match, text, href) => {
      // Split off title if present
      const titleMatch = href.match(/^(.+?)\s+"([^"]*)"$/);
      const rawHref = titleMatch ? titleMatch[1] : href;
      const title = titleMatch ? titleMatch[2] : null;

      // Skip absolute links
      if (rawHref.startsWith("http://") || rawHref.startsWith("https://")) return match;

      // Strip fragment and query from the href to get the file path
      const suffixMatch = rawHref.match(/\.md([#?].*)?$/);
      if (!suffixMatch) return match; // not a .md link
      const suffix = suffixMatch[1] ?? ""; // e.g. "#section" or "?v=2"
      const filePart = rawHref.slice(0, rawHref.length - suffix.length);

      // Resolve relative path to check if target exists
      const resolved = posix.normalize(posix.join(currentDir, filePart));
      const targetPath = join(outDir, resolved);

      if (existsSync(targetPath)) return match; // file exists, leave as-is

      // Convert relative path back to absolute URL
      let urlPath = "/" + resolved.replace(/\.md$/, "");
      // index.md → root path
      if (urlPath === "/index") {
        urlPath = "/";
      } else if (urlPath.endsWith("/index")) {
        urlPath = urlPath.slice(0, -"/index".length) + "/";
      }
      const absoluteUrl = `https://${hostname}${urlPath}${suffix}`;

      if (title) {
        return `[${text}](${absoluteUrl} "${title}")`;
      }
      return `[${text}](${absoluteUrl})`;
    }
  );
}
