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

/** Apply all vendor markdown rules. */
export function applyVendorMarkdownRules(md: string): string {
  let result = md;
  for (const rule of markdownRules) {
    result = rule(result);
  }
  return result;
}
