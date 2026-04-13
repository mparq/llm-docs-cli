# llm-docs

Scrape JS-heavy documentation sites into clean, LLM-friendly markdown. Point it at a URL and get a directory tree of markdown files that mirrors the site structure.

```bash
llm-docs https://shopify.dev/docs/api/app-home -d 2 -m 100

# shopify.dev/
#   docs/api/app-home.md
#   docs/api/app-home/apis/config.md
#   docs/api/app-home/apis/navigation.md
#   ...
```

## Why this exists

Most documentation lives behind JavaScript-rendered SPAs. `curl` gives you an empty shell. LLMs need the actual content, as markdown, on disk.

Inspired by [llm.codes](https://llm.codes) -- an excellent hosted service that converts documentation into LLM-optimized markdown. `llm-docs` takes a different approach:

- **Local-first.** Output lives on your filesystem. No API keys, no token limits, no per-page cost.
- **Crawls, not single pages.** One command pulls an entire API reference by following links.
- **Prefix-priority crawling.** URLs closer to your starting path are visited first, so the targeted subtree is exhausted before budget is spent on tangential sidebar links.
- **Composable.** Multiple runs to the same output directory merge cleanly -- paths are deterministic. Crawl one section, inspect, crawl another.
- **Vendor rules.** Site-specific extraction fixes for popular doc sites (Shopify, etc.). See `src/vendors.ts` to contribute rules for new sites.

All code in this repo is agent-written.

## Quick start

```bash
git clone https://github.com/mparq/llm-docs-cli
cd llm-docs-cli
npm install        # Chromium auto-installs on first run
```

```bash
# Single page
npm run dev -- https://reactrouter.com/start/framework/routing -d 0

# Crawl an API reference (defaults: depth 3, max 200 pages)
npm run dev -- https://shopify.dev/docs/api/app-home

# Explore iteratively
npm run dev -- https://shopify.dev/docs/api -d 1 -m 20
llm-docs links shopify.dev --group 2     # see what's out there
npm run dev -- https://shopify.dev/docs/api/admin-graphql -d 2 -m 500 -o .
```

Run `llm-docs --help` for the full set of options, filtering, and workflow tips.

## Recommended usage: hand it to your agent

The best way to use `llm-docs` is to not use it yourself. Give an AI coding agent access to the tool and let it drive:

1. Tell your agent which library or API you need docs for.
2. The agent runs `llm-docs --help` to learn the CLI.
3. It crawls the docs, inspects with `llm-docs links`, iterates to fill gaps.
4. It reads the resulting markdown files to answer your questions or write code.

This works especially well for libraries with large API surfaces where you don't know upfront which pages you'll need. Agents are already good at navigating file trees -- `grep`, `find`, and `read` just work. The directory tree *is* the table of contents.

## How it works

```
URL
 │
 ├─ Playwright render (headless Chromium, JS execution)
 │
 ├─ Code block simplification (unwrap CodeMirror, deep wrappers)
 │
 ├─ Link extraction ← collects same-domain links from FULL DOM
 │                     (before any cleanup can remove them)
 │
 ├─ DOM cleanup
 │    ├─ Early vendor DOM rules
 │    ├─ data-markdown="remove", sr-only removal
 │    ├─ <dt> simplification
 │    └─ Vendor DOM rules (Shopify, Microsoft Learn, etc.)
 │
 ├─ Content extraction (find main content root, strip chrome)
 │
 ├─ Turndown (HTML → markdown)
 │
 ├─ Markdown cleanup + vendor markdown rules
 │
 └─ Post-processing filters → .md file
```

**Rendering:** Playwright launches headless Chromium, waits for JS rendering, blocks images/fonts/media for speed.

**Link discovery:** Links are extracted from the full rendered DOM *before* any cleanup runs. This ensures vendor rules and chrome stripping can't accidentally remove discoverable links that the crawler needs.

**Content extraction:** A selector chain finds the main content area, stripping nav, sidebar, footer, and other chrome. Vendor-specific DOM rules (in `src/vendors.ts`) fix site-specific quirks before conversion.

**Crawling:** The crawler uses **prefix-priority ordering** rather than naive BFS. URLs sharing a longer path prefix with the start URL are dequeued first. When you crawl from `/docs/api/admin-graphql`, the entire subtree is explored before the budget gets spent on unrelated sidebar links. This matters most when `--max-urls` is the constraint -- you get complete coverage of the targeted area instead of a random sampling across the site.

**Caching:** Pages are cached locally (~/.cache/llm-docs, 7-day TTL) so re-runs and iterative exploration are fast.

**Output:** Each page's URL path maps to a file path. Links between scraped pages are rewritten to relative paths so agents can follow references with standard file reads.

## Development

See [AGENTS.md](AGENTS.md) for architecture details and development commands.

Vendor rules for new documentation sites are welcome -- add a section to `src/vendors.ts` with DOM and/or markdown transforms. Rules should be safe no-ops on sites they don't target.
