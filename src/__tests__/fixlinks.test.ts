import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rewriteAbsoluteLinks, rewriteBrokenRelativeLinks, fixLinks } from "../fixlinks.ts";

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

describe("rewriteBrokenRelativeLinks", () => {
  let tmpDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `broken-rel-test-${Date.now()}`);
    outDir = join(tmpDir, "example.com");
    mkdirSync(join(outDir, "docs", "guides"), { recursive: true });
    mkdirSync(join(outDir, "api"), { recursive: true });
    // Only create docs/intro.md — other targets are intentionally missing
    writeFileSync(join(outDir, "docs/intro.md"), "exists", "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should rewrite broken relative link to absolute URL", () => {
    const md = "See [deleted](./deleted.md) page.";
    const result = rewriteBrokenRelativeLinks(md, "docs/intro.md", outDir, "example.com");
    expect(result).toBe("See [deleted](https://example.com/docs/deleted) page.");
  });

  it("should leave working relative links untouched", () => {
    const md = "See [intro](../intro.md) page.";
    const result = rewriteBrokenRelativeLinks(md, "docs/guides/routing.md", outDir, "example.com");
    expect(result).toBe("See [intro](../intro.md) page.");
  });

  it("should leave absolute links untouched", () => {
    const md = "See [ext](https://example.com/docs/missing) page.";
    const result = rewriteBrokenRelativeLinks(md, "docs/intro.md", outDir, "example.com");
    expect(result).toBe("See [ext](https://example.com/docs/missing) page.");
  });

  it("should handle relative links with fragments", () => {
    const md = "See [section](./deleted.md#section) for details.";
    const result = rewriteBrokenRelativeLinks(md, "docs/intro.md", outDir, "example.com");
    expect(result).toBe("See [section](https://example.com/docs/deleted#section) for details.");
  });

  it("should handle relative links with query strings", () => {
    const md = "See [version](./deleted.md?v=2) for details.";
    const result = rewriteBrokenRelativeLinks(md, "docs/intro.md", outDir, "example.com");
    expect(result).toBe("See [version](https://example.com/docs/deleted?v=2) for details.");
  });

  it("should handle URL-encoded filenames", () => {
    // Create a file with encoded query in filename (as urlToRelPath produces)
    writeFileSync(join(outDir, "api/foo%3Fbar%3Dbaz.md"), "exists", "utf-8");
    const md = "See [missing](../api/missing%3Fx%3D1.md) and [exists](../api/foo%3Fbar%3Dbaz.md).";
    const result = rewriteBrokenRelativeLinks(md, "docs/intro.md", outDir, "example.com");
    expect(result).toContain("https://example.com/api/missing%3Fx%3D1");
    expect(result).toContain("../api/foo%3Fbar%3Dbaz.md");
  });

  it("should rewrite index.md to root URL", () => {
    const md = "Back to [home](../index.md).";
    const result = rewriteBrokenRelativeLinks(md, "docs/intro.md", outDir, "example.com");
    expect(result).toBe("Back to [home](https://example.com/).");
  });

  it("should preserve link titles", () => {
    const md = '[deleted](./deleted.md "Gone page")';
    const result = rewriteBrokenRelativeLinks(md, "docs/intro.md", outDir, "example.com");
    expect(result).toBe('[deleted](https://example.com/docs/deleted "Gone page")');
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

  it("should rewrite broken relative links back to absolute URLs", () => {
    const outDir = join(tmpDir, "example.com");

    // intro.md has a relative link to a file that no longer exists
    writeFileSync(
      join(outDir, "docs/intro.md"),
      "See [routing](./guides/routing.md) guide.",
      "utf-8"
    );
    // guides/routing.md does NOT exist (simulating deletion)

    const modified = fixLinks(outDir);
    expect(modified).toBe(1);

    expect(readFileSync(join(outDir, "docs/intro.md"), "utf-8")).toBe(
      "See [routing](https://example.com/docs/guides/routing) guide."
    );
  });

  it("should handle broken relative links with fragments and query strings", () => {
    const outDir = join(tmpDir, "example.com");

    writeFileSync(
      join(outDir, "docs/intro.md"),
      "See [section](./deleted.md#overview) and [version](./deleted.md?v=2).",
      "utf-8"
    );

    const modified = fixLinks(outDir);
    expect(modified).toBe(1);

    const content = readFileSync(join(outDir, "docs/intro.md"), "utf-8");
    expect(content).toContain("https://example.com/docs/deleted#overview");
    expect(content).toContain("https://example.com/docs/deleted?v=2");
  });

  it("should rewrite broken index.md link to root URL", () => {
    const outDir = join(tmpDir, "example.com");

    // index.md does not exist
    writeFileSync(
      join(outDir, "docs/intro.md"),
      "Back to [home](../index.md).",
      "utf-8"
    );

    const modified = fixLinks(outDir);
    expect(modified).toBe(1);

    expect(readFileSync(join(outDir, "docs/intro.md"), "utf-8")).toBe(
      "Back to [home](https://example.com/)."
    );
  });
});
