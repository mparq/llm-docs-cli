/**
 * Crawler: BFS link discovery with depth control, concurrency, and deduplication.
 */

import { extractMarkdown, ExtractResult, ExtractOptions } from "./extract.ts";
import { cacheGet, cacheSet } from "./cache.ts";
import { fetchRobotsTxt, isAllowedByRobots } from "./robots.ts";
import { getDefaultScope } from "./vendors.ts";

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
  /** Hard path-prefix boundary — only follow links whose path starts with this */
  scope?: string;
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

/** Normalize a URL for dedup: strip hash, keep query string, strip trailing slash */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
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
  const u = new URL(url);
  const full = u.pathname + u.search;
  return exclude.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(full);
    return full.startsWith(pattern) || full.includes(pattern);
  });
}

/** Check if a URL matches any include pattern (empty list = allow all) */
export function isIncluded(url: string, include: (string | RegExp)[]): boolean {
  if (include.length === 0) return true;
  const u = new URL(url);
  const full = u.pathname + u.search;
  return include.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(full);
    return full.startsWith(pattern) || full.includes(pattern);
  });
}

/** Check if a URL's path starts with the given scope prefix */
export function isInScope(url: string, scope: string): boolean {
  if (scope === "/") return true;
  try {
    const pathname = new URL(url).pathname;
    // Exact match or path continues with /
    return pathname === scope || pathname.startsWith(scope + "/");
  } catch {
    return false;
  }
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
  robots?: { rules: Array<{ type: "allow" | "disallow"; pattern: string }> } | null,
  scope: string = "/"
): string[] {
  const base = new URL(baseUrl);
  return links.filter((link) => {
    const normalized = normalizeUrl(link);
    if (seen.has(normalized)) return false;
    try {
      const u = new URL(normalized);
      // Same hostname
      if (u.hostname !== base.hostname) return false;
      // Scope check (hard boundary)
      if (!isInScope(normalized, scope)) {
        if (!filteredOut?.has(normalized)) onLinkFiltered?.(normalized);
        filteredOut?.add(normalized);
        return false;
      }
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

export interface QueueItem {
  url: string;
  depth: number;
  score: number;
}

export interface EnqueueContext {
  queue: QueueItem[];
  seen: Set<string>;
  capped: Set<string>;
  startUrl: string;
  startPath: string;
  maxUrls: number;
  maxDepth: number;
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
  scope: string;
  filteredOut: Set<string>;
  robots?: { rules: Array<{ type: "allow" | "disallow"; pattern: string }> } | null;
  onLinkFiltered?: (url: string) => void;
}

/**
 * Score, filter, and insert discovered links into the priority queue.
 * High-scoring links get budget priority over low-scoring ones,
 * preventing chrome/nav links from consuming maxUrls before content links.
 * Returns the updated queue.
 */
export function enqueueLinks(
  links: string[],
  currentDepth: number,
  ctx: EnqueueContext
): QueueItem[] {
  const { seen, capped, startUrl, startPath, maxUrls, maxDepth, include, exclude, scope, filteredOut, robots, onLinkFiltered } = ctx;
  let queue = ctx.queue;

  if (currentDepth >= maxDepth) return queue;

  const filtered = filterLinks(links, startUrl, seen, include, exclude, filteredOut, onLinkFiltered, robots, scope);

  // Score first, then add highest-scoring links to the queue.
  // This prevents low-priority chrome/nav links from consuming the
  // maxUrls budget before high-priority content links are even seen.
  const scored = filtered
    .map((link) => ({ url: normalizeUrl(link), score: prefixScore(normalizeUrl(link), startPath) }))
    .filter((item) => !seen.has(item.url))
    .sort((a, b) => b.score - a.score);

  for (const item of scored) {
    if (seen.size >= maxUrls) {
      capped.add(item.url);
      continue;
    }
    seen.add(item.url);
    // Insert sorted by score descending so highest-priority URLs are at front
    let i = 0;
    while (i < queue.length && queue[i].score >= item.score) i++;
    queue.splice(i, 0, { url: item.url, depth: currentDepth + 1, score: item.score });
  }

  return queue;
}

export interface CrawlResult {
  pages: ExtractResult[];
  errors: Array<{ url: string; error: string }>;
  /** Same-domain links that were discovered but skipped by filtering */
  filteredLinks: number;
  /** Links remaining in the BFS queue when --max-urls was reached */
  remainingLinks: number;
  /** The resolved scope path prefix used for this crawl */
  scope: string;
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
  const startParsed = new URL(normalizeUrl(startUrl));
  const scope = options.scope ?? getDefaultScope(startParsed.hostname, startParsed.pathname);

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
          queue = enqueueLinks(cached.links, item.depth, {
            queue, seen, capped, startUrl, startPath, maxUrls, maxDepth: depth,
            include, exclude, scope, filteredOut, robots,
            onLinkFiltered: options.onLinkFiltered,
          });
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
      queue = enqueueLinks(result.links, item.depth, {
        queue, seen, capped, startUrl, startPath, maxUrls, maxDepth: depth,
        include, exclude, scope, filteredOut, robots,
        onLinkFiltered: options.onLinkFiltered,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ url: item.url, error: errMsg });
      options.onPageError?.(item.url, err as Error);
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
    scope,
    totalTime: Date.now() - start,
  };
}
