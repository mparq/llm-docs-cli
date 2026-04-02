import { describe, it, expect } from "vitest";
import {
  filterNavigation,
  filterLegalBoilerplate,
  filterEmptySections,
  filterFormattingArtifacts,
  deduplicateContent,
  cleanWhitespace,
  stripFallbackChrome,
  filterMarkdown,
} from "../filter.ts";

describe("filterNavigation", () => {
  it("should remove Skip Navigation links", () => {
    const input = "[Skip Navigation](https://example.com/skip)\nMain content here";
    const result = filterNavigation(input);
    expect(result).toContain("Main content here");
    expect(result).not.toContain("Skip Navigation");
  });

  it("should remove breadcrumb trails", () => {
    const input = "Home > Docs > API > Hooks\n\nActual content here";
    const result = filterNavigation(input);
    expect(result).not.toContain("Home > Docs > API");
    expect(result).toContain("Actual content here");
  });

  it("should not remove breadcrumb-like lines inside code blocks", () => {
    const input = "```\nHome > Docs > API > Hooks\n```";
    const result = filterNavigation(input);
    expect(result).toContain("Home > Docs > API > Hooks");
  });

  it("should remove standalone broken image refs", () => {
    const input = "Some text\n![](broken.png)\nMore text";
    const result = filterNavigation(input);
    expect(result).not.toContain("![](broken.png)");
    expect(result).toContain("Some text");
    expect(result).toContain("More text");
  });

  it("should remove Back to / Return to links", () => {
    const input = "[Back to overview](https://example.com/overview)\n\nContent";
    const result = filterNavigation(input);
    expect(result).not.toContain("Back to overview");
    expect(result).toContain("Content");
  });

  it("should remove View sample code links", () => {
    const input = "Introduction\n[View sample code](https://example.com/sample)\nDetails";
    const result = filterNavigation(input);
    expect(result).not.toContain("View sample code");
  });
});

describe("filterLegalBoilerplate", () => {
  it("should remove copyright lines", () => {
    const input = "Content here\nCopyright © 2024 Example Inc.\nMore content";
    const result = filterLegalBoilerplate(input);
    expect(result).not.toContain("Copyright");
    expect(result).toContain("Content here");
    expect(result).toContain("More content");
  });

  it("should remove © year lines", () => {
    const input = "Content\n© 2024 Acme Corp. All rights reserved.\nMore";
    const result = filterLegalBoilerplate(input);
    expect(result).not.toContain("© 2024");
  });

  it("should remove standalone 'All rights reserved' lines", () => {
    const input = "Content\nAll rights reserved.\nMore";
    const result = filterLegalBoilerplate(input);
    expect(result).not.toContain("All rights reserved");
  });

  it("should remove standalone legal link lines", () => {
    const input = "Terms of Service | Privacy Policy\n\nReal content";
    const result = filterLegalBoilerplate(input);
    expect(result).not.toContain("Terms of Service");
    expect(result).toContain("Real content");
  });

  it("should preserve copyright lines inside code blocks", () => {
    const input = "```python\n# Copyright © 2024 Example Inc.\nprint('hello')\n```";
    const result = filterLegalBoilerplate(input);
    expect(result).toContain("Copyright © 2024");
  });

  it("should preserve 'Privacy Policy' when it's part of real content", () => {
    const input = "# How to add a Privacy Policy\n\nEvery app needs a Privacy Policy page.";
    const result = filterLegalBoilerplate(input);
    expect(result).toContain("Privacy Policy");
  });

  it("should drop entire lines starting with Copyright", () => {
    // Line-level filter: any line starting with "Copyright <year>" is boilerplate
    const input = "Copyright 2024 Example Inc. All rights reserved.";
    const result = filterLegalBoilerplate(input);
    expect(result.trim()).toBe("");
  });

  it("should preserve copyright mentioned mid-sentence", () => {
    const input = "This code is under Copyright 2024 Example Inc.";
    const result = filterLegalBoilerplate(input);
    expect(result).toContain("This code is under Copyright");
  });

  it("should cleanly remove boilerplate lines without orphans", () => {
    const input = "Content\nTerms of Service | Privacy Policy\nMore";
    const result = filterLegalBoilerplate(input);
    // Line is removed, adjacent lines collapse together
    expect(result).toBe("Content\nMore");
  });
});

describe("filterEmptySections", () => {
  it("should remove h3+ headers with no content", () => {
    const input = "### Empty Section\n### Another Section\n\nContent here";
    const result = filterEmptySections(input);
    expect(result).not.toContain("Empty Section");
    expect(result).toContain("Another Section");
    expect(result).toContain("Content here");
  });

  it("should keep headers that have content", () => {
    const input = "### Section With Content\n\nThis is content\n\n### Next Section\n\nMore content";
    const result = filterEmptySections(input);
    expect(result).toContain("Section With Content");
    expect(result).toContain("Next Section");
  });

  it("should not strip headers inside code blocks", () => {
    const input = "```\n### This is in code\n```\n\nReal content";
    const result = filterEmptySections(input);
    expect(result).toContain("### This is in code");
  });

  it("should keep h1 and h2 headers even if empty", () => {
    const input = "# Main Title\n## Section\n### Empty\n## Another";
    const result = filterEmptySections(input);
    expect(result).toContain("# Main Title");
    expect(result).toContain("## Section");
  });
});

