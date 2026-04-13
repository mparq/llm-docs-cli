/**
 * Crawler: BFS link discovery with depth control, concurrency, and deduplication.
 */

import { extractMarkdown, ExtractResult, ExtractOptions } from "./extract.ts";
import { cacheGet, cacheSet } from "./cache.ts";
import { fetchRobotsTxt, isAllowedByRobots } from "./robots.ts";

export interface CrawlOptions extends ExtractOptions {
  /** Max crawl depth (0 = single page) */
  depth?: number;
  /** Max total URLs to process */
  maxUrls?: number;
  /** Concurrent page fetches */
  concurrency?: number;
  /** Exclude URLs matching these patterns (strings or regexes) */
  exclude?: (string | RegExp)[];
  /** Only follow links matching these patterns (strings or regexes) */
  include?: (string | RegExp)[];
  /** Skip reading from cache (still writes unless noCacheWrite) */
  noCache?: boolean;
  /** Don't write results to cache */
  noCacheWrite?: boolean;
  /** Called when a page starts processing */
  onPageStart?: (url: string, current: number, total: number) => void;
  /** Called when a page completes */
  onPageComplete?: (result: ExtractResult, current: number, total: number) => void;
  /** Called when a page errors */
  onPageError?: (url: string, error: Error) => void;
  /** Called the first time a same-domain link is skipped by filtering */
  onLinkFiltered?: (url: string) => void;
  /** Ignore robots.txt rules (default: false, i.e. respect robots.txt) */
  ignoreRobots?: boolean;
}

const DEFAULT_CRAWL: Required<
  Pick<CrawlOptions, "depth" | "maxUrls" | "concurrency">
> = {
  depth: 0,
  maxUrls: 50,
  concurrency: 5,
};

/**
 * Score a URL by how much its path prefix overlaps with a reference path.
 * Higher score = longer shared prefix = closer to the starting subtree.
 * Measured in number of shared path segments.
 */
export function prefixScore(url: string, referencePath: string): number {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const refSegments = referencePath.split("/").filter(Boolean);
    let shared = 0;
    for (let i = 0; i < Math.min(segments.length, refSegments.length); i++) {
      if (segments[i] === refSegments[i]) shared++;
      else break;
    }
    return shared;
  } catch {
    return 0;
  }
}

/** Normalize a URL for dedup: strip hash, trailing slash */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

/** Check if a URL matches any exclude pattern */
export function isExcluded(url: string, exclude: (string | RegExp)[]): boolean {
  if (exclude.length === 0) return false;
  const pathname = new URL(url).pathname;
  return exclude.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(pathname);
    return pathname.startsWith(pattern);
  });
}

/** Check if a URL matches any include pattern (empty list = allow all) */
export function isIncluded(url: string, include: (string | RegExp)[]): boolean {
  if (include.length === 0) return true;
  const pathname = new URL(url).pathname;
  return include.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(pathname);
    return pathname.startsWith(pattern);
  });
}

