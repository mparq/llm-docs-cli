import { describe, it, expect } from "vitest";
import {
  urlToRelPath,
  buildUrlMap,
  rewriteLinks,
} from "../output.ts";
import { ExtractResult } from "../extract.ts";

function makePage(url: string, title: string = "Test"): ExtractResult {
  return {
    url,
    title,
    markdown: "",
    links: [],
    rawHtmlLength: 0,
    usedFallback: false,
    elapsed: 0,
  };
}

describe("urlToRelPath", () => {
  it("should convert a simple path", () => {
    expect(urlToRelPath("https://example.com/docs/getting-started")).toBe(
      "docs/getting-started.md"
    );
  });

  it("should handle root URL", () => {
    expect(urlToRelPath("https://example.com/")).toBe("index.md");
    expect(urlToRelPath("https://example.com")).toBe("index.md");
  });

  it("should handle deeply nested paths", () => {
    expect(urlToRelPath("https://example.com/api/hooks/useNavigate")).toBe(
      "api/hooks/useNavigate.md"
    );
  });

  it("should strip trailing slashes", () => {
    expect(urlToRelPath("https://example.com/docs/intro/")).toBe("docs/intro.md");
  });
});

describe("buildUrlMap", () => {
  it("should map URLs to file paths", () => {
    const pages = [
      makePage("https://example.com/docs/intro"),
      makePage("https://example.com/api/hooks"),
    ];

    const map = buildUrlMap(pages, "/out");
    expect(map.get("https://example.com/docs/intro")?.relPath).toBe("docs/intro.md");
    expect(map.get("https://example.com/api/hooks")?.relPath).toBe("api/hooks.md");
    expect(map.get("https://example.com/docs/intro")?.filePath).toBe("/out/docs/intro.md");
  });
});

describe("rewriteLinks", () => {
  const pages = [
    makePage("https://example.com/docs/intro"),
    makePage("https://example.com/docs/guides/routing"),
    makePage("https://example.com/api/hooks/useNavigate"),
  ];
  const urlMap = buildUrlMap(pages, "/out");

  it("should rewrite same-domain links to relative paths", () => {
    const md = "See [intro](https://example.com/docs/intro) for details.";
    const result = rewriteLinks(md, "api/hooks/useNavigate.md", urlMap, "example.com");
    expect(result).toBe("See [intro](../../docs/intro.md) for details.");
  });

  it("should produce same-directory relative links", () => {
    const md = "See [routing](https://example.com/docs/guides/routing).";
    const result = rewriteLinks(md, "docs/intro.md", urlMap, "example.com");
    expect(result).toBe("See [routing](./guides/routing.md).");
  });

  it("should leave external links untouched", () => {
    const md = "See [MDN](https://developer.mozilla.org/docs).";
    const result = rewriteLinks(md, "docs/intro.md", urlMap, "example.com");
    expect(result).toBe("See [MDN](https://developer.mozilla.org/docs).");
  });

  it("should leave links to unscraped pages untouched", () => {
    const md = "See [unknown](https://example.com/docs/unknown).";
    const result = rewriteLinks(md, "docs/intro.md", urlMap, "example.com");
    expect(result).toBe("See [unknown](https://example.com/docs/unknown).");
  });

  it("should handle links with titles", () => {
    const md = '[intro](https://example.com/docs/intro "Introduction")';
    const result = rewriteLinks(md, "api/hooks/useNavigate.md", urlMap, "example.com");
    expect(result).toBe('[intro](../../docs/intro.md "Introduction")');
  });

  it("should handle multiple links in one line", () => {
    const md =
      "See [intro](https://example.com/docs/intro) and [routing](https://example.com/docs/guides/routing).";
    const result = rewriteLinks(md, "api/hooks/useNavigate.md", urlMap, "example.com");
    expect(result).toContain("../../docs/intro.md");
    expect(result).toContain("../../docs/guides/routing.md");
  });

  it("should normalize URLs with trailing slashes and hashes", () => {
    const md = "See [intro](https://example.com/docs/intro/#section).";
    const result = rewriteLinks(md, "api/hooks/useNavigate.md", urlMap, "example.com");
    expect(result).toContain("../../docs/intro.md");
  });
});

