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
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname, posix } from "path";
import { filterMarkdown } from "./filter.js";
/**
 * Convert a page URL to a relative file path within the output dir.
 * e.g. https://reactrouter.com/start/modes → start/modes.md
 *      https://reactrouter.com/api/hooks/useNavigate → api/hooks/useNavigate.md
 */
function urlToRelPath(url) {
    const u = new URL(url);
    let pathname = u.pathname;
    // Strip leading/trailing slashes
    pathname = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    // Root page
    if (!pathname)
        return "index.md";
    return pathname + ".md";
}
/**
 * Build a mapping of absolute URLs → relative file paths for link rewriting.
 */
function buildUrlMap(pages, outDir) {
    const map = new Map();
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
function rewriteLinks(markdown, currentRelPath, urlMap, hostname) {
    // Match markdown links: [text](url) and [text](url "title")
    return markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, text, href) => {
        // Split off title if present: url "title"
        const titleMatch = href.match(/^(.+?)\s+"([^"]*)"$/);
        const rawUrl = titleMatch ? titleMatch[1] : href;
        const title = titleMatch ? titleMatch[2] : null;
        // Try to resolve as absolute URL on same host
        let targetUrl = null;
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
        }
        catch {
            // Not a valid absolute URL — leave as-is
        }
        if (!targetUrl)
            return match;
        const targetPage = urlMap.get(targetUrl);
        if (!targetPage)
            return match; // Not a page we scraped — keep absolute
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
    });
}
function buildTocTree(pages) {
    const root = { name: "", children: new Map() };
    for (const page of pages) {
        // Split relPath into segments: "start/framework/routing.md" → ["start", "framework", "routing.md"]
        const parts = page.relPath.split("/");
        let node = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!node.children.has(part)) {
                node.children.set(part, { name: part, children: new Map() });
            }
            node = node.children.get(part);
            // Last segment — attach the page
            if (i === parts.length - 1) {
                node.page = page;
            }
        }
    }
    return root;
}
function renderTocTree(node, indent = 0) {
    const lines = [];
    const prefix = "  ".repeat(indent);
    // Sort: directories first, then files, both alphabetical
    const entries = Array.from(node.children.entries()).sort(([a, aNode], [b, bNode]) => {
        const aIsDir = aNode.children.size > 0 && !aNode.page;
        const bIsDir = bNode.children.size > 0 && !bNode.page;
        if (aIsDir && !bIsDir)
            return -1;
        if (!aIsDir && bIsDir)
            return 1;
        return a.localeCompare(b);
    });
    for (const [, child] of entries) {
        if (child.page) {
            const displayName = child.page.title || child.name.replace(/\.md$/, "");
            lines.push(`${prefix}- [${displayName}](${child.page.relPath})`);
        }
        else {
            // Directory node
            const dirName = child.name;
            lines.push(`${prefix}- **${dirName}/**`);
        }
        if (child.children.size > 0) {
            lines.push(...renderTocTree(child, indent + 1));
        }
    }
    return lines;
}
/**
 * Write all scraped pages as individual files with an LLMTOC.md entry point.
 * Returns total bytes written.
 */
export function writeOutput(opts) {
    const { outDir, startUrl, result, useFilter } = opts;
    const hostname = new URL(startUrl).hostname;
    // Build URL → file mapping
    const urlMap = buildUrlMap(result.pages, outDir);
    const pageFiles = Array.from(urlMap.values());
    let totalBytes = 0;
    let files = 0;
    // Write each page
    for (const page of result.pages) {
        const pf = urlMap.get(page.url);
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
    // Build and write LLMTOC.md
    const tocLines = [
        `# ${hostname} Documentation`,
        ``,
        `> Scraped from [${startUrl}](${startUrl}) — ${result.pages.length} pages, ${new Date().toISOString().split("T")[0]}`,
        ``,
        `## Pages`,
        ``,
    ];
    const tree = buildTocTree(pageFiles);
    tocLines.push(...renderTocTree(tree));
    if (result.errors.length > 0) {
        tocLines.push(``, `## Errors`, ``);
        for (const err of result.errors) {
            tocLines.push(`- ${err.url}: ${err.error}`);
        }
    }
    const tocContent = tocLines.join("\n") + "\n";
    const tocPath = join(outDir, "LLMTOC.md");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(tocPath, tocContent, "utf-8");
    totalBytes += tocContent.length;
    files++;
    return { files, totalBytes };
}
