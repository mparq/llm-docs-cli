/**
 * Core markdown extractor: URL → clean markdown
 *
 * Pipeline: Playwright (JS render) → DOM simplification → Turndown (HTML→MD)
 */

import { chromium, Browser, BrowserContext } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import TurndownService from "turndown";
import { earlyDomRules, domRules } from "./vendors.ts";

export interface ExtractOptions {
  /** Time to wait for JS rendering (ms) */
  waitFor?: number;
  /** Max time to wait for page load (ms) */
  timeout?: number;
  /** CSS selector to wait for before extracting */
  waitForSelector?: string;
}

const DEFAULT_OPTIONS: Required<ExtractOptions> = {
  waitFor: 3000,
  timeout: 30000,
  waitForSelector: "",
};

export interface ExtractResult {
  url: string;
  title: string;
  markdown: string;
  /** Same-domain links discovered in the raw HTML (for crawling) */
  links: string[];
  /** Raw HTML length before processing */
  rawHtmlLength: number;
  /** Time taken in ms */
  elapsed: number;
}

/**
 * Create a configured Turndown instance for documentation markdown
 */
export function createTurndown(baseUrl?: string): TurndownService {
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
        const el = node as HTMLElement;
        const href = el.getAttribute("href");
        if (!href || !content.trim()) return content;
        try {
          const absolute = new URL(href, baseUrl).toString();
          const title = el.getAttribute("title");
          // Block-level content inside <a> (e.g. card grids) breaks
          // markdown link syntax. Use first line as link text, append rest.
          if (content.includes("\n")) {
            const lines = content.split("\n").filter((l) => l.trim());
            const linkText = lines[0].trim();
            const rest = lines.slice(1).join("\n").trim();
            const link = title
              ? `[${linkText}](${absolute} "${title}")`
              : `[${linkText}](${absolute})`;
            return rest ? `\n\n${link}\n\n${rest}\n\n` : `\n\n${link}\n\n`;
          }
          return title
            ? `[${content}](${absolute} "${title}")`
            : `[${content}](${absolute})`;
        } catch {
          return `[${content}](${href})`;
        }
      },
    });
  }

  // Preserve code blocks with language hints
  td.addRule("fencedCodeBlock", {
    filter(node) {
      return (
        node.nodeName === "PRE" &&
        node.firstChild !== null &&
        node.firstChild.nodeName === "CODE"
      );
    },
    replacement(_content, node) {
      const codeEl = node as HTMLElement;
      const code = codeEl.querySelector("code");
      if (!code) return _content;

      // Try to detect language from class names, or from data-code-language
      // (some wrappers strip class attrs during processing)
      const classes = code.className || "";
      const langMatch = classes.match(
        /(?:language|lang|highlight)-(\w+)/
      );
      const lang = langMatch
        ? langMatch[1]
        : codeEl.getAttribute("data-code-language") || "";
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
      const el = node as HTMLElement;
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
  // But preserve them inside <pre>/<code> blocks (code examples)
  td.addRule("removeJunk", {
    filter(node) {
      const tag = node.nodeName.toLowerCase();
      if (!["script", "style", "svg", "nav", "footer", "noscript", "iframe"].includes(tag)) {
        return false;
      }
      // Don't strip if inside a code block — the fencedCodeBlock rule
      // will grab textContent of the whole <pre><code> tree.
      let parent = node.parentNode;
      while (parent) {
        const pTag = parent.nodeName.toLowerCase();
        if (pTag === "pre" || pTag === "code") return false;
        parent = parent.parentNode;
      }
      return true;
    },
    replacement() {
      return "";
    },
  });

  // Remove hidden elements
  td.addRule("removeHidden", {
    filter(node) {
      if (node.nodeType !== 1) return false;
      const el = node as HTMLElement;
      const style = el.getAttribute("style") || "";
      const hidden = el.getAttribute("hidden");
      const ariaHidden = el.getAttribute("aria-hidden");
      return (
        hidden !== null ||
        ariaHidden === "true" ||
        style.includes("display: none") ||
        style.includes("display:none") ||
        style.includes("visibility: hidden") ||
        style.includes("visibility:hidden")
      );
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
export function cleanMarkdown(md: string): string {
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
function getDefaultUserAgent(): string {
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
let sharedBrowser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    await ensureChromium();
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

/** Auto-install Chromium on first run if missing. */
async function ensureChromium(): Promise<void> {
  const execPath = chromium.executablePath();
  if (!existsSync(execPath)) {
    console.log("\n📦 Chromium not found — installing for Playwright (one-time, ~400MB)...\n");
    execFileSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });
  }
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

/**
 * Extract markdown from a single URL
 */
export async function extractMarkdown(
  url: string,
  options: ExtractOptions = {}
): Promise<ExtractResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const start = Date.now();

  const browser = await getBrowser();
  const context: BrowserContext = await browser.newContext({
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
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: opts.timeout,
    });

    // Check for HTTP error status codes
    const status = response?.status() ?? 0;
    if (status >= 400) {
      throw new Error(`HTTP ${status} for ${url}`);
    }

    // Wait for specific selector if provided
    if (opts.waitForSelector) {
      await page
        .waitForSelector(opts.waitForSelector, { timeout: opts.timeout })
        .catch(() => {});
    }

    // Additional wait for JS rendering
    if (opts.waitFor > 0) {
      await page.waitForTimeout(opts.waitFor);
    }

    // Simplify complex code block wrappers before content extraction.
    // Many doc sites (Shopify, etc.) use CodeMirror-based tabbed code blocks
    // where <pre><code> is buried inside deep wrapper divs with hidden attrs,
    // aria-hidden, or excessive nesting that content extractors strip.
    // Replace these wrappers with their plain <pre><code> children.
    await page.evaluate(() => {
      const wrapperSelectors = [
        "[class*='CodeBlock']",
        "[class*='codeblock']",
        "[class*='code-block']",
        ".cm-editor",
      ];
      // First pass: convert CodeMirror .cm-content (no <pre>) to <pre><code>
      document.querySelectorAll(".cm-editor").forEach((editor) => {
        const cmContent = editor.querySelector(".cm-content");
        if (!cmContent) return;
        const lang = cmContent.getAttribute("data-language")
          || editor.closest("[data-language]")?.getAttribute("data-language")
          || "";
        const lines: string[] = [];
        cmContent.querySelectorAll(".cm-line").forEach((line) => {
          lines.push(line.textContent || "");
        });
        const text = lines.length > 0 ? lines.join("\n") : (cmContent.textContent || "");
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        if (lang) code.className = "language-" + lang;
        code.textContent = text;
        pre.appendChild(code);
        editor.replaceWith(pre);
      });

      // Second pass: unwrap remaining code block wrappers to expose <pre> children
      for (const sel of wrapperSelectors) {
        document.querySelectorAll(sel).forEach((wrapper) => {
          if (wrapper.tagName === "PRE") return;
          const pres = wrapper.querySelectorAll("pre");
          if (pres.length === 0) return;
          const fragment = document.createDocumentFragment();
          pres.forEach((p) => fragment.appendChild(p.cloneNode(true)));
          wrapper.replaceWith(fragment);
        });
      }

    });

    // Apply vendor-specific early DOM rules (before data-markdown removal)
    for (const rule of earlyDomRules) {
      await page.evaluate(rule);
    }

    // Remove elements explicitly tagged for removal from markdown output
    // (anchor links, decorative labels), screen-reader-only text, and
    // feedback widgets. Do this before dt simplification.
    await page.evaluate(() => {
      document.querySelectorAll(
        "[data-markdown='remove'], .visuallyHidden, .sr-only, .visually-hidden"
      ).forEach((el) => el.remove());
    });

    // Simplify <dt> elements with deep/complex inner DOM.
    // Flatten to clean text so Turndown can convert them properly.
    await page.evaluate(() => {
      document.querySelectorAll("dt").forEach((dt) => {
        if (dt.children.length === 0) return;
        // Remove visual noise: SVGs, hidden elements, aria-hidden, screen-reader-only
        dt.querySelectorAll("svg, [hidden], [aria-hidden='true'], .visuallyHidden, .sr-only, .visually-hidden").forEach((el) => el.remove());
        // Collect text from each direct child, deduplicating
        const seen = new Set<string>();
        const parts: string[] = [];
        for (const child of dt.children) {
          const text = child.textContent?.trim() || "";
          if (text && !seen.has(text)) {
            seen.add(text);
            parts.push(text);
          }
        }
        if (parts.length === 0) return;
        dt.textContent = parts.join(" · ");
      });
    });

    // Apply vendor-specific DOM rules
    for (const rule of domRules) {
      await page.evaluate(rule);
    }

    // Get the rendered HTML
    const html = await page.content();
    const pageTitle = await page.title();

    // Extract same-domain links from raw HTML
    const links = await page.evaluate((pageUrl: string) => {
      const base = new URL(pageUrl);
      const seen = new Set<string>();
      const results: string[] = [];

      document.querySelectorAll("a[href]").forEach((a) => {
        try {
          const href = (a as HTMLAnchorElement).href;
          if (!href) return;
          const u = new URL(href, pageUrl);

          // Same domain only
          if (u.hostname !== base.hostname) return;

          // Skip non-content links
          const path = u.pathname.toLowerCase();
          if (
            path.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|json|xml|zip|tar|gz|pdf|dmg|pkg)$/) ||
            path.includes("/search") ||
            path.includes("/login") ||
            path.includes("/signin") ||
            path.includes("/signup")
          ) return;

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
        } catch {}
      });

      return results;
    }, url);

    // Extract main content, preserving API doc structures:
    // <dl>/<dt>/<dd>, code examples in <aside> panels, etc.
    let title = pageTitle;
    const contentHtml: string = await page.evaluate(`
      (() => {
        var CHROME = "nav, header, footer, .sidebar, .nav, .header, .footer, " +
          "[role='navigation'], [role='banner'], [role='contentinfo'], " +
          "[role='complementary'], [aria-label='breadcrumb'], " +
          ".version-selector, .theme-toggle, .search-bar, " +
          ".table-of-contents, .toc, .page-nav, .edit-page, " +
          ".skip-to-content";

        var CONTENT_ROOTS = [
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

        function stripChrome(el) {
          var clone = el.cloneNode(true);
          clone.querySelectorAll(CHROME).forEach(function(j) { j.remove(); });
          return clone;
        }

        var root = null;
        for (var i = 0; i < CONTENT_ROOTS.length; i++) {
          var el = document.querySelector(CONTENT_ROOTS[i]);
          if (el && el.innerHTML.length > 500) {
            root = el;
            break;
          }
        }
        if (!root) root = document.body;

        return stripChrome(root).innerHTML;
      })()
    `);

    // Convert to markdown
    const turndown = createTurndown(url);
    let markdown = turndown.turndown(contentHtml);

    // Add title as H1 if not already present
    if (title && !markdown.startsWith("# ")) {
      markdown = `# ${title}\n\n${markdown}`;
    }

    // Clean up
    markdown = cleanMarkdown(markdown);

    // Detect error pages that return 200 but have minimal "not found" content
    const stripped = markdown.replace(/^#.*\n*/gm, "").trim();
    if (stripped.length < 200) {
      const lower = markdown.toLowerCase();
      if (
        lower.includes("page not found") ||
        lower.includes("404") ||
        lower.includes("not found")
      ) {
        throw new Error(`Error page detected for ${url}: content appears to be a 404/not-found page`);
      }
    }

    return {
      url,
      title,
      markdown,
      links,
      rawHtmlLength: html.length,
      elapsed: Date.now() - start,
    };
  } finally {
    await context.close();
  }
}
