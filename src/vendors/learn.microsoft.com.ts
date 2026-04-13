/**
 * Vendor rules for learn.microsoft.com
 */

/** Remove Microsoft Learn chrome elements that confuse Readability and
 *  leak into output: TOC bars, AI summary, feedback widgets, training
 *  cards, metadata, sign-in notices, share links, and recommendation
 *  panels. Must run before Readability to prevent content mis-detection. */
export function msLearnRemoveChrome() {
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
    "#ms--additional-resources-mobile",
    "#action-panel",
    "[data-bi-name='permission-content-unauthorized-private']",
    "[data-bi-name='learning-resource-card']",
    "[data-bi-name='recommendations']",
    "[data-bi-name='site-feedback-section']",
    "[data-bi-name='open-source-feedback-section']",
    ".popover-content",
  ].join(", ")).forEach((el) => el.remove());

  // Remove version-pivot divs that are hidden via CSS (display:none).
  // Microsoft Learn shows one version at a time; inactive versions are
  // hidden by class-based CSS, not inline styles or [hidden], so the
  // generic removeHidden Turndown rule cannot catch them.
  document.querySelectorAll("[data-moniker]").forEach((el) => {
    if (getComputedStyle(el).display === "none") el.remove();
  });
}

/** Clean residual MS Learn UI text from markdown output. */
export function msLearnCleanMarkdown(md: string): string {
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
