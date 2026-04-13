/**
 * Vendor-specific fixes for particular documentation sites.
 *
 * DOM rules run inside page.evaluate() before Turndown conversion.
 * Markdown rules run after standard filters.
 *
 * All rules are applied unconditionally for now. They're written to
 * be safe no-ops on sites they don't target.
 *
 * To add rules for a new site:
 *   1. Create a file in vendors/ with your DOM and/or markdown rule functions.
 *   2. Import them here and add to the appropriate registry arrays.
 */

import {
  shopifyFixPropertyHeaders,
  shopifyUnhideContent,
  shopifyRemoveChrome,
  shopifyFlattenHeadings,
  shopifyCleanExamples,
} from "./vendors/shopify.dev.ts";

import {
  msLearnRemoveChrome,
  msLearnCleanMarkdown,
} from "./vendors/learn.microsoft.com.ts";

// ===========================================================================
// Rule registry
// ===========================================================================

/** DOM rules that must run BEFORE data-markdown="remove" and dt cleanup. */
export const earlyDomRules = [
  shopifyFixPropertyHeaders,
];

/** DOM rules run after standard DOM cleanup, before Turndown. */
export const domRules = [
  shopifyUnhideContent,
  shopifyRemoveChrome,
  shopifyFlattenHeadings,
  shopifyCleanExamples,
  msLearnRemoveChrome,
];

/** Markdown rules run after standard filters. */
export const markdownRules: Array<(md: string) => string> = [
  msLearnCleanMarkdown,
];

// ===========================================================================
// Scope profiles — default path-prefix scope for multi-tenant hosts
// ===========================================================================

interface ScopeProfile {
  /** Hostname to match (exact match) */
  hostname: string;
  /**
   * Given the seed URL's pathname, return the default scope path prefix.
   * Return "/" to allow the whole domain (same as no profile).
   */
  getScope: (pathname: string) => string;
}

const scopeProfiles: ScopeProfile[] = [
  {
    // github.com/owner/repo/... → scope to /owner/repo
    hostname: "github.com",
    getScope: (pathname) => {
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length >= 2) return `/${segments[0]}/${segments[1]}`;
      return pathname;
    },
  },
];

/**
 * Get the default scope for a URL based on site profiles.
 * Returns the path prefix that should be used as a hard boundary for link following.
 *
 * Precedence (handled by caller):
 *   1. Explicit --scope flag
 *   2. Site profile default (this function)
 *   3. Fallback: "/" (whole domain)
 */
export function getDefaultScope(hostname: string, pathname: string): string {
  const profile = scopeProfiles.find((p) => p.hostname === hostname);
  if (profile) return profile.getScope(pathname);
  return "/";
}

/** Apply all vendor markdown rules. */
export function applyVendorMarkdownRules(md: string): string {
  let result = md;
  for (const rule of markdownRules) {
    result = rule(result);
  }
  return result;
}
