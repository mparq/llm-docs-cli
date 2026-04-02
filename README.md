# llm-docs

A CLI tool that scrapes JavaScript-heavy documentation sites into clean, LLM-friendly markdown. Point it at any doc site and get a local file tree that AI coding agents can navigate naturally with `grep`, `find`, and `read`.

```bash
llm-docs https://reactrouter.com/start/modes --depth 2 --max-urls 200 \
  --exclude "/^\/\d+\.\d+\.\d+/,/dev"
```

Writes to `./reactrouter-com-docs/` in the current directory (folder name derived from hostname). Use `-o ~/docs` to write to `~/docs/reactrouter-com-docs/` instead:

```
reactrouter-com-docs/
  LLMTOC.md                              ← start here
  start/
    modes.md
    framework/
      installation.md
      routing.md
      data-loading.md
      actions.md
      ...
    data/
      routing.md
      route-object.md
      ...
  api/
    hooks/
      useNavigate.md
      useLoaderData.md
      useFetcher.md
      ...
    components/
      Link.md
      Form.md
      ...
  upgrading/
    v6.md
    remix.md
    ...
```

Each `.md` file is clean markdown with inline links. Links between scraped pages are **relative paths** (e.g. `../../start/framework/route-module.md`), so LLM agents can follow them with standard file reads. `LLMTOC.md` is the entry point — a nested tree linking to every page.

## Inspiration

