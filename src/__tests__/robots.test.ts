import { describe, it, expect } from "vitest";
import { parseRobotsTxt, isAllowedByRobots } from "../robots.ts";

describe("parseRobotsTxt", () => {
  it("parses disallow rules for wildcard user-agent", () => {
    const result = parseRobotsTxt(`
User-agent: *
Disallow: /admin
Disallow: /private/
Allow: /admin/public
`);
    expect(result.rules).toEqual([
      { type: "disallow", pattern: "/admin" },
      { type: "disallow", pattern: "/private/" },
      { type: "allow", pattern: "/admin/public" },
    ]);
  });

  it("ignores rules for specific user-agents", () => {
    const result = parseRobotsTxt(`
User-agent: Googlebot
Disallow: /no-google

User-agent: *
Disallow: /secret
`);
    expect(result.rules).toEqual([{ type: "disallow", pattern: "/secret" }]);
  });

  it("handles empty disallow (allow all)", () => {
    const result = parseRobotsTxt(`
User-agent: *
Disallow:
`);
    expect(result.rules).toEqual([]);
  });

  it("ignores comments and blank lines", () => {
    const result = parseRobotsTxt(`
# This is a comment
User-agent: *
Disallow: /nope # inline comment
`);
    expect(result.rules).toEqual([{ type: "disallow", pattern: "/nope" }]);
  });
});

describe("isAllowedByRobots", () => {
  const robots = parseRobotsTxt(`
User-agent: *
Disallow: /admin
Allow: /admin/public
Disallow: /private/
`);

  it("allows URLs with no matching rule", () => {
    expect(isAllowedByRobots("https://example.com/docs/intro", robots)).toBe(true);
  });

  it("disallows URLs matching a disallow rule", () => {
    expect(isAllowedByRobots("https://example.com/admin/settings", robots)).toBe(false);
  });

  it("allows URLs matching a more specific allow rule", () => {
    expect(isAllowedByRobots("https://example.com/admin/public/page", robots)).toBe(true);
  });

  it("disallows URLs under a disallowed directory", () => {
    expect(isAllowedByRobots("https://example.com/private/data", robots)).toBe(false);
  });

  it("handles wildcard patterns", () => {
    const r = parseRobotsTxt(`
User-agent: *
Disallow: /search*q=
`);
    expect(isAllowedByRobots("https://example.com/search?q=test", r)).toBe(false);
    expect(isAllowedByRobots("https://example.com/search/results", r)).toBe(true);
  });

  it("handles $ end anchor", () => {
    const r = parseRobotsTxt(`
User-agent: *
Disallow: /*.pdf$
`);
    expect(isAllowedByRobots("https://example.com/doc.pdf", r)).toBe(false);
    expect(isAllowedByRobots("https://example.com/doc.pdf/view", r)).toBe(true);
  });
});
