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
 *   1. Add a section below with DOM and/or markdown rule functions.
 *   2. Add your functions to the domRules / markdownRules arrays at the bottom.
 */

// ===========================================================================
// shopify.dev
// ===========================================================================

/** Unhide elements that contain real content. Shopify hides code examples
 *  and type definitions behind interactive switcher widgets. */
function shopifyUnhideContent() {
  document.querySelectorAll("[hidden]").forEach((el) => {
    if (
      el.querySelector("pre, code, dl") ||
      (el.textContent && el.textContent.trim().length > 100)
    ) {
      el.removeAttribute("hidden");
    }
  });
}

/** Shopify property headers use paired label spans inside <dt>:
 *    <span data-markdown="remove">apiKey</span>   (visible)
 *    <span hidden=""><strong>apiKey</strong></span> (fallback)
 *  The generic data-markdown="remove" + [hidden] removal deletes both,
 *  leaving empty dts. Fix: replace each dt's inner DOM with clean text
 *  before those generic passes run. */
function shopifyFixPropertyHeaders() {
  document.querySelectorAll("dt").forEach((dt) => {
    // Collect text from the visible label spans (the data-markdown="remove" ones).
    // Each PropertyDetail div holds one label; take the shortest non-empty
    // text from its data-markdown="remove" spans to avoid doubled text from
    // nested hidden+button combos like "DebugOptionsDebugOptions".
    const details = dt.querySelectorAll("[class*='PropertyDetail']");
    if (details.length === 0) return;
    const seen = new Set<string>();
    const parts: string[] = [];
    details.forEach((detail) => {
      // Some label spans contain duplicated inner text from hidden+button
      // combos (e.g. "DebugOptionsDebugOptions"). Use the button or the
      // first visible text node as the canonical label when available.
      const btn = detail.querySelector("button");
      const label = detail.querySelector("span[data-markdown='remove']");
      const text = (btn?.textContent || label?.textContent || detail.textContent || "").trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        parts.push(text);
      }
    });
    if (parts.length > 0) {
      dt.textContent = parts.join(" · ");
    }
  });
}

/** Flatten headings that wrap text in nested divs. Shopify's anchor-link
 *  pattern (<h3><div>...<text></div></h3>) causes Turndown to split the
 *  ATX prefix from the heading text. */
function shopifyFlattenHeadings() {
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    if (h.children.length === 0) return;
    const text = h.textContent?.trim();
    if (text) h.textContent = text;
  });
}

/** Remove page feedback widget and footer at the DOM level. */
function shopifyRemoveChrome() {
  document.querySelectorAll(
    "[class*='PageFeedback'], [class*='PageFooter']",
  ).forEach((el) => el.remove());
}

/** Clean structural noise from the hidden examples block.
 *  Shopify's fallback examples use: <li><h4/><h5>Description</h5><p>..
 *  <h5>js</h5><pre>.. — the empty h4 and h5s are scaffolding only. */
function shopifyCleanExamples() {
  // Scope to the hidden-examples container (an adjacent <div> with <h5>s
  // inside an <aside> or a formerly-hidden block).
  document.querySelectorAll("li h4, li h5").forEach((h) => {
    const text = h.textContent?.trim().toLowerCase() || "";
    if (text === "" || text === "description") {
      h.remove();
      return;
    }
    // Language-name heading directly before a <pre> — redundant with
    // the code block's class="language-*" attribute.
    const next = h.nextElementSibling;
    if (h.tagName === "H5" && next &&
      (next.tagName === "PRE" || next.querySelector("pre"))) {
      h.remove();
    }
  });
}

// ===========================================================================
// (add new sites here)
// ===========================================================================

// ===========================================================================
// Rule registry — add your functions to the appropriate array
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
];

/** Markdown rules run after standard filters. */
export const markdownRules: Array<(md: string) => string> = [];

/** Apply all vendor markdown rules. */
export function applyVendorMarkdownRules(md: string): string {
  let result = md;
  for (const rule of markdownRules) {
    result = rule(result);
  }
  return result;
}
