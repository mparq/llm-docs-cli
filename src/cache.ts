/**
 * Simple file-based cache for scraped pages.
 * Stores in ~/.cache/llm-docs/<hostname>/<url-hash>.json
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { homedir } from "os";
import { ExtractResult } from "./extract.ts";

/** Resolve cache directory: respects LLM_DOCS_CACHE_DIR, XDG_CACHE_HOME, and Windows LOCALAPPDATA */
function getCacheDir(): string {
  if (process.env.LLM_DOCS_CACHE_DIR) return process.env.LLM_DOCS_CACHE_DIR;
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, "llm-docs");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "llm-docs", "cache");
  }
  return join(homedir(), ".cache", "llm-docs");
}

const CACHE_DIR = getCacheDir();
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  url: string;
  title: string;
  markdown: string;
  links: string[];
  rawHtmlLength: number;
  cachedAt: string;
}

function urlToHostname(url: string): string {
  return new URL(url).hostname;
}

function urlToKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function cachePath(url: string): string {
  return join(CACHE_DIR, urlToHostname(url), `${urlToKey(url)}.json`);
}

/** Get a cached result, or null if not found / expired */
export function cacheGet(url: string, ttlMs = DEFAULT_TTL_MS): ExtractResult | null {
  try {
    const path = cachePath(url);
    const stat = statSync(path);
    const age = Date.now() - stat.mtimeMs;
    if (age > ttlMs) return null;

    const raw = readFileSync(path, "utf-8");
    const entry: CacheEntry = JSON.parse(raw);

    return {
      url: entry.url,
      title: entry.title,
      markdown: entry.markdown,
      links: entry.links,
      rawHtmlLength: entry.rawHtmlLength,
      elapsed: 0, // cached, no fetch time
    };
  } catch {
    return null;
  }
}

/** Store a result in cache */
export function cacheSet(url: string, result: ExtractResult): void {
  try {
    const path = cachePath(url);
    mkdirSync(join(CACHE_DIR, urlToHostname(url)), { recursive: true });
    const entry: CacheEntry = {
      url: result.url,
      title: result.title,
      markdown: result.markdown,
      links: result.links,
      rawHtmlLength: result.rawHtmlLength,
      cachedAt: new Date().toISOString(),
    };
    writeFileSync(path, JSON.stringify(entry), "utf-8");
  } catch {
    // Silently fail — cache is best-effort
  }
}

/** Get cache stats */
export function cacheStats(): { entries: number; sizeKb: number } {
  try {
    if (!existsSync(CACHE_DIR)) return { entries: 0, sizeKb: 0 };
    let totalEntries = 0;
    let totalSize = 0;
    for (const dir of readdirSync(CACHE_DIR)) {
      const dirPath = join(CACHE_DIR, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
      } catch { continue; }
      const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
      totalEntries += files.length;
      for (const f of files) {
        try {
          totalSize += statSync(join(dirPath, f)).size;
        } catch {}
      }
    }
    return { entries: totalEntries, sizeKb: Math.round(totalSize / 1024) };
  } catch {
    return { entries: 0, sizeKb: 0 };
  }
}

/** Get the cache directory path */
export function getCacheDirPath(): string {
  return CACHE_DIR;
}

/** Clear cached entries, optionally filtered by site hostname */
export function cacheClear(site?: string): number {
  try {
    if (!existsSync(CACHE_DIR)) return 0;
    if (site) {
      const siteDir = join(CACHE_DIR, site);
      if (!existsSync(siteDir)) return 0;
      const files = readdirSync(siteDir).filter((f) => f.endsWith(".json"));
      rmSync(siteDir, { recursive: true });
      return files.length;
    }
    // Clear all sites
    let cleared = 0;
    for (const dir of readdirSync(CACHE_DIR)) {
      const dirPath = join(CACHE_DIR, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
      } catch { continue; }
      cleared += readdirSync(dirPath).filter((f) => f.endsWith(".json")).length;
      rmSync(dirPath, { recursive: true });
    }
    return cleared;
  } catch {
    return 0;
  }
}
