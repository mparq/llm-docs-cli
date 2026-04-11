/**
 * Post-processing pass: walk a directory of .md files and rewrite absolute
 * URLs to relative paths wherever a matching .md file exists on disk.
 *
 * Works across incremental runs — it doesn't care which run produced which
 * file, only what exists on the filesystem right now.
 */

import { readFileSync, writeFileSync, globSync } from "fs";
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
    const rewritten = rewriteAbsoluteLinks(original, relPath, existingRelPaths, hostname);

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
