/**
 * Core markdown extractor: URL → clean markdown
 *
 * Pipeline: Playwright (JS render) → Readability (main content) → Turndown (HTML→MD)
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
const DEFAULT_OPTIONS = {
    waitFor: 3000,
    timeout: 30000,
    useReadability: true,
    waitForSelector: "",
};
/**
 * Create a configured Turndown instance for documentation markdown
 */
export function createTurndown(baseUrl) {
    const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        emDelimiter: "*",
        strongDelimiter: "**",
        linkStyle: "inlined",
    });
    // Resolve relative URLs to absolute
    if (baseUrl) {
        td.addRule("absoluteLinks", {
            filter: "a",
            replacement(content, node) {
                const el = node;
                const href = el.getAttribute("href");
                if (!href || !content.trim())
                    return content;
                try {
                    const absolute = new URL(href, baseUrl).toString();
                    const title = el.getAttribute("title");
                    return title
                        ? `[${content}](${absolute} "${title}")`
                        : `[${content}](${absolute})`;
                }
                catch {
                    return `[${content}](${href})`;
                }
            },
        });
    }
    // Preserve code blocks with language hints
    td.addRule("fencedCodeBlock", {
        filter(node) {
            return (node.nodeName === "PRE" &&
                node.firstChild !== null &&
                node.firstChild.nodeName === "CODE");
        },
        replacement(_content, node) {
            const codeEl = node;
            const code = codeEl.querySelector("code");
            if (!code)
                return _content;
            // Try to detect language from class names
            const classes = code.className || "";
            const langMatch = classes.match(/(?:language|lang|highlight)-(\w+)/);
            const lang = langMatch ? langMatch[1] : "";
            const text = code.textContent || "";
            return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
        },
    });
    // Convert HTML tables to markdown tables
    td.addRule("tableCell", {
        filter: ["th", "td"],
        replacement(content, node) {
            const cell = content.replace(/\n/g, " ").replace(/\|/g, "\\|").trim();
            return ` ${cell} |`;
        },
    });
    td.addRule("tableRow", {
        filter: "tr",
        replacement(content, node) {
            return `|${content}\n`;
        },
    });
    td.addRule("tableHead", {
        filter: "thead",
        replacement(content, node) {
            // Count columns from the first row
            const firstRow = content.split("\n")[0] || "";
            const colCount = (firstRow.match(/\|/g) || []).length - 1;
            const separator = "|" + " --- |".repeat(colCount);
            return `${content}${separator}\n`;
        },
    });
    td.addRule("tableBody", {
        filter: "tbody",
        replacement(content, node) {
            // If there was no thead, we need to infer a separator from first row
            const el = node;
            const table = el.closest("table");
            const hasHead = table?.querySelector("thead");
            if (!hasHead) {
                const lines = content.split("\n").filter((l) => l.trim());
                if (lines.length > 0) {
                    const colCount = (lines[0].match(/\|/g) || []).length - 1;
                    const separator = "|" + " --- |".repeat(colCount);
                    return `${lines[0]}\n${separator}\n${lines.slice(1).join("\n")}\n`;
                }
            }
            return content;
        },
    });
    td.addRule("table", {
        filter: "table",
        replacement(content) {
            return `\n\n${content.trim()}\n\n`;
        },
    });
    // Remove script, style, svg, nav, footer, header elements
    td.addRule("removeJunk", {
        filter: ["script", "style", "svg", "nav", "footer", "noscript", "iframe"],
        replacement() {
            return "";
        },
    });
    // Remove hidden elements
    td.addRule("removeHidden", {
        filter(node) {
            if (node.nodeType !== 1)
                return false;
            const el = node;
            const style = el.getAttribute("style") || "";
            const hidden = el.getAttribute("hidden");
            const ariaHidden = el.getAttribute("aria-hidden");
            return (hidden !== null ||
                ariaHidden === "true" ||
                style.includes("display: none") ||
                style.includes("display:none") ||
                style.includes("visibility: hidden") ||
                style.includes("visibility:hidden"));
        },
        replacement() {
            return "";
        },
    });
    return td;
}
/**
 * Clean up the raw markdown output
 */
export function cleanMarkdown(md) {
    let cleaned = md;
    // Collapse 3+ blank lines into 2
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    // Remove lines that are just whitespace
    cleaned = cleaned
        .split("\n")
        .map((line) => (line.trim() === "" ? "" : line))
        .join("\n");
    // Remove excessive horizontal rules
    cleaned = cleaned.replace(/(\n---\n){2,}/g, "\n---\n");
    // Remove trailing whitespace per line
    cleaned = cleaned
        .split("\n")
        .map((l) => l.trimEnd())
        .join("\n");
    // Trim the whole thing
    cleaned = cleaned.trim();
    return cleaned;
}
/** Return a platform-appropriate Chrome UA string */
function getDefaultUserAgent() {
    switch (process.platform) {
        case "win32":
            return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
        case "linux":
            return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
        default:
            return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    }
}
// Shared browser instance for batch operations
let sharedBrowser = null;
export async function getBrowser() {
    if (!sharedBrowser) {
        await ensureChromium();
        sharedBrowser = await chromium.launch({ headless: true });
    }
    return sharedBrowser;
}
/** Auto-install Chromium on first run if missing. */
async function ensureChromium() {
    try {
        chromium.executablePath();
    }
    catch {
        console.log("\n📦 Chromium not found — installing for Playwright (one-time, ~400MB)...\n");
        execFileSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });
    }
}
export async function closeBrowser() {
    if (sharedBrowser) {
        await sharedBrowser.close();
        sharedBrowser = null;
    }
}
/**
 * Extract markdown from a single URL
 */
