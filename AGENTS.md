# llm-docs-cli

CLI that scrapes JS-heavy documentation sites into clean, LLM-friendly markdown directory trees.

## Commands

```bash
npm install          # install deps (Chromium auto-installs on first run)
npm run build        # tsc → dist/
npm test             # run test suite (vitest)
npm run dev -- <url> # run directly via tsx
```

Unit tests cover `filter.ts` and `output.ts`. Use `npm run dev -- <url>` to manually verify extraction against real doc sites.

## Architecture

TypeScript, no framework. Six source files, linear pipeline:

```
src/
  cli.ts        CLI entrypoint (commander). Parses args, wires everything together.
  crawl.ts      BFS crawler. Depth-limited, concurrent, deduplicating. Calls extract per page.
  extract.ts    Core pipeline: Playwright render → Readability extraction → Turndown markdown.
                Manages shared browser instance. Fallback selector chain when Readability fails.
  filter.ts     Post-processing filters on markdown. All code-block-aware (track ``` boundaries).
  output.ts     Writes directory tree. Rewrites inter-page links to relative paths. Generates LLMTOC.md.
  cache.ts      File-based cache (~/.cache/llm-docs), 7-day TTL, keyed by URL hash.
```

Key libraries: Playwright (headless Chromium), `@mozilla/readability` (content extraction), Turndown (HTML→markdown), JSDOM (DOM for Readability).
