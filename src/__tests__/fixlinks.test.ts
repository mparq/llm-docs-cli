import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rewriteAbsoluteLinks, fixLinks } from "../fixlinks.ts";

describe("rewriteAbsoluteLinks", () => {
  const existing = new Set([
    "docs/intro.md",
    "docs/guides/routing.md",
    "api/hooks/useNavigate.md",
    "index.md",
  ]);

  it("should rewrite same-domain links to relative paths", () => {
    const md = "See [intro](https://example.com/docs/intro) for details.";
    const result = rewriteAbsoluteLinks(md, "api/hooks/useNavigate.md", existing, "example.com");
    expect(result).toBe("See [intro](../../docs/intro.md) for details.");
  });

  it("should produce same-directory relative links", () => {
    const md = "See [routing](https://example.com/docs/guides/routing).";
    const result = rewriteAbsoluteLinks(md, "docs/intro.md", existing, "example.com");
    expect(result).toBe("See [routing](./guides/routing.md).");
  });

  it("should leave external links untouched", () => {
    const md = "See [MDN](https://developer.mozilla.org/docs).";
    const result = rewriteAbsoluteLinks(md, "docs/intro.md", existing, "example.com");
    expect(result).toBe("See [MDN](https://developer.mozilla.org/docs).");
  });

  it("should leave links to non-existent files untouched", () => {
    const md = "See [unknown](https://example.com/docs/unknown).";
    const result = rewriteAbsoluteLinks(md, "docs/intro.md", existing, "example.com");
    expect(result).toBe("See [unknown](https://example.com/docs/unknown).");
  });

  it("should handle links with titles", () => {
    const md = '[intro](https://example.com/docs/intro "Introduction")';
    const result = rewriteAbsoluteLinks(md, "api/hooks/useNavigate.md", existing, "example.com");
    expect(result).toBe('[intro](../../docs/intro.md "Introduction")');
  });

  it("should handle multiple links in one line", () => {
    const md =
      "See [intro](https://example.com/docs/intro) and [routing](https://example.com/docs/guides/routing).";
    const result = rewriteAbsoluteLinks(md, "api/hooks/useNavigate.md", existing, "example.com");
    expect(result).toContain("../../docs/intro.md");
    expect(result).toContain("../../docs/guides/routing.md");
  });

  it("should normalize URLs with trailing slashes and hashes", () => {
    const md = "See [intro](https://example.com/docs/intro/#section).";
    const result = rewriteAbsoluteLinks(md, "api/hooks/useNavigate.md", existing, "example.com");
    expect(result).toContain("../../docs/intro.md");
  });

  it("should handle links to index/root page", () => {
    const md = "Back to [home](https://example.com/).";
    const result = rewriteAbsoluteLinks(md, "docs/intro.md", existing, "example.com");
    expect(result).toBe("Back to [home](../index.md).");
  });
});

describe("fixLinks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `fixlinks-test-${Date.now()}`);
    mkdirSync(join(tmpDir, "example.com", "docs", "guides"), { recursive: true });
    mkdirSync(join(tmpDir, "example.com", "api", "hooks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should rewrite absolute links to relative paths across files", () => {
    const outDir = join(tmpDir, "example.com");

    writeFileSync(
      join(outDir, "docs/intro.md"),
      "See [routing](https://example.com/docs/guides/routing) guide.",
      "utf-8"
    );
    writeFileSync(
      join(outDir, "docs/guides/routing.md"),
      "Back to [intro](https://example.com/docs/intro).",
      "utf-8"
    );
    writeFileSync(
      join(outDir, "api/hooks/useNavigate.md"),
      "See [intro](https://example.com/docs/intro) and [external](https://other.com/page).",
      "utf-8"
    );

    const modified = fixLinks(outDir);
    expect(modified).toBe(3);

    expect(readFileSync(join(outDir, "docs/intro.md"), "utf-8")).toBe(
      "See [routing](./guides/routing.md) guide."
    );
    expect(readFileSync(join(outDir, "docs/guides/routing.md"), "utf-8")).toBe(
      "Back to [intro](../intro.md)."
    );
    expect(readFileSync(join(outDir, "api/hooks/useNavigate.md"), "utf-8")).toBe(
      "See [intro](../../docs/intro.md) and [external](https://other.com/page)."
    );
  });

  it("should not modify files with no rewritable links", () => {
    const outDir = join(tmpDir, "example.com");

    writeFileSync(
      join(outDir, "docs/intro.md"),
      "No links here, just plain text.",
      "utf-8"
    );

    const modified = fixLinks(outDir);
    expect(modified).toBe(0);
  });

  it("should leave links to non-existent files as absolute", () => {
    const outDir = join(tmpDir, "example.com");

    writeFileSync(
      join(outDir, "docs/intro.md"),
      "See [missing](https://example.com/docs/missing).",
      "utf-8"
    );

    const modified = fixLinks(outDir);
    expect(modified).toBe(0);

    expect(readFileSync(join(outDir, "docs/intro.md"), "utf-8")).toBe(
      "See [missing](https://example.com/docs/missing)."
    );
  });
});