export async function extractMarkdown(url, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const start = Date.now();
    const browser = await getBrowser();
    const context = await browser.newContext({
        userAgent: getDefaultUserAgent(),
        viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    try {
        // Block unnecessary resources to speed things up
        await page.route("**/*", (route) => {
            const type = route.request().resourceType();
            if (["image", "media", "font", "manifest"].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });
        // Navigate and wait for content
        await page.goto(url, {
            waitUntil: "networkidle",
            timeout: opts.timeout,
        });
        // Wait for specific selector if provided
        if (opts.waitForSelector) {
            await page
                .waitForSelector(opts.waitForSelector, { timeout: opts.timeout })
                .catch(() => { });
        }
        // Additional wait for JS rendering
        if (opts.waitFor > 0) {
            await page.waitForTimeout(opts.waitFor);
        }
        // Get the rendered HTML
        const html = await page.content();
        const pageTitle = await page.title();
        // Extract same-domain links from raw HTML before Readability mangles them
        const links = await page.evaluate((pageUrl) => {
            const base = new URL(pageUrl);
            const seen = new Set();
            const results = [];
            document.querySelectorAll("a[href]").forEach((a) => {
                try {
                    const href = a.href;
                    if (!href)
                        return;
                    const u = new URL(href, pageUrl);
                    // Same domain only
                    if (u.hostname !== base.hostname)
                        return;
                    // Skip non-content links
                    const path = u.pathname.toLowerCase();
                    if (path.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|json|xml|zip|tar|gz|pdf|dmg|pkg)$/) ||
                        path.includes("/search") ||
                        path.includes("/login") ||
                        path.includes("/signin") ||
                        path.includes("/signup"))
                        return;
                    // Normalize: strip hash and trailing slash
                    u.hash = "";
                    u.search = "";
                    let normalized = u.toString();
                    if (normalized.endsWith("/") && u.pathname !== "/") {
                        normalized = normalized.slice(0, -1);
                    }
                    if (!seen.has(normalized)) {
                        seen.add(normalized);
                        results.push(normalized);
                    }
                }
                catch { }
            });
            return results;
        }, url);
        // Extract main content with Readability
        let contentHtml;
        let title = pageTitle;
        let usedFallback = false;
        if (opts.useReadability) {
            const dom = new JSDOM(html, { url });
            const reader = new Readability(dom.window.document, {
                charThreshold: 100,
            });
            const article = reader.parse();
            // Check if Readability gave us enough content
            const MIN_READABILITY_LENGTH = 1000;
            if (article &&
                article.content &&
                article.content.length >= MIN_READABILITY_LENGTH) {
                contentHtml = article.content;
                title = article.title || pageTitle;
            }
            else {
                // Readability returned too little — try semantic selectors
                if (article && article.content) {
                    console.warn(`[extract] Readability returned only ${article.content.length} chars for ${url}, trying semantic selectors`);
                }
                else {
                    console.warn(`[extract] Readability couldn't parse ${url}, trying semantic selectors`);
                }
                usedFallback = true;
                contentHtml = await page.evaluate(`
          (() => {
            const JUNK = "nav, header, footer, aside, .sidebar, .nav, .header, .footer, " +
              "[role='navigation'], [role='banner'], [role='contentinfo'], " +
              "[role='complementary'], [aria-label='breadcrumb'], " +
              ".version-selector, .theme-toggle, .search-bar, " +
              ".table-of-contents, .toc, .page-nav, .edit-page";

            function stripJunk(el) {
              var clone = el.cloneNode(true);
              clone.querySelectorAll(JUNK).forEach(function(j) { j.remove(); });
              return clone;
            }

            var selectors = [
              ".sl-markdown-content",
              ".markdown-body",
              ".docs-content",
              ".doc-content",
              ".content-body",
              "#content",
              ".content",
              "main article",
              "article",
              "main",
              "[role='main']",
            ];
            for (var i = 0; i < selectors.length; i++) {
              var el = document.querySelector(selectors[i]);
              if (el && el.innerHTML.length > 500) {
                return stripJunk(el).innerHTML;
              }
            }
            return stripJunk(document.body).innerHTML;
          })()
        `);
            }
        }
        else {
            contentHtml = await page.evaluate(() => document.body.innerHTML);
        }
        // Convert to markdown
        const turndown = createTurndown(url);
        let markdown = turndown.turndown(contentHtml);
        // Add title as H1 if not already present
        if (title && !markdown.startsWith("# ")) {
            markdown = `# ${title}\n\n${markdown}`;
        }
        // Clean up
        markdown = cleanMarkdown(markdown);
        return {
            url,
            title,
            markdown,
            links,
            rawHtmlLength: html.length,
            usedFallback,
            elapsed: Date.now() - start,
        };
    }
    finally {
        await context.close();
    }
}
