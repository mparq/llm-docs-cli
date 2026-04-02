/**
 * Simple file-based cache for scraped pages.
 * Stores in ~/.cache/llm-docs/<url-hash>.json
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { homedir } from "os";
const CACHE_DIR = join(homedir(), ".cache", "llm-docs");
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
function ensureCacheDir() {
    mkdirSync(CACHE_DIR, { recursive: true });
}
function urlToKey(url) {
    return createHash("sha256").update(url).digest("hex").slice(0, 16);
}
function cachePath(url) {
    return join(CACHE_DIR, `${urlToKey(url)}.json`);
}
/** Get a cached result, or null if not found / expired */
export function cacheGet(url, ttlMs = DEFAULT_TTL_MS) {
    try {
        const path = cachePath(url);
        const stat = statSync(path);
        const age = Date.now() - stat.mtimeMs;
        if (age > ttlMs)
            return null;
        const raw = readFileSync(path, "utf-8");
        const entry = JSON.parse(raw);
        return {
            url: entry.url,
            title: entry.title,
            markdown: entry.markdown,
            links: entry.links,
            rawHtmlLength: entry.rawHtmlLength,
            usedFallback: entry.usedFallback ?? false,
            elapsed: 0, // cached, no fetch time
        };
    }
    catch {
        return null;
    }
}
/** Store a result in cache */
export function cacheSet(url, result) {
    try {
        ensureCacheDir();
        const entry = {
            url: result.url,
            title: result.title,
            markdown: result.markdown,
            links: result.links,
            rawHtmlLength: result.rawHtmlLength,
            usedFallback: result.usedFallback,
            cachedAt: new Date().toISOString(),
        };
        writeFileSync(cachePath(url), JSON.stringify(entry), "utf-8");
    }
    catch {
        // Silently fail — cache is best-effort
    }
}
/** Get cache stats */
export function cacheStats() {
    try {
        ensureCacheDir();
        const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
        let totalSize = 0;
        for (const f of files) {
            try {
                totalSize += statSync(join(CACHE_DIR, f)).size;
            }
            catch { }
        }
        return { entries: files.length, sizeKb: Math.round(totalSize / 1024) };
    }
    catch {
        return { entries: 0, sizeKb: 0 };
    }
}
/** Clear all cached entries */
export function cacheClear() {
    try {
        ensureCacheDir();
        const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
        for (const f of files) {
            try {
                rmSync(join(CACHE_DIR, f));
            }
            catch { }
        }
        return files.length;
    }
    catch {
        return 0;
    }
}