describe("filterFormattingArtifacts", () => {
  it("should remove excessive horizontal rules", () => {
    const input = "Content\n---\nMore content";
    const result = filterFormattingArtifacts(input);
    expect(result).not.toMatch(/^---$/m);
    expect(result).toContain("Content");
    expect(result).toContain("More content");
  });

  it("should remove standalone formatting characters", () => {
    const input = "Content\n  ***  \nMore content";
    const result = filterFormattingArtifacts(input);
    expect(result).not.toMatch(/^\s*\*{3}\s*$/m);
  });

  it("should not remove horizontal rules inside code blocks", () => {
    const input = "```\n---\n===\n```";
    const result = filterFormattingArtifacts(input);
    expect(result).toContain("---");
    expect(result).toContain("===");
  });
});

describe("deduplicateContent", () => {
  it("should remove duplicate paragraphs", () => {
    const input = "This is a paragraph.\n\nSomething else.\n\nThis is a paragraph.";
    const result = deduplicateContent(input);
    const occurrences = result.split("This is a paragraph.").length - 1;
    expect(occurrences).toBe(1);
    expect(result).toContain("Something else.");
  });

  it("should remove duplicate h1/h2 headers", () => {
    const input = "# My Page\n\nContent\n\n# My Page\n\nMore content";
    const result = deduplicateContent(input);
    const occurrences = result.split("# My Page").length - 1;
    expect(occurrences).toBe(1);
    expect(result).toContain("Content");
    expect(result).toContain("More content");
  });

  it("should allow duplicate h3+ headers", () => {
    const input = "### Parameters\n\nFirst list\n\n### Parameters\n\nSecond list";
    const result = deduplicateContent(input);
    const occurrences = result.split("### Parameters").length - 1;
    expect(occurrences).toBe(2);
  });

  it("should not deduplicate inside code blocks", () => {
    const input = "```\nline one\nline one\n```";
    const result = deduplicateContent(input);
    const occurrences = result.split("line one").length - 1;
    expect(occurrences).toBe(2);
  });

  it("should collapse excessive blank lines", () => {
    const input = "Para 1\n\n\n\n\nPara 2";
    const result = deduplicateContent(input);
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("cleanWhitespace", () => {
  it("should collapse multiple spaces", () => {
    const result = cleanWhitespace("text    with     spaces");
    expect(result).toBe("text with spaces");
  });

  it("should collapse 3+ blank lines to 2", () => {
    const result = cleanWhitespace("line 1\n\n\n\nline 2");
    expect(result).toBe("line 1\n\nline 2");
  });

  it("should trim trailing whitespace per line", () => {
    const result = cleanWhitespace("line 1   \nline 2  ");
    expect(result).toBe("line 1\nline 2");
  });
});

describe("stripFallbackChrome", () => {
  it("should remove On this page lines", () => {
    const input = "On this page\n\nActual content";
    const result = stripFallbackChrome(input);
    expect(result).not.toContain("On this page");
    expect(result).toContain("Actual content");
  });

  it("should remove Edit Page links", () => {
    const input = "[Edit](https://github.com/org/repo/edit/main/docs/page.md)\n\nContent";
    const result = stripFallbackChrome(input);
    expect(result).not.toContain("[Edit]");
    expect(result).toContain("Content");
  });

  it("should remove version switcher link chains", () => {
    const input = "[latest (7.13.2)](./foo)[dev](../../dev/foo)\n\nReal content";
    const result = stripFallbackChrome(input);
    expect(result).not.toContain("latest");
    expect(result).toContain("Real content");
  });

  it("should remove theme toggle lines", () => {
    const input = "Light Dark System\n\n# Page Title";
    const result = stripFallbackChrome(input);
    expect(result).not.toContain("Light Dark System");
    expect(result).toContain("# Page Title");
  });

  it("should not strip inside code blocks", () => {
    const input = "```\nOn this page\nEdit Page\n```";
    const result = stripFallbackChrome(input);
    expect(result).toContain("On this page");
    expect(result).toContain("Edit Page");
  });
});

describe("filterMarkdown (full pipeline)", () => {
  it("should apply all filters by default", () => {
    const input = [
      "[Skip Navigation](#main)",
      "Home > Docs > API > Reference",
      "# Page Title",
      "",
      "Real content paragraph.",
      "",
      "### Empty Header",
      "### Section With Content",
      "",
      "Section body here.",
      "",
    ].join("\n");

    const result = filterMarkdown(input);
    expect(result).toContain("# Page Title");
    expect(result).toContain("Real content paragraph.");
    expect(result).toContain("Section body here.");
    expect(result).not.toContain("Skip Navigation");
    expect(result).not.toContain("Home > Docs > API");
    expect(result).not.toContain("Empty Header");
  });

  it("should preserve code blocks through the entire pipeline", () => {
    const input = [
      "# Code Example",
      "",
      "```javascript",
      "// Home > Docs > API",
      "const x = 'hello world';",
      "// On this page",
      "---",
      "```",
      "",
      "End of page.",
    ].join("\n");

    const result = filterMarkdown(input);
    // Line-level filters (breadcrumbs, hr) should not touch code blocks
    expect(result).toContain("// Home > Docs > API");
    expect(result).toContain("const x = 'hello world';");
    expect(result).toContain("---");
  });

  it("should enable aggressive chrome when option is set", () => {
    const input = "On this page\n\n# Title\n\nContent";
    const result = filterMarkdown(input, { aggressiveChrome: true });
    expect(result).not.toContain("On this page");
    expect(result).toContain("Content");
  });
});