/** Filter discovered links to only those we should crawl */
export function filterLinks(
  links: string[],
  baseUrl: string,
  seen: Set<string>,
  include: (string | RegExp)[] = [],
  exclude: (string | RegExp)[] = [],
  filteredOut?: Set<string>,
  onLinkFiltered?: (url: string) => void,
  robots?: { rules: Array<{ type: "allow" | "disallow"; pattern: string }> } | null
): string[] {
  const base = new URL(baseUrl);
  return links.filter((link) => {
    const normalized = normalizeUrl(link);
    if (seen.has(normalized)) return false;
    try {
      const u = new URL(normalized);
      // Same hostname
      if (u.hostname !== base.hostname) return false;
      // robots.txt check
      if (robots && !isAllowedByRobots(normalized, robots)) {
        if (!filteredOut?.has(normalized)) onLinkFiltered?.(normalized);
        filteredOut?.add(normalized);
        return false;
      }
      // Include patterns (if set, link must match at least one)
      if (!isIncluded(normalized, include)) {
        if (!filteredOut?.has(normalized)) onLinkFiltered?.(normalized);
        filteredOut?.add(normalized);
        return false;
      }
      // Exclude patterns
      if (isExcluded(normalized, exclude)) {
        if (!filteredOut?.has(normalized)) onLinkFiltered?.(normalized);
        filteredOut?.add(normalized);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });
}

export interface CrawlResult {
  pages: ExtractResult[];
  errors: Array<{ url: string; error: string }>;
  /** Same-domain links that were discovered but skipped by filtering */
  filteredLinks: number;
  /** Links remaining in the BFS queue when --max-urls was reached */
  remainingLinks: number;
  totalTime: number;
}

/**
 * Crawl a documentation site starting from a URL.
 */
export async function crawl(
  startUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const depth = options.depth ?? DEFAULT_CRAWL.depth;
  const maxUrls = options.maxUrls ?? DEFAULT_CRAWL.maxUrls;
  const concurrency = options.concurrency ?? DEFAULT_CRAWL.concurrency;
  const exclude = options.exclude ?? [];
  const include = options.include ?? [];

  const extractOpts: ExtractOptions = {
    waitFor: options.waitFor,
    timeout: options.timeout,
    waitForSelector: options.waitForSelector,
  };

  // Fetch robots.txt unless opted out
  const robots = options.ignoreRobots
    ? null
    : await fetchRobotsTxt(startUrl);

  const start = Date.now();
  const seen = new Set<string>();
  const filteredOut = new Set<string>();
  const pages: ExtractResult[] = [];
  const errors: Array<{ url: string; error: string }> = [];
  const capped = new Set<string>();
  const startPath = new URL(normalizeUrl(startUrl)).pathname;

  // Priority queue: URLs with more path-prefix overlap with the start URL
  // are dequeued first, so we exhaust the targeted subtree before exploring.
  type QueueItem = { url: string; depth: number; score: number };
  let queue: QueueItem[] = [{ url: normalizeUrl(startUrl), depth: 0, score: Infinity }];
  seen.add(normalizeUrl(startUrl));

  let processed = 0;
  let active = 0;

  /** Process a single queue item, discovering new links on completion */
  async function processItem(item: QueueItem): Promise<void> {
    processed++;
    const current = processed;
    const totalKnown = Math.min(current + queue.length + active - 1, maxUrls);

    options.onPageStart?.(item.url, current, totalKnown);

    try {
      // Check cache first (skip on --no-cache)
      if (!options.noCache) {
        const cached = cacheGet(item.url);
        if (cached) {
          pages.push(cached);
          options.onPageComplete?.(cached, current, totalKnown);
          enqueueLinks(cached.links, item.depth);
          return;
        }
      }

      const result = await extractMarkdown(item.url, extractOpts);

      // Store in cache (skip on --no-cache-write)
      if (!options.noCacheWrite) {
        cacheSet(item.url, result);
      }

      pages.push(result);
      options.onPageComplete?.(result, current, totalKnown);
      enqueueLinks(result.links, item.depth);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ url: item.url, error: errMsg });
      options.onPageError?.(item.url, err as Error);
    }
  }

  /** Discover and enqueue new links from a completed page */
  function enqueueLinks(links: string[], currentDepth: number): void {
    if (currentDepth >= depth) return;
    const filtered = filterLinks(links, startUrl, seen, include, exclude, filteredOut, options.onLinkFiltered, robots);
    for (const link of filtered) {
      const normalized = normalizeUrl(link);
      if (seen.size >= maxUrls) {
        capped.add(normalized);
        continue;
      }
      seen.add(normalized);
      const score = prefixScore(normalized, startPath);
      // Insert sorted by score descending so highest-priority URLs are at front
      let i = 0;
      while (i < queue.length && queue[i].score >= score) i++;
      queue.splice(i, 0, { url: normalized, depth: currentDepth + 1, score });
    }
  }

  // Semaphore-based pool: start a new task as soon as any slot frees up
  await new Promise<void>((resolve) => {
    function drain(): void {
      while (active < concurrency && queue.length > 0 && processed < maxUrls) {
        const item = queue.shift()!;
        active++;
        processItem(item).finally(() => {
          active--;
          drain();
        });
      }
      if (active === 0) resolve();
    }
    drain();
  });

  return {
    pages,
    errors,
    filteredLinks: filteredOut.size,
    remainingLinks: capped.size,
    totalTime: Date.now() - start,
  };
}
