import { describe, it, expect } from "vitest";
import { urlToRelPath } from "../output.ts";

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
