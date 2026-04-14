# llm-docs-cli

CLI that scrapes JS-heavy documentation sites into clean, LLM-friendly markdown directory trees.

## Commands

```bash
npm install          # install deps (Chromium auto-installs on first run)
npm test             # run test suite (vitest)
npm run typecheck    # tsc --noEmit
npm run dev -- <url> # run directly via tsx
```

Unit tests cover `filter.ts` and `output.ts`. Use `npm run dev -- <url>` to manually verify extraction against real doc sites.

**Never `rm -rf` the cache directory.** Use `--no-cache` to bypass cache for a run. Clearing the cache breaks other in-progress debugging sessions.

## Architecture

TypeScript, no framework. Linear pipeline:

```
src/
  cli.ts        CLI entrypoint (commander). Default command crawls a URL; subcommands:
                `cache` (manage cache), `links` (show unscraped URLs, --fix to rewrite).
  crawl.ts      Prefix-priority crawler. Depth-limited, concurrent, deduplicating. Calls extract per page.
  extract.ts    Core pipeline: Playwright render → DOM cleanup → Turndown markdown.
                Manages shared browser instance. Fallback selector chain when Readability fails.
  filter.ts     Post-processing filters on markdown. All code-block-aware (track ``` boundaries).
  output.ts     Writes directory tree. Rewrites inter-page links to relative paths.
  vendors.ts    Site-specific DOM and markdown rules (Shopify, Microsoft Learn). Safe no-ops on other sites.
  cache.ts      File-based cache (~/.cache/llm-docs), 7-day TTL, keyed by URL hash.
  robots.ts     Fetches/parses robots.txt to respect crawl policies (on by default).
  fixlinks.ts   Post-processing: rewrites absolute URLs to relative paths for local files.
  outlinks.ts   Scans output for same-domain URLs without local files (unscraped page detection).
```

Key libraries: Playwright (headless Chromium), Turndown (HTML→markdown), JSDOM.

## Releasing

See [RELEASING.md](RELEASING.md) for versioning strategy, publish workflow, and release notes conventions.
