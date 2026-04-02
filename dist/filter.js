/**
 * Content filters for cleaning markdown output.
 * Ported from llm-codes, keeping only general-purpose filters.
 */
/** Remove navigation chrome and UI artifacts, preserving code blocks */
function filterNavigation(content) {
    // First pass: simple regex patterns that won't match inside code
    const safePatterns = [
        /\[Skip Navigation\]\([^)]+\)/gi,
        /Skip Navigation/gi,
        /\[View sample code\]\([^)]+\)/gi,
        /Current page is\s+[^\n]+/gi,
        /\[?(Back to|Return to)\s+[^\]]+\]?\([^)]+\)/gi,
    ];
    let filtered = content;
    for (const p of safePatterns) {
        filtered = filtered.replace(p, "");
    }
    // Second pass: line-level patterns that need code-block awareness
    const lines = filtered.split("\n");
    const result = [];
    let inCodeBlock = false;
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
        // Breadcrumbs (Home > Docs > API) — only outside code blocks
        if (/^[^>\n]+(?:\s*>\s*[^>\n]+){2,}$/.test(trimmed)) {
            continue;
        }
        // Standalone broken image refs
        if (/^!\[\]\([^)]*\)$/.test(trimmed)) {
            continue;
        }
        // Standalone image captions
        if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(trimmed)) {
            continue;
        }
        result.push(line);
    }
    return result.join("\n");
}
/** Remove legal/copyright boilerplate */
function filterLegalBoilerplate(content) {
    const patterns = [
        /Copyright\s*©?\s*\d{4}[^.\n]*\./gi,
        /©\s*\d{4}[^.\n]*\./gi,
        /All rights reserved\.?/gi,
        /Terms of (Service|Use)/gi,
        /Privacy Policy/gi,
    ];
    let filtered = content;
    for (const p of patterns) {
        filtered = filtered.replace(p, "");
    }
    return filtered;
}
/** Remove empty sections (headers with no content before next header) */
function filterEmptySections(content) {
    const lines = content.split("\n");
    const result = [];
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
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
        // Check if this is a header (h3+) with no content after it
        if (trimmed.match(/^#{3,}\s/)) {
            let hasContent = false;
            let checkInCode = false;
            for (let j = i + 1; j < lines.length; j++) {
                const check = lines[j].trim();
                if (check.startsWith("```"))
                    checkInCode = !checkInCode;
                if (checkInCode) {
                    hasContent = true;
                    break;
                }
                if (check && !check.startsWith("#")) {
                    hasContent = true;
                    break;
                }
                if (check.startsWith("#"))
                    break;
            }
            if (!hasContent)
                continue;
        }
        result.push(line);
    }
    return result.join("\n");
}
/** Remove formatting artifacts, but preserve code blocks */
function filterFormattingArtifacts(content) {
    const lines = content.split("\n");
    const result = [];
    let inCodeBlock = false;
    for (const line of lines) {
        const trimmed = line.trim();
        // Track code block boundaries
        if (trimmed.startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            result.push(line);
            continue;
        }
        // Don't filter inside code blocks
        if (inCodeBlock) {
            result.push(line);
            continue;
        }
        // Excessive horizontal rules
        if (/^-{3,}$/.test(trimmed) || /^={3,}$/.test(trimmed) ||
            /^\*{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed)) {
            continue;
        }
        // Standalone formatting chars (but not backticks — those are code fences)
        if (/^\s*[*_~]+\s*$/.test(line)) {
            continue;
        }
        result.push(line);
    }
    return result.join("\n");
}
/** Deduplicate repeated paragraphs/headers, preserving code blocks */
function deduplicateContent(content) {
    const lines = content.split("\n");
    const result = [];
    const seenParagraphs = new Set();
    const seenHeaders = new Set();
    let currentParagraph = "";
    let inCodeBlock = false;
    function flushParagraph() {
        if (!currentParagraph)
            return;
        const normalized = currentParagraph.trim();
        if (normalized && !seenParagraphs.has(normalized)) {
            seenParagraphs.add(normalized);
            result.push(currentParagraph);
        }
        currentParagraph = "";
    }
    for (const line of lines) {
        const trimmed = line.trim();
        // Track code blocks — pass them through untouched
        if (trimmed.startsWith("```")) {
            if (!inCodeBlock) {
                flushParagraph();
            }
            inCodeBlock = !inCodeBlock;
            result.push(line);
            continue;
        }
        if (inCodeBlock) {
            result.push(line);
            continue;
        }
        if (trimmed === "") {
            flushParagraph();
            if (result.length > 0 && result[result.length - 1] !== "") {
                result.push("");
            }
            continue;
        }
        if (trimmed.startsWith("#")) {
            flushParagraph();
            // Only dedup h1/h2 headers (lower headers might legitimately repeat)
            if (trimmed.match(/^#{1,2}\s/)) {
                if (seenHeaders.has(trimmed))
                    continue;
                seenHeaders.add(trimmed);
            }
            result.push(line);
            continue;
        }
        currentParagraph += (currentParagraph ? "\n" : "") + line;
    }
    flushParagraph();
    return result.join("\n");
}
/** Final whitespace cleanup */
function cleanWhitespace(content) {
    let cleaned = content;
    cleaned = cleaned.replace(/  +/g, " ");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    cleaned = cleaned
        .split("\n")
        .map((l) => l.trimEnd())
        .join("\n");
    cleaned = cleaned.trim();
    return cleaned;
}
/**
 * Aggressive chrome stripping for pages where Readability failed.
 * These patterns are too broad for general use but safe when we know
 * the content came from a raw selector fallback.
 */
function stripFallbackChrome(content) {
    const lines = content.split("\n");
    const result = [];
    let inCodeBlock = false;
    // Single-line junk patterns common in doc site nav/sidebar chrome
    const junkLine = [
        /^(latest|Branches|Versions)$/,
        /^Search.*[⌘⌃].*$/, // Search⌘K, Search⌃K
        /^(Light|Dark|System)\s*(Light|Dark|System)*/,
        /^Copy Page.*$/,
        /^Edit Page.*$/,
        /^On this page$/i,
        /^Table of Contents$/i,
        /^\[\s*$/, // orphaned [ from broken link markup
        /^\]\([^)]*\)\s*$/, // orphaned ](url) from broken link markup
        /^\[API Reference\]/, // API Reference nav link
        /^\[Brand Assets\]/, // footer link
        /^\[Edit\]\(/, // Edit page link
        /^Docs and examples \[CC/, // license footer
        /^•$/, // bullet separator in footers
        // Version switcher: lines that are just version links chained together
        // e.g. [latest (7.13.2)](./foo)[dev](../../dev/foo)
        // e.g. [7.13.2](../../7.13.2/home)[6.30.3](../../6.30.3)...
        /^(\[[^\]]*\]\([^)]*\)){2,}$/,
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
        if (junkLine.some((p) => p.test(trimmed)))
            continue;
        result.push(line);
    }
    return result.join("\n");
}
const DEFAULTS = {
    navigation: true,
    legalBoilerplate: true,
    emptySections: true,
    formattingArtifacts: true,
    deduplicate: true,
    aggressiveChrome: false,
};
/** Apply all content filters to markdown */
export function filterMarkdown(content, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    let filtered = content;
    if (opts.aggressiveChrome)
        filtered = stripFallbackChrome(filtered);
    if (opts.navigation)
        filtered = filterNavigation(filtered);
    if (opts.legalBoilerplate)
        filtered = filterLegalBoilerplate(filtered);
    if (opts.emptySections)
        filtered = filterEmptySections(filtered);
    if (opts.formattingArtifacts)
        filtered = filterFormattingArtifacts(filtered);
    if (opts.deduplicate)
        filtered = deduplicateContent(filtered);
    filtered = cleanWhitespace(filtered);
    return filtered;
}