This project is heavily inspired by [llm.codes](https://github.com/amantusai/llm-tech) — an excellent web service by Peter Steinberger that converts documentation from 69+ sites into LLM-optimized markdown. It solves the real problem of AI agents being unable to parse modern doc sites that rely on client-side JavaScript rendering.

We extracted the core ideas from llm.codes and rebuilt them as a local CLI with some different tradeoffs:

"We" means me and AI agent, pulling up llm.codes codebase talking about how it works, and implementing this. Fair warning, all code in this repo is agent-written.

| | llm.codes | llm-docs (this project) |
|---|---|---|
| **Runtime** | Hosted web service (Next.js on Vercel) | Local CLI |
| **Rendering** | Firecrawl API (~$0.01/page) | Playwright (free, local Chromium) |
| **Domain restriction** | 69 whitelisted documentation domains | Any URL |
| **Output** | Single combined markdown file | Directory tree mirroring URL structure |
| **Content extraction** | Firecrawl's `onlyMainContent` | Readability + semantic selector fallback chain |
| **Caching** | Redis/in-memory (server-side) | File-based cache with 7-day TTL (see [Cache management](#cache-management)) |

### Why Playwright over Firecrawl?

We guess llm.codes chose Firecrawl because it's a hosted service — you can't run headless Chrome on Vercel serverless functions, and it also just works. For a local CLI, the calculus is different:

- **Free** — no API key, no per-page cost, no rate limits
- **Any domain** — no whitelist needed
- **Comparable quality** — in our testing, Playwright + Readability actually produces cleaner output than Firecrawl for the doc sites we cared about (less nav chrome, no "Copy code" artifacts, no image tag noise)
- **Tradeoff** — ~5s per page locally vs ~1s on Firecrawl's cloud infra

### Why a directory tree instead of one big file?

llm.codes outputs a single combined markdown file. We opted for a directory tree instead, based on the intuition that LLM agents are already good at navigating file trees — it's what they do in every codebase:

- Agents can `grep` for what they need and `read` only relevant pages
- Relative links between files let agents follow references naturally
- Individual files avoid loading an entire doc site into context when you only need a few pages

The output includes an `LLMTOC.md` entry point that provides a nested tree of all scraped pages, although in practice usually the agent just greps and finds by filename the files they're looking for. That said, we haven't formally evaluated this against the single-file approach.

## Installation

```bash
# Install globally from GitHub
npm i -g https://github.com/mparq/llm-docs-cli/tarball/main
llm-docs <url>

# Or clone and link locally
git clone https://github.com/mparq/llm-docs-cli.git
cd llm-docs-cli
npm install
npm link
llm-docs <url>
```

On first run, Chromium (~400MB) is automatically downloaded for Playwright if not already present.

## Usage

```bash
# Scrape React Router v7 docs, skip versioned/dev paths
llm-docs https://reactrouter.com/start/modes --depth 4 --max-urls 500 \
  --exclude "/^\/\d+\.\d+\.\d+/,/dev,/changelog"

# Scrape the Astro docs, only English pages
llm-docs https://docs.astro.build/en/getting-started/ --depth 3 \
  --max-urls 200 --path-prefix /en

# Scrape a single page (e.g. to check output quality)
llm-docs https://reactrouter.com/start/framework/routing

# Write docs into your project's vendor directory
llm-docs https://tanstack.com/query/latest/docs/overview \
  --depth 3 --max-urls 300 -o ./vendor/docs
```

### Options

```
-d, --depth <n>             Crawl depth, 0 = single page (default: 0)
-m, --max-urls <n>          Maximum pages to scrape (default: 50)
-c, --concurrency <n>       Concurrent page fetches (default: 5)
-o, --output <dir>          Base directory to write into (default: current directory)
-p, --path-prefix <prefix>  Only follow links under this path
-x, --exclude <patterns>    Exclude URL paths (comma-separated prefixes or /regex/)
--wait <ms>                 Wait time for JS rendering (default: 3000)
--timeout <ms>              Page load timeout (default: 30000)
--no-filter                 Disable content filtering
--no-readability            Disable Readability content extraction
--no-cache                  Skip the file cache
```

### Cache management

Scraped pages are cached locally for 7 days to avoid redundant fetches. The default cache location is `~/.cache/llm-docs` on macOS/Linux and `%LOCALAPPDATA%\llm-docs\cache` on Windows. Override with `LLM_DOCS_CACHE_DIR` or `XDG_CACHE_HOME`.

```bash
llm-docs cache          # show cache stats
llm-docs cache --clear  # clear all cached entries
```

## How it works

The pipeline has four stages: **render → extract → convert → output**.

### 1. Render with Playwright

Playwright launches headless Chromium and navigates to the target URL. It waits for `networkidle` plus a configurable delay (default 3s) to let client-side JavaScript finish rendering. Images, fonts, and media are blocked via route interception to speed things up.

### 2. Extract main content

**Link discovery happens first**, before any content extraction. The crawler evaluates `document.querySelectorAll('a[href]')` in the live page to collect same-domain links, normalizing them (stripping hash/search/trailing slash) and filtering out non-content URLs (images, login pages, etc.). These links feed the BFS crawl queue.

Then [Readability](https://github.com/nickersoft/readability) (Mozilla's article extraction library, the same engine behind Firefox Reader View) parses the full rendered HTML to isolate the main content, stripping away navigation, sidebars, footers, and other chrome. It's given the rendered DOM via JSDOM.

If Readability returns too little content (<1000 chars) — which happens on some doc sites with unusual markup — a **fallback selector chain** kicks in. It tries, in order:

1. `.sl-markdown-content` (Starlight docs)
2. `.markdown-body` (GitHub-style)
3. `.docs-content`, `.doc-content`, `.content-body`
4. `#content`, `.content`
5. `main article`, `article`, `main`, `[role='main']`

The first selector that matches an element with >500 chars of inner HTML wins. The fallback also strips known junk selectors (nav, footer, sidebar, breadcrumbs, TOC, etc.) from the matched element before returning.

### 3. Convert to markdown

[Turndown](https://github.com/mixmark-io/turndown) converts the extracted HTML to markdown with custom rules for:

- **Code blocks** — detects language from `language-*` / `lang-*` / `highlight-*` CSS classes and emits fenced blocks with the correct language tag
- **Tables** — full HTML table → markdown table conversion (thead/tbody/th/td)
- **Links** — relative `href` values are resolved to absolute URLs against the page base URL
- **Junk removal** — `script`, `style`, `svg`, `nav`, `footer`, `noscript`, `iframe`, and hidden elements (`display:none`, `aria-hidden`, `[hidden]`) are stripped during conversion

After Turndown, a basic cleanup pass collapses excessive blank lines, removes trailing whitespace, and adds the page title as an H1 if the markdown doesn't already start with one.

### 4. Filter and clean

A chain of content filters runs over the markdown output, all **code-block-aware** (they track ` ``` ` boundaries and skip content inside fences):

- **Navigation chrome** — removes "Skip Navigation" links, breadcrumb trails (`Home > Docs > API`), broken image refs, and back/return links
- **Legal boilerplate** — drops whole lines that are purely copyright notices, "© 2024", "All rights reserved", or standalone "Terms of Service | Privacy Policy" footers (won't match these phrases mid-sentence or inside code blocks)
- **Empty sections** — removes h3+ headers with no content before the next header
- **Formatting artifacts** — cleans up orphaned horizontal rules and standalone formatting characters
- **Deduplication** — removes repeated paragraphs and duplicate h1/h2 headers (common when Readability captures both a nav title and a page title)
- **Aggressive chrome** (fallback pages only) — additional patterns for version switchers, search bars, theme toggles, "Edit Page" links, and other UI artifacts that leak through when Readability couldn't isolate the content. This logic is likely over-fitted to the usecases I tested locally (react router 7 docs and shopify hydrogen docs)

### 5. Output and link rewriting

Each page's URL path maps directly to a file path: `/start/framework/routing` → `start/framework/routing.md`. All markdown links pointing to other scraped pages are rewritten from absolute URLs to **relative file paths** (e.g. `../../start/framework/route-module.md`), computed from the directory positions of the source and target files.

An `LLMTOC.md` entry point is generated with a nested tree linking to every page, grouped by directory structure.

### Crawling

For multi-page scrapes, the crawler does **BFS link discovery**. Links are extracted from the raw rendered HTML (before Readability processes it), filtered by hostname, path prefix, and exclude patterns, then queued at the next depth level. A `Set` of normalized URLs handles deduplication. Pages are fetched concurrently (default 5) with a configurable max-urls cap.

Scraped pages are cached locally as JSON files (keyed by URL hash) with a 7-day TTL, so re-running the same scrape skips already-fetched pages.

## Content extraction quality

The Playwright + Readability pipeline produces focused output with minimal noise — clean markdown, proper code fences, and no nav chrome or "Copy code" button artifacts. The fallback selector chain ensures reasonable output even on doc sites where Readability struggles.
