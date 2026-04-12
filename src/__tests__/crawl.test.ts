import { describe, it, expect } from "vitest";
import { normalizeUrl, isExcluded, isIncluded, filterLinks } from "../crawl.ts";

describe("normalizeUrl", () => {
  it("should strip hash fragments", () => {
    expect(normalizeUrl("https://example.com/docs/intro#section")).toBe(
      "https://example.com/docs/intro"
    );
  });

  it("should strip query strings", () => {
    expect(normalizeUrl("https://example.com/docs?page=1")).toBe(
      "https://example.com/docs"
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

  it("should handle URLs with both hash and query", () => {
    expect(normalizeUrl("https://example.com/docs?q=test#heading")).toBe(
      "https://example.com/docs"
    );
  });

  it("should return invalid URLs as-is", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
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
});

describe("filterLinks", () => {
  const baseUrl = "https://example.com/docs";

  it("should keep same-domain links", () => {
    const links = ["https://example.com/docs/intro", "https://example.com/api/hooks"];
    const result = filterLinks(links, baseUrl, "", [], new Set());
    expect(result).toEqual(links);
  });

  it("should reject cross-domain links", () => {
    const links = ["https://other.com/docs/intro"];
    const result = filterLinks(links, baseUrl, "", [], new Set());
    expect(result).toEqual([]);
  });

  it("should reject already-seen URLs", () => {
    const links = ["https://example.com/docs/intro"];
    const seen = new Set(["https://example.com/docs/intro"]);
    const result = filterLinks(links, baseUrl, "", [], seen);
    expect(result).toEqual([]);
  });

  it("should filter by path prefix", () => {
    const links = [
      "https://example.com/docs/intro",
      "https://example.com/blog/post",
    ];
    const result = filterLinks(links, baseUrl, "/docs", [], new Set());
    expect(result).toEqual(["https://example.com/docs/intro"]);
  });

  it("should apply exclude patterns", () => {
    const links = [
      "https://example.com/docs/intro",
      "https://example.com/docs/changelog",
    ];
    const result = filterLinks(links, baseUrl, "", ["/docs/changelog"], new Set());
    expect(result).toEqual(["https://example.com/docs/intro"]);
  });

  it("should handle all filters together", () => {
    const links = [
      "https://example.com/docs/intro",       // keep
      "https://example.com/docs/changelog",    // excluded
      "https://example.com/blog/post",         // wrong prefix
      "https://other.com/docs/page",           // wrong domain
    ];
    const seen = new Set<string>();
    const result = filterLinks(links, baseUrl, "/docs", ["/docs/changelog"], seen);
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
    const result = filterLinks(links, baseUrl, "", [], seen);
    // All three normalize to the seen URL
    expect(result).toHaveLength(0);
  });

  it("does not self-deduplicate within a batch (caller responsibility)", () => {
    const links = [
      "https://example.com/docs/intro",
      "https://example.com/docs/intro/",
    ];
    const seen = new Set<string>();
    const result = filterLinks(links, baseUrl, "", [], seen);
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
    const result = filterLinks(links, baseUrl, "", [], new Set(), ["/docs/api"]);
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
    const result = filterLinks(links, baseUrl, "", [], new Set(), [/\/mutations\/(product|order)/]);
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
    const result = filterLinks(links, baseUrl, "", ["/docs/api/deprecated"], new Set(), ["/docs/api"]);
    expect(result).toEqual(["https://example.com/docs/api/hooks"]);
  });

  it("should apply pathPrefix, include, and exclude together", () => {
    const links = [
      "https://example.com/docs/api/hooks",       // keep: matches all
      "https://example.com/docs/api/deprecated",   // excluded
      "https://example.com/docs/guides/intro",     // not included
      "https://example.com/blog/post",             // wrong prefix
    ];
    const result = filterLinks(links, baseUrl, "/docs", ["/docs/api/deprecated"], new Set(), ["/docs/api"]);
    expect(result).toEqual(["https://example.com/docs/api/hooks"]);
  });
});
