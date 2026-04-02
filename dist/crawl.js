/**
 * Crawler: BFS link discovery with depth control, concurrency, and deduplication.
 */
import { extractMarkdown } from "./extract.js";
import { cacheGet, cacheSet } from "./cache.js";
const DEFAULT_CRAWL = {
    depth: 0,
    maxUrls: 50,
    concurrency: 5,
    pathPrefix: "",
};
/** Normalize a URL for dedup: strip hash, trailing slash */
function normalizeUrl(url) {
    try {
        const u = new URL(url);
        u.hash = "";
        u.search = "";
        let s = u.toString();
        if (s.endsWith("/") && u.pathname !== "/")
            s = s.slice(0, -1);
        return s;
    }
    catch {
        return url;
    }
}
/** Check if a URL matches any exclude pattern */
function isExcluded(url, exclude) {
    if (exclude.length === 0)
        return false;
    const pathname = new URL(url).pathname;
    return exclude.some((pattern) => {
        if (pattern instanceof RegExp)
            return pattern.test(pathname);
        return pathname.startsWith(pattern);
    });
}
/** Filter discovered links to only those we should crawl */
function filterLinks(links, baseUrl, pathPrefix, exclude, seen) {
    const base = new URL(baseUrl);
    return links.filter((link) => {
        const normalized = normalizeUrl(link);
        if (seen.has(normalized))
            return false;
        try {
            const u = new URL(normalized);
            // Same hostname
            if (u.hostname !== base.hostname)
                return false;
            // Path prefix filter
            if (pathPrefix && !u.pathname.startsWith(pathPrefix))
                return false;
            // Exclude patterns
            if (isExcluded(normalized, exclude))
                return false;
            return true;
        }
        catch {
            return false;
        }
    });
}
/**
 * Crawl a documentation site starting from a URL.
 */
export async function crawl(startUrl, options = {}) {
    const depth = options.depth ?? DEFAULT_CRAWL.depth;
    const maxUrls = options.maxUrls ?? DEFAULT_CRAWL.maxUrls;
    const concurrency = options.concurrency ?? DEFAULT_CRAWL.concurrency;
    const pathPrefix = options.pathPrefix ?? DEFAULT_CRAWL.pathPrefix;
    const exclude = options.exclude ?? [];
    const extractOpts = {
        waitFor: options.waitFor,
        timeout: options.timeout,
        useReadability: options.useReadability,
        waitForSelector: options.waitForSelector,
    };
    const start = Date.now();
    const seen = new Set();
    const pages = [];
    const errors = [];
    let queue = [{ url: normalizeUrl(startUrl), depth: 0 }];
    seen.add(normalizeUrl(startUrl));
    let processed = 0;
    while (queue.length > 0 && processed < maxUrls) {
        // Take a batch up to concurrency limit
        const batchSize = Math.min(concurrency, maxUrls - processed, queue.length);
        const batch = queue.splice(0, batchSize);
        const totalKnown = processed + batch.length + queue.length;
        // Process batch concurrently
        const results = await Promise.allSettled(batch.map(async (item) => {
            processed++;
            options.onPageStart?.(item.url, processed, Math.min(totalKnown, maxUrls));
            // Check cache first
            if (!options.noCache) {
                const cached = cacheGet(item.url);
                if (cached) {
                    options.onPageComplete?.(cached, processed, Math.min(totalKnown, maxUrls));
                    return { result: cached, depth: item.depth, cached: true };
                }
            }
            const result = await extractMarkdown(item.url, extractOpts);
            // Store in cache
            if (!options.noCache) {
                cacheSet(item.url, result);
            }
            options.onPageComplete?.(result, processed, Math.min(totalKnown, maxUrls));
            return { result, depth: item.depth, cached: false };
        }));
        // Collect results and discover new links
        const newLinks = [];
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "fulfilled") {
                pages.push(r.value.result);
                // Discover links if we haven't hit max depth
                if (r.value.depth < depth) {
                    const filtered = filterLinks(r.value.result.links, startUrl, pathPrefix, exclude, seen);
                    for (const link of filtered) {
                        if (seen.size >= maxUrls)
                            break;
                        const normalized = normalizeUrl(link);
                        seen.add(normalized);
                        newLinks.push({ url: normalized, depth: r.value.depth + 1 });
                    }
                }
            }
            else {
                const url = batch[i].url;
                const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                errors.push({ url, error: errMsg });
                options.onPageError?.(url, r.reason);
            }
        }
        // Add discovered links to the queue
        queue.push(...newLinks);
    }
    return {
        pages,
        errors,
        totalTime: Date.now() - start,
    };
}
