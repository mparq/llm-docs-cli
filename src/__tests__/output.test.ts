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

  it("should encode query string into filename", () => {
    expect(urlToRelPath("https://example.com/docs/overview?view=v8")).toBe(
      "docs/overview%3Fview%3Dv8.md"
    );
  });

  it("should handle multiple query params", () => {
    expect(urlToRelPath("https://example.com/docs/page?a=1&b=2")).toBe(
      "docs/page%3Fa%3D1%26b%3D2.md"
    );
  });

  it("should handle root URL with query string", () => {
    expect(urlToRelPath("https://example.com/?lang=en")).toBe(
      "index%3Flang%3Den.md"
    );
  });
});
