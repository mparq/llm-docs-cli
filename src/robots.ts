/**
 * robots.txt fetcher and parser.
 * Checks Disallow/Allow rules for a wildcard (*) user-agent.
 */

interface RobotsRule {
  type: "allow" | "disallow";
  pattern: string;
}

interface RobotsResult {
  rules: RobotsRule[];
}

/** Fetch and parse robots.txt for a given URL's origin. Returns null on fetch failure. */
export async function fetchRobotsTxt(url: string): Promise<RobotsResult | null> {
  try {
    const origin = new URL(url).origin;
    const resp = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    return parseRobotsTxt(text);
  } catch {
    return null;
  }
}

/** Parse robots.txt content, extracting rules for the * user-agent. */
export function parseRobotsTxt(text: string): RobotsResult {
  const lines = text.split("\n").map((l) => l.trim());
  const rules: RobotsRule[] = [];
  let inWildcard = false;

  for (const line of lines) {
    // Skip comments and empty lines
    const stripped = line.replace(/#.*$/, "").trim();
    if (!stripped) continue;

    const [directive, ...rest] = stripped.split(":");
    const key = directive.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      inWildcard = value === "*";
      continue;
    }

    if (!inWildcard) continue;

    if (key === "disallow" && value) {
      rules.push({ type: "disallow", pattern: value });
    } else if (key === "allow" && value) {
      rules.push({ type: "allow", pattern: value });
    }
  }

  return { rules };
}

/**
 * Check if a URL path is allowed by robots.txt rules.
 * Uses longest-match precedence (standard behavior).
 */
export function isAllowedByRobots(url: string, robots: RobotsResult): boolean {
  const u = new URL(url);
  const pathname = u.pathname + u.search;

  let bestMatch: RobotsRule | null = null;
  let bestLen = -1;

  for (const rule of robots.rules) {
    if (matchesRobotsPattern(pathname, rule.pattern)) {
      const len = rule.pattern.replace(/\*$/, "").length;
      if (len > bestLen) {
        bestLen = len;
        bestMatch = rule;
      }
    }
  }

  // No matching rule = allowed
  if (!bestMatch) return true;
  return bestMatch.type === "allow";
}

/** Match a path against a robots.txt pattern (supports * wildcard and $ anchor). */
function matchesRobotsPattern(path: string, pattern: string): boolean {
  // Convert robots.txt pattern to regex
  // * matches any sequence, $ anchors to end
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      regex += ".*";
    } else if (ch === "$" && i === pattern.length - 1) {
      regex += "$";
    } else {
      regex += ch.replace(/[.+?^{}()|[\]\\]/g, "\\$&");
    }
  }
  // If no $ anchor, pattern is a prefix match
  if (!pattern.endsWith("$")) {
    return new RegExp(`^${regex}`).test(path);
  }
  return new RegExp(`^${regex}`).test(path);
}
