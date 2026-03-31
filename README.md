# llm-docs

A CLI tool that scrapes JavaScript-heavy documentation sites into clean, LLM-friendly markdown. Point it at any doc site and get a local file tree that AI coding agents can navigate naturally with `grep`, `find`, and `read`.

```bash
llm-docs https://reactrouter.com/start/modes --depth 2 --max-urls 80 \
  --exclude "/7.13.2,/6.30.3,/dev,/changelog"
```

Writes a directory tree to `reactrouter-com-docs/` (derived from hostname, or use `-o <dir>`):

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

| | llm.codes | llm-docs (this project) |
|---|---|---|
| **Runtime** | Hosted web service (Next.js on Vercel) | Local CLI |
| **Rendering** | Firecrawl API (~$0.01/page) | Playwright (free, local Chromium) |
| **Domain restriction** | 69 whitelisted documentation domains | Any URL |
| **Output** | Single combined markdown file | Directory tree mirroring URL structure |
| **Content extraction** | Firecrawl's `onlyMainContent` | Readability + semantic selector fallback chain |
| **Caching** | Redis/in-memory (server-side) | File-based `~/.cache/llm-docs` (7-day TTL) |

### Why Playwright over Firecrawl?

llm.codes chose Firecrawl because it's a hosted service — you can't run headless Chrome on Vercel serverless functions. For a local CLI, the calculus is different:

- **Free** — no API key, no per-page cost, no rate limits
- **Any domain** — no whitelist needed
- **Comparable quality** — in our testing, Playwright + Readability actually produces cleaner output than Firecrawl for most doc sites (less nav chrome, no "Copy code" artifacts, no image tag noise)
- **Tradeoff** — ~5s per page locally vs ~1s on Firecrawl's cloud infra

### Why a directory tree instead of one big file?

llm.codes outputs a single combined markdown file. That works well for small doc sections, but breaks down for larger sites:

- A full React Router scrape is 80 pages / 500KB — too large for most LLM context windows
- LLM agents already know how to navigate file trees — they do it in every codebase
- With individual files, agents can `grep` for what they need and `read` only relevant pages
- Relative links between files let agents follow references naturally

The output includes an `LLMTOC.md` entry point that provides a nested tree of all scraped pages.

## Installation

```bash
git clone <this-repo>
cd llm-docs-cli
npm install
npx playwright install chromium
npm link  # installs `llm-docs` globally
```

## Usage

```bash
# Single page
llm-docs https://reactrouter.com/start/modes

# Crawl with depth (follow links from the start page)
llm-docs https://reactrouter.com/start/modes --depth 2 --max-urls 80

# Only follow links under a specific path
llm-docs https://docs.astro.build/en/getting-started/ --depth 2 --path-prefix /en

# Exclude versioned/dev paths (common on doc sites)
llm-docs https://reactrouter.com/start/modes --depth 4 --max-urls 500 \
  --exclude "/7.13.2,/6.30.3,/dev,/changelog"

# Exclude with regex (e.g. any versioned path like /v2/, /v3.1/)
llm-docs https://some-docs.com/guide --depth 2 \
  --exclude "/^\/v\d/"

# Custom output directory
llm-docs https://react.dev/learn --depth 1 -o react-docs
```

### Output structure

```
reactrouter-com-docs/
  LLMTOC.md                                    # entry point — nested tree of all pages
  start/
    modes.md                                    # mirrors /start/modes
    framework/
      installation.md                           # mirrors /start/framework/installation
      routing.md
      data-loading.md
      ...
  api/
    hooks/
      useNavigate.md                            # mirrors /api/hooks/useNavigate
      useLoaderData.md
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

Links between pages are rewritten to relative paths, so `useNavigate.md` links to `../../start/framework/route-module.md` instead of an absolute URL.

### Options

```
-d, --depth <n>             Crawl depth, 0 = single page (default: 0)
-m, --max-urls <n>          Maximum pages to scrape (default: 50)
-c, --concurrency <n>       Concurrent page fetches (default: 5)
-o, --output <dir>          Output directory (default: <hostname>-docs)
-p, --path-prefix <prefix>  Only follow links under this path
-x, --exclude <patterns>    Exclude URL paths (comma-separated prefixes or /regex/)
--wait <ms>                 Wait time for JS rendering (default: 3000)
--timeout <ms>              Page load timeout (default: 30000)
--no-filter                 Disable content filtering
--no-readability            Disable Readability content extraction
--no-cache                  Skip the file cache
```

### Cache management

Scraped pages are cached in `~/.cache/llm-docs` for 7 days to avoid redundant fetches.

```bash
llm-docs cache          # show cache stats
llm-docs cache --clear  # clear all cached entries
```

## How it works

1. **Playwright** launches headless Chromium, navigates to the URL, waits for JS to render
2. **Readability** (Mozilla's article extractor) pulls out the main content, stripping nav/sidebar/footer
3. If Readability returns too little, a **fallback chain** tries semantic selectors (`.sl-markdown-content`, `.markdown-body`, `main`, `article`, etc.)
4. **Turndown** converts the extracted HTML to markdown with proper code fences, tables, and inline links
5. **Content filters** clean up nav chrome, legal boilerplate, empty sections, and duplicate paragraphs — all code-block-aware to avoid destroying code examples
6. Links to same-domain pages that were also scraped are **rewritten to relative paths**

For multi-page crawls, the crawler does BFS link discovery: it extracts same-domain links from the raw HTML before Readability processes it, then follows them up to the configured depth and max-urls limits.

## Content extraction quality

Tested against Firecrawl API output on the same pages:

| Site | Playwright (ours) | Firecrawl |
|---|---|---|
| React Router | 5.8KB clean content, proper tables | 7.7KB with nav chrome, "Copy code" artifacts |
| Astro docs | 1.5KB clean, 12 links | 4.4KB with 30+ image refs, banner noise |
| react.dev | 16.3KB, 19 code blocks | 18.2KB, same code blocks + extra nav |

Our extractor consistently produces more focused output with less noise.
