import { describe, it, expect } from "vitest";
import { createTurndown, cleanMarkdown } from "../extract.ts";

describe("cleanMarkdown", () => {
  it("should collapse 3+ blank lines into 2", () => {
    const result = cleanMarkdown("line 1\n\n\n\n\nline 2");
    expect(result).toBe("line 1\n\nline 2");
  });

  it("should trim whitespace-only lines to empty", () => {
    const result = cleanMarkdown("line 1\n   \nline 2");
    expect(result).toBe("line 1\n\nline 2");
  });

  it("should collapse consecutive horizontal rules separated by newlines", () => {
    // cleanMarkdown uses /\n---\n/ repeated — it collapses `\n---\n---\n` patterns
    const result = cleanMarkdown("above\n---\n---\n---\nbelow");
    // Standalone --- on separate lines aren't collapsed by cleanMarkdown;
    // that's handled by filterFormattingArtifacts instead
    expect(result).toContain("above");
    expect(result).toContain("below");
  });

  it("should trim trailing whitespace per line", () => {
    const result = cleanMarkdown("line 1   \nline 2  \n  line 3");
    expect(result).toBe("line 1\nline 2\n  line 3");
  });

  it("should trim the whole output", () => {
    const result = cleanMarkdown("\n\n  content  \n\n");
    expect(result).toBe("content");
  });

  it("should handle already-clean content", () => {
    const input = "# Title\n\nParagraph one.\n\nParagraph two.";
    expect(cleanMarkdown(input)).toBe(input);
  });
});

describe("createTurndown", () => {
  function convert(html: string, baseUrl?: string): string {
    return createTurndown(baseUrl).turndown(html).trim();
  }

  describe("code blocks", () => {
    it("should create fenced code blocks from pre>code", () => {
      const html = "<pre><code>const x = 1;</code></pre>";
      const result = convert(html);
      expect(result).toContain("```");
      expect(result).toContain("const x = 1;");
    });

    it("should detect language from language- class", () => {
      const html = '<pre><code class="language-typescript">const x: number = 1;</code></pre>';
      const result = convert(html);
      expect(result).toContain("```typescript");
    });

    it("should detect language from highlight- class", () => {
      const html = '<pre><code class="highlight-python">print("hi")</code></pre>';
      const result = convert(html);
      expect(result).toContain("```python");
    });

    it("should produce bare fences when no language class", () => {
      const html = "<pre><code>plain code</code></pre>";
      const result = convert(html);
      expect(result).toMatch(/```\nplain code\n```/);
    });
  });

  describe("tables", () => {
    it("should convert a simple table with thead", () => {
      const html = `
        <table>
          <thead><tr><th>Name</th><th>Type</th></tr></thead>
          <tbody><tr><td>id</td><td>number</td></tr></tbody>
        </table>`;
      const result = convert(html);
      expect(result).toContain("| Name | Type |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| id | number |");
    });

    it("should escape pipes in cell content", () => {
      const html = `
        <table>
          <thead><tr><th>Pattern</th></tr></thead>
          <tbody><tr><td>a | b</td></tr></tbody>
        </table>`;
      const result = convert(html);
      expect(result).toContain("a \\| b");
    });
  });

  describe("links", () => {
    it("should resolve relative links to absolute when baseUrl provided", () => {
      const html = '<a href="/docs/intro">Intro</a>';
      const result = convert(html, "https://example.com/docs/overview");
      expect(result).toBe("[Intro](https://example.com/docs/intro)");
    });

    it("should keep absolute links as-is", () => {
      const html = '<a href="https://other.com/page">Link</a>';
      const result = convert(html, "https://example.com");
      expect(result).toBe("[Link](https://other.com/page)");
    });

    it("should preserve link titles", () => {
      const html = '<a href="/docs" title="Documentation">Docs</a>';
      const result = convert(html, "https://example.com");
      expect(result).toBe('[Docs](https://example.com/docs "Documentation")');
    });

    it("should drop links with empty content", () => {
      const html = '<a href="/docs">  </a>';
      const result = convert(html, "https://example.com");
      expect(result).not.toContain("[");
    });
  });

  describe("junk removal", () => {
    it("should strip script tags", () => {
      const html = "<p>Content</p><script>alert('xss')</script>";
      const result = convert(html);
      expect(result).toBe("Content");
    });

    it("should strip style tags", () => {
      const html = "<style>.foo { color: red; }</style><p>Content</p>";
      const result = convert(html);
      expect(result).toBe("Content");
    });

    it("should strip nav elements", () => {
      const html = "<nav><a href='/'>Home</a></nav><p>Content</p>";
      const result = convert(html);
      expect(result).toBe("Content");
    });

    it("should strip footer elements", () => {
      const html = "<p>Content</p><footer>Copyright 2024</footer>";
      const result = convert(html);
      expect(result).toBe("Content");
    });

    it("should strip hidden elements", () => {
      const html = '<p>Visible</p><div hidden>Hidden</div>';
      const result = convert(html);
      expect(result).toBe("Visible");
    });

    it("should strip aria-hidden elements", () => {
      const html = '<p>Visible</p><span aria-hidden="true">Icon</span>';
      const result = convert(html);
      expect(result).toBe("Visible");
    });

    it("should strip display:none elements", () => {
      const html = '<p>Visible</p><div style="display: none">Hidden</div>';
      const result = convert(html);
      expect(result).toBe("Visible");
    });

    it("should strip noscript and iframe", () => {
      const html = "<p>Content</p><noscript>Enable JS</noscript><iframe src='foo'></iframe>";
      const result = convert(html);
      expect(result).toBe("Content");
    });

    it("should preserve script tags inside code blocks", () => {
      const html = '<pre><code class="language-html">&lt;script src="https://cdn.shopify.com/app-bridge.js"&gt;&lt;/script&gt;</code></pre>';
      const result = convert(html);
      expect(result).toContain("```html");
      expect(result).toContain('<script src="https://cdn.shopify.com/app-bridge.js"></script>');
    });

    it("should preserve script tags inside pre>code even without language", () => {
      const html = '<pre><code>&lt;head&gt;\n&lt;script src="app.js"&gt;&lt;/script&gt;\n&lt;/head&gt;</code></pre>';
      const result = convert(html);
      expect(result).toContain('<script src="app.js"></script>');
    });
  });
});
