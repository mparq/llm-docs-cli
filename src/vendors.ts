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
// learn.microsoft.com
// ===========================================================================

/** Remove Microsoft Learn chrome elements that confuse Readability and
 *  leak into output: TOC bars, AI summary, feedback widgets, training
 *  cards, metadata, sign-in notices, share links, and recommendation
 *  panels. Must run before Readability to prevent content mis-detection. */
function msLearnRemoveChrome() {
  if (!location.hostname.endsWith("microsoft.com")) return;
  document.querySelectorAll([
    "#ms--content-header",
    "#center-doc-outline",
    "#side-doc-outline",
    "#ms--ai-summary",
    "#ms--inline-notifications",
    "#article-metadata",
    "#article-metadata-footer",
    "#site-user-feedback-footer",
    "#right-rail-training-mobile",
    "#right-rail-recommendations-mobile",
    "#right-rail-events-mobile",
    "#action-panel",
    "[data-bi-name='permission-content-unauthorized-private']",
    "[data-bi-name='learning-resource-card']",
    "[data-bi-name='recommendations']",
    "[data-bi-name='site-feedback-section']",
    ".popover-content",
  ].join(", ")).forEach((el) => el.remove());
}

/** Clean residual MS Learn UI text from markdown output. */
function msLearnCleanMarkdown(md: string): string {
  if (!md.includes("Microsoft Learn")) return md;

  const lines = md.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;

  const junkPatterns = [
    /^Table of contents\s*(Exit editor mode)?$/i,
    /^Ask Learn\s*(Ask Learn)?\s*(Focus mode)?$/i,
    /^(Add to Collections|Add to plan|Add to Challenges)$/i,
    /^Summarize this article for me$/i,
    /^(Was this page helpful\??)$/i,
    /^(Yes|No)\s*(Yes|No)\s*(No)?$/,
    /^Need help with this topic\?$/i,
    /^Want to try using Ask Learn/i,
    /^Suggest a fix\?$/i,
    /^Last updated on \d{2}\/\d{2}\/\d{4}$/,
    /^Share via$/i,
    /^Copy Markdown\s*(Print)?$/i,
    /^\d+ XP$/,
    /^(Intermediate|Beginner|Advanced)$/,
    /^(Developer|Student|Administrator|IT Pro)$/,
    /^\d+ min$/,
    /^Module$/,
    /^\d+ Units?$/,
    /^Feedback$/,
    /^\[?(Facebook|x\.com|LinkedIn|Email)\]?\(https?:\/\/(www\.)?(facebook|twitter|linkedin|mailto)/i,
    /^Expand table$/i,
    /^Copy$/,
    /^(Note|Training)$/,
    /^(Start|Add)$/,
  ];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (junkPatterns.some((p) => p.test(trimmed))) continue;

    // "Note\n\nAccess to this page requires authorization..." block
    if (/^Access to this page requires authorization/i.test(trimmed)) continue;

    result.push(line);
  }

  return result.join("\n");
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
