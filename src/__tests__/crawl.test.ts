import { describe, it, expect } from "vitest";
import { normalizeUrl, isExcluded, isIncluded, filterLinks, prefixScore, enqueueLinks, type QueueItem, type EnqueueContext } from "../crawl.ts";

describe("normalizeUrl", () => {
  it("should strip hash fragments", () => {
    expect(normalizeUrl("https://example.com/docs/intro#section")).toBe(
      "https://example.com/docs/intro"
    );
  });

  it("should preserve query strings", () => {
    expect(normalizeUrl("https://example.com/docs?page=1")).toBe(
      "https://example.com/docs?page=1"
    );
  });

  it("should strip trailing slashes", () => {
    expect(normalizeUrl("https://example.com/docs/intro/")).toBe(
      "https://example.com/docs/intro"
    );
  });

  it("should preserve root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("should strip hash but preserve query string", () => {
    expect(normalizeUrl("https://example.com/docs?q=test#heading")).toBe(
      "https://example.com/docs?q=test"
    );
  });

  it("should return invalid URLs as-is", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("prefixScore", () => {
  it("should return shared segment count", () => {
    expect(prefixScore("https://example.com/docs/api/hooks", "/docs/api")).toBe(2);
  });

  it("should return 0 for no overlap", () => {
    expect(prefixScore("https://example.com/blog/post", "/docs/api")).toBe(0);
  });

  it("should handle exact match", () => {
    expect(prefixScore("https://example.com/docs/api", "/docs/api")).toBe(2);
  });

  it("should handle deeper URLs", () => {
    expect(prefixScore("https://example.com/docs/api/admin/mutations/productCreate", "/docs/api")).toBe(2);
  });

  it("should return 0 for root path", () => {
    expect(prefixScore("https://example.com/blog", "/")).toBe(0);
  });
});

describe("isExcluded", () => {
  it("should return false for empty exclude list", () => {
    expect(isExcluded("https://example.com/docs/intro", [])).toBe(false);
  });

  it("should match string prefixes", () => {
    expect(isExcluded("https://example.com/api/internal/secret", ["/api/internal"])).toBe(true);
  });

  it("should not match non-matching prefixes", () => {
    expect(isExcluded("https://example.com/docs/intro", ["/api"])).toBe(false);
  });

  it("should match regex patterns", () => {
    expect(
      isExcluded("https://example.com/7.13.2/docs/intro", [/^\/\d+\.\d+\.\d+/])
    ).toBe(true);
  });

  it("should not match non-matching regex", () => {
    expect(
      isExcluded("https://example.com/docs/intro", [/^\/\d+\.\d+\.\d+/])
    ).toBe(false);
  });

  it("should match if any pattern matches", () => {
    expect(
      isExcluded("https://example.com/dev/preview", ["/api", "/dev"])
    ).toBe(true);
  });

  it("should support mixed string and regex patterns", () => {
    const patterns: (string | RegExp)[] = ["/changelog", /^\/\d+\.\d+/];
    expect(isExcluded("https://example.com/changelog", patterns)).toBe(true);
    expect(isExcluded("https://example.com/2.0/docs", patterns)).toBe(true);
    expect(isExcluded("https://example.com/docs/intro", patterns)).toBe(false);
  });

  it("should match query string substrings", () => {
    expect(isExcluded("https://example.com/docs?view=v7", ["view=v7"])).toBe(true);
    expect(isExcluded("https://example.com/docs?view=v8", ["view=v7"])).toBe(false);
  });
});

describe("isIncluded", () => {
  it("should return true for empty include list", () => {
    expect(isIncluded("https://example.com/docs/intro", [])).toBe(true);
  });

  it("should match string prefixes", () => {
    expect(isIncluded("https://example.com/docs/api/hooks", ["/docs/api"])).toBe(true);
  });

  it("should reject non-matching prefixes", () => {
    expect(isIncluded("https://example.com/blog/post", ["/docs/api"])).toBe(false);
  });

  it("should match regex patterns", () => {
    expect(
      isIncluded("https://example.com/mutations/productCreate", [/\/mutations\/(product|order)/])
    ).toBe(true);
  });

  it("should reject non-matching regex", () => {
    expect(
      isIncluded("https://example.com/queries/shopInfo", [/\/mutations\/(product|order)/])
    ).toBe(false);
  });

  it("should match if any pattern matches", () => {
    expect(
      isIncluded("https://example.com/docs/api/hooks", ["/docs/api", "/docs/guides"])
    ).toBe(true);
  });

  it("should support mixed string and regex patterns", () => {
    const patterns: (string | RegExp)[] = ["/docs/api", /\/mutations\/(product|order)/];
    expect(isIncluded("https://example.com/docs/api/hooks", patterns)).toBe(true);
    expect(isIncluded("https://example.com/mutations/productCreate", patterns)).toBe(true);
    expect(isIncluded("https://example.com/blog/post", patterns)).toBe(false);
  });

  it("should match query string substrings", () => {
    expect(isIncluded("https://example.com/docs?view=aspnetcore-8.0", ["aspnetcore-8.0"])).toBe(true);
    expect(isIncluded("https://example.com/docs?view=aspnetcore-9.0", ["aspnetcore-8.0"])).toBe(false);
  });
});

describe("filterLinks", () => {
  const baseUrl = "https://example.com/docs";

  it("should keep same-domain links", () => {
    const links = ["https://example.com/docs/intro", "https://example.com/api/hooks"];
    const result = filterLinks(links, baseUrl, new Set());
    expect(result).toEqual(links);
  });

  it("should reject cross-domain links", () => {
    const links = ["https://other.com/docs/intro"];
    const result = filterLinks(links, baseUrl, new Set());
    expect(result).toEqual([]);
  });

  it("should reject already-seen URLs", () => {
    const links = ["https://example.com/docs/intro"];
    const seen = new Set(["https://example.com/docs/intro"]);
    const result = filterLinks(links, baseUrl, seen);
    expect(result).toEqual([]);
  });

  it("should filter by include prefix", () => {
    const links = [
      "https://example.com/docs/intro",
      "https://example.com/blog/post",
    ];
    const result = filterLinks(links, baseUrl, new Set(), ["/docs"]);
    expect(result).toEqual(["https://example.com/docs/intro"]);
  });

  it("should apply exclude patterns", () => {
    const links = [
      "https://example.com/docs/intro",
      "https://example.com/docs/changelog",
    ];
    const result = filterLinks(links, baseUrl, new Set(), [], ["/docs/changelog"]);
    expect(result).toEqual(["https://example.com/docs/intro"]);
  });

  it("should handle all filters together", () => {
    const links = [
      "https://example.com/docs/intro",       // keep
      "https://example.com/docs/changelog",    // excluded
      "https://example.com/blog/post",         // not included
      "https://other.com/docs/page",           // wrong domain
    ];
    const seen = new Set<string>();
    const result = filterLinks(links, baseUrl, seen, ["/docs"], ["/docs/changelog"]);
    expect(result).toEqual(["https://example.com/docs/intro"]);
  });

  it("should reject links already in the seen set (normalized)", () => {
    const links = [
      "https://example.com/docs/intro",
      "https://example.com/docs/intro/",      // normalizes to same
      "https://example.com/docs/intro#section", // normalizes to same
    ];
    // Pre-populate seen with the normalized form
    const seen = new Set(["https://example.com/docs/intro"]);
    const result = filterLinks(links, baseUrl, seen);
    // All three normalize to the seen URL
    expect(result).toHaveLength(0);
  });

  it("does not self-deduplicate within a batch (caller responsibility)", () => {
    const links = [
      "https://example.com/docs/intro",
      "https://example.com/docs/intro/",
    ];
    const seen = new Set<string>();
    const result = filterLinks(links, baseUrl, seen);
    // filterLinks doesn't mutate seen or track within the batch
    // the crawl() function handles dedup after filterLinks returns
    expect(result).toHaveLength(2);
  });

  it("should filter by include patterns", () => {
    const links = [
      "https://example.com/docs/api/hooks",
      "https://example.com/docs/api/components",
      "https://example.com/docs/guides/intro",
    ];
    const result = filterLinks(links, baseUrl, new Set(), ["/docs/api"]);
    expect(result).toEqual([
      "https://example.com/docs/api/hooks",
      "https://example.com/docs/api/components",
    ]);
  });

  it("should apply include with regex", () => {
    const links = [
      "https://example.com/mutations/productCreate",
      "https://example.com/mutations/orderCreate",
      "https://example.com/mutations/customerDelete",
      "https://example.com/queries/shop",
    ];
    const result = filterLinks(links, baseUrl, new Set(), [/\/mutations\/(product|order)/]);
    expect(result).toEqual([
      "https://example.com/mutations/productCreate",
      "https://example.com/mutations/orderCreate",
    ]);
  });

  it("should apply include and exclude together", () => {
    const links = [
      "https://example.com/docs/api/hooks",
      "https://example.com/docs/api/deprecated",
      "https://example.com/docs/guides/intro",
    ];
    const result = filterLinks(links, baseUrl, new Set(), ["/docs/api"], ["/docs/api/deprecated"]);
    expect(result).toEqual(["https://example.com/docs/api/hooks"]);
  });

  it("should apply include and exclude together with prefix patterns", () => {
    const links = [
      "https://example.com/docs/api/hooks",       // keep: included, not excluded
      "https://example.com/docs/api/deprecated",   // excluded
      "https://example.com/docs/guides/intro",     // not included
      "https://example.com/blog/post",             // not included
    ];
    const result = filterLinks(links, baseUrl, new Set(), ["/docs/api"], ["/docs/api/deprecated"]);
    expect(result).toEqual(["https://example.com/docs/api/hooks"]);
  });
});

describe("enqueueLinks", () => {
  function makeCtx(overrides: Partial<EnqueueContext> = {}): EnqueueContext {
    return {
      queue: [],
      seen: new Set(["https://example.com/docs/mvc/overview"]),
      capped: new Set(),
      startUrl: "https://example.com/docs/mvc/overview",
      startPath: "/docs/mvc/overview",
      maxUrls: 200,
      maxDepth: 3,
      include: [],
      exclude: [],
      filteredOut: new Set(),
      ...overrides,
    };
  }

  it("should enqueue high-scoring links before low-scoring ones", () => {
    // Simulates a page with chrome/nav links (low prefix overlap)
    // appearing before content links (high prefix overlap) in DOM order
    const links = [
      "https://example.com/about",              // score 0
      "https://example.com/users/me",           // score 0
      "https://example.com/settings",           // score 0
      "https://example.com/docs/mvc/controllers", // score 3
      "https://example.com/docs/mvc/views",       // score 3
      "https://example.com/docs/intro",           // score 1
    ];

    const ctx = makeCtx();
    const queue = enqueueLinks(links, 0, ctx);

    expect(queue.map((q) => q.url)).toEqual([
      "https://example.com/docs/mvc/controllers",
      "https://example.com/docs/mvc/views",
      "https://example.com/docs/intro",
      "https://example.com/about",
      "https://example.com/users/me",
      "https://example.com/settings",
    ]);
  });

  it("should give budget priority to high-scoring links when maxUrls is tight", () => {
    // Regression test: with a small maxUrls budget, chrome links in DOM order
    // should not consume slots before high-scoring content links.
    const links = [
      "https://example.com/junk/a",              // score 0
      "https://example.com/junk/b",              // score 0
      "https://example.com/junk/c",              // score 0
      "https://example.com/docs/mvc/controllers", // score 3
      "https://example.com/docs/mvc/views",       // score 3
    ];

    // seen already has the seed URL, maxUrls=4 means only 3 slots left
    const ctx = makeCtx({ maxUrls: 4 });
    enqueueLinks(links, 0, ctx);

    // Both high-scoring links should be in seen (enqueued),
    // junk links should be capped
    expect(ctx.seen.has("https://example.com/docs/mvc/controllers")).toBe(true);
    expect(ctx.seen.has("https://example.com/docs/mvc/views")).toBe(true);
    expect(ctx.capped.size).toBeGreaterThan(0);
  });

  it("should respect maxDepth and not enqueue at depth limit", () => {
    const links = ["https://example.com/docs/mvc/controllers"];
    const ctx = makeCtx({ maxDepth: 2 });
    const queue = enqueueLinks(links, 2, ctx);
    expect(queue).toHaveLength(0);
  });

  it("should preserve query strings as distinct URLs", () => {
    const links = [
      "https://example.com/docs/mvc/overview?view=v8",
      "https://example.com/docs/mvc/overview?view=v9",
    ];
    const ctx = makeCtx();
    enqueueLinks(links, 0, ctx);

    expect(ctx.seen.has("https://example.com/docs/mvc/overview?view=v8")).toBe(true);
    expect(ctx.seen.has("https://example.com/docs/mvc/overview?view=v9")).toBe(true);
  });

  it("should apply include filter to query strings", () => {
    const links = [
      "https://example.com/docs/mvc/controllers?view=v8",
      "https://example.com/docs/mvc/views?view=v9",
      "https://example.com/docs/mvc/models?view=v8",
    ];
    const ctx = makeCtx({ include: ["view=v8"] });
    const queue = enqueueLinks(links, 0, ctx);

    const urls = queue.map((q) => q.url);
    expect(urls).toContain("https://example.com/docs/mvc/controllers?view=v8");
    expect(urls).toContain("https://example.com/docs/mvc/models?view=v8");
    expect(urls).not.toContain("https://example.com/docs/mvc/views?view=v9");
  });
});
