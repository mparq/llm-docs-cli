/**
 * Simple file-based cache for scraped pages.
 * Stores in ~/.cache/llm-docs/<url-hash>.json
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { homedir } from "os";
import { ExtractResult } from "./extract.js";

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
  usedFallback?: boolean;
  cachedAt: string;
}

function ensureCacheDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

function urlToKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function cachePath(url: string): string {
  return join(CACHE_DIR, `${urlToKey(url)}.json`);
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
      usedFallback: entry.usedFallback ?? false,
      elapsed: 0, // cached, no fetch time
    };
  } catch {
    return null;
  }
}

/** Store a result in cache */
export function cacheSet(url: string, result: ExtractResult): void {
  try {
    ensureCacheDir();
    const entry: CacheEntry = {
      url: result.url,
      title: result.title,
      markdown: result.markdown,
      links: result.links,
      rawHtmlLength: result.rawHtmlLength,
      usedFallback: result.usedFallback,
      cachedAt: new Date().toISOString(),
    };
    writeFileSync(cachePath(url), JSON.stringify(entry), "utf-8");
  } catch {
    // Silently fail — cache is best-effort
  }
}

/** Get cache stats */
export function cacheStats(): { entries: number; sizeKb: number } {
  try {
    ensureCacheDir();
    const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
    let totalSize = 0;
    for (const f of files) {
      try {
        totalSize += statSync(join(CACHE_DIR, f)).size;
      } catch {}
    }
    return { entries: files.length, sizeKb: Math.round(totalSize / 1024) };
  } catch {
    return { entries: 0, sizeKb: 0 };
  }
}

/** Get the cache directory path (for display purposes) */
export function getCacheDir_display(): string {
  return CACHE_DIR;
}

/** Clear all cached entries */
export function cacheClear(): number {
  try {
    ensureCacheDir();
    const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        rmSync(join(CACHE_DIR, f));
      } catch {}
    }
    return files.length;
  } catch {
    return 0;
  }
}
