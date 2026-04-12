#!/usr/bin/env node
/**
 * llm-docs CLI — Scrape JS-heavy doc sites into clean LLM-friendly markdown.
 *
 * Usage:
 *   llm-docs https://reactrouter.com/start/modes --depth 2 --max-urls 50
 */

import { Command } from "commander";
import { join } from "path";
import { crawl } from "./crawl.ts";
import { closeBrowser } from "./extract.ts";
import { writeOutput } from "./output.ts";
import { fixLinks } from "./fixlinks.ts";
import { cacheStats, cacheClear, getCacheDirPath } from "./cache.ts";

const program = new Command();

program
  .name("llm-docs")
  .description("Scrape documentation sites into clean LLM-friendly markdown")
  .version("0.1.0")
  .argument("<url>", "Documentation URL to scrape")
  .option("-d, --depth <n>", "Crawl depth (1 = only direct links from <url>)", "2")
  .option("-m, --max-urls <n>", "Maximum pages to scrape", "50")
  .option("-c, --concurrency <n>", "Concurrent page fetches", "5")
  .option("-o, --output <dir>", "Base directory to write into (default: current directory)")
  .option("-p, --path-prefix <prefix>", "Only follow links under this path")
  .option("-i, --include <patterns>", "Only follow links matching patterns (comma-separated, prefix /path or regex /pattern/)", "")
  .option("-x, --exclude <patterns>", "Exclude URL paths matching patterns (comma-separated, prefix /path or regex /pattern/)", "")
  .option("--wait <ms>", "Wait time for JS rendering (ms)", "3000")
  .option("--timeout <ms>", "Page load timeout (ms)", "30000")
  .option("--no-filter", "Disable content filtering")
  .option("--no-cache", "Skip file cache")
  .addHelpText("after", `
How to use — let the crawler discover pages, don't loop:
  llm-docs is a BFS crawler. Give it a starting URL and it follows links to
  discover pages. Don't loop over URLs with --depth 0 — that launches a
  browser per URL, is slow, serial, and misses link discovery.

    BAD:  for url in page1 page2 page3; do llm-docs $url -d 0; done
    GOOD: llm-docs https://docs.example.com/api -d 2 -m 500

  Fetched pages are cached locally, so re-runs with different flags are cheap
  and you can always delete output files you don't need.

Filtering — controlling which links get followed:
  By default only same-domain links are followed. Three flags narrow further,
  applied in this order: --path-prefix, then --include, then --exclude.

  --path-prefix /docs/api    Coarse scoping — only follow links whose path
                             starts with this prefix.
  --include <patterns>       Allowlist — only follow links matching at least
                             one pattern. Useful when a page has hundreds of
                             links but you only want a few.
  --exclude <patterns>       Blocklist — drop links matching any pattern,
                             even if they passed --include.

  --include and --exclude accept the same syntax: comma-separated path
  prefixes or /regex/ patterns.
  They compose naturally: --include /docs/api --exclude /docs/api/deprecated.

  Examples:
    A GraphQL API reference has hundreds of queries/mutations/objects but you
    only need a few resources — use --include to cherry-pick:
      llm-docs https://docs.example.com/api/graphql -d 2 -m 200 \\
        --include "/\\/(queries|mutations)\\/(product|order|customer)/"

Recommended workflow:
  1. Recon:    llm-docs <url> -d 1 -m 10
               See what pages exist and what path structure the site uses.
  2. Expand:   llm-docs <url> -d 2 -m 500
               Widen depth/max. Cached pages from step 1 are free.
  3. Prune:    delete folders/files you don't need.
  4. Repeat:   target sub-sections with --path-prefix or --include.

  If a crawl returns fewer pages than expected, check the "Filtered" line in
  the output — it shows how many same-domain links were discovered but
  skipped by your filters. --path-prefix is the most common cause: sites
  often use paths that differ from the URL you started from (versioned URLs,
  aliases, different hierarchies). Try removing or widening it.

  Run \`llm-docs fixlinks <dir>\` after crawling to rewrite absolute URLs in
  the output to relative paths.

Output structure:
  Output mirrors the site's URL tree under a hostname folder:

    $ llm-docs https://shopify.dev/docs/api/admin-graphql --depth 2
    shopify.dev/
      docs/api/admin-graphql.md
      docs/api/admin-graphql/
        2026-04/full-index.md
        2026-04/mutations/
          productCreate.md
          ...

  Use -o to place it elsewhere. Safe to delete, move, or reorganize.
`)
  .action(async (url: string, opts: Record<string, string | boolean>) => {
    const depth = parseInt(opts.depth as string, 10);
    const maxUrls = parseInt(opts.maxUrls as string, 10);
    const concurrency = parseInt(opts.concurrency as string, 10);
    const waitFor = parseInt(opts.wait as string, 10);
    const timeout = parseInt(opts.timeout as string, 10);
    const useFilter = opts.filter !== false;
    const noCache = opts.cache === false;
    const pathPrefix = (opts.pathPrefix as string) || "";
    const include = parsePatterns((opts.include as string) || "");
    const exclude = parsePatterns((opts.exclude as string) || "");
    const baseDir = (opts.output as string) || ".";
    const outDir = join(baseDir, generateDirName(url));

    const log = makeLogger();

    log(`\n🔍 llm-docs — Scraping documentation`);
    log(`   URL:         ${url}`);
    log(`   Depth:       ${depth}`);
    log(`   Max pages:   ${maxUrls}`);
    log(`   Concurrency: ${concurrency}`);
    if (pathPrefix) log(`   Path prefix: ${pathPrefix}`);
    if (include.length) log(`   Include:     ${include.map(e => e instanceof RegExp ? e.toString() : e).join(", ")}`);
    if (exclude.length) log(`   Exclude:     ${exclude.map(e => e instanceof RegExp ? e.toString() : e).join(", ")}`);
    log(`   Cache:       ${noCache ? "disabled" : getCacheDirPath()}`);
    log(`   Output:      ${outDir}/`);
    if (depth === 0) {
      log();
      log(`   ⚠️  depth=0 fetches a single page with no link discovery.`);
      log(`   Use depth ≥ 1 to crawl. Cached pages make re-runs cheap.`);
    }
    log();

    try {
      const result = await crawl(url, {
        depth,
        maxUrls,
        concurrency,
        pathPrefix,
        include,
        exclude,
        noCache,
        waitFor,
        timeout,
        onPageStart: log.isTTY
          ? (pageUrl: string, current: number, total: number) => {
            const short = shortenUrl(pageUrl);
            log.progress(`  [${current}/${total}] 🔄 ${short}`);
          }
          : undefined,
        onPageComplete: (pageResult, current, total) => {
          const short = shortenUrl(pageResult.url);
          const kb = (pageResult.markdown.length / 1024).toFixed(1);
          const fromCache = pageResult.elapsed === 0;
          const timing = fromCache ? "cached" : `${pageResult.elapsed}ms`;
          log(`  [${current}/${total}] ${fromCache ? "📦" : "✅"} ${short} (${kb}KB, ${timing})`);
        },
        onPageError: (pageUrl, error) => {
          const short = shortenUrl(pageUrl);
          log(`  ❌ ${short}: ${error.message}`);
        },
      });

      // Write output tree
      const { files, totalBytes } = writeOutput({
        outDir,
        result,
        useFilter,
      });

      // Summary
      const totalKb = (totalBytes / 1024).toFixed(1);
      const totalSec = (result.totalTime / 1000).toFixed(1);
      log(`\n✨ Done!`);
      log(`   Pages:   ${result.pages.length} scraped, ${result.errors.length} errors`);
      if (result.filteredLinks > 0) {
        log(`   Filtered: ${result.filteredLinks} same-domain links skipped by --path-prefix/--include/--exclude`);
      }
      log(`   Output:  ${files} files in ${outDir}/ (${totalKb}KB)`);
      log(`   Browse:  ls -R ${outDir}/`);
      log(`   Time:    ${totalSec}s`);
      log(`\n   Tip: run \`llm-docs fixlinks ${outDir}\` to rewrite absolute URLs → relative paths`);
    } catch (err) {
      console.error(`\n❌ Fatal error: ${err}`);
      process.exitCode = 1;
    } finally {
      await closeBrowser();
      process.exit(process.exitCode ?? 0);
    }
  });

/** Parse --exclude flag: comma-separated, supports /regex/ syntax */
function parsePatterns(raw: string): (string | RegExp)[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    // Check for /regex/ syntax
    const reMatch = s.match(/^\/(.+)\/([gimsuy]*)$/);
    if (reMatch) {
      return new RegExp(reMatch[1], reMatch[2]);
    }
    // Otherwise treat as a path prefix
    return s;
  });
}

/**
 * Logger that uses \r-based in-place overwrites in a TTY,
 * plain console.log when piped (so LLM agents see every line).
 */
function makeLogger() {
  const isTTY = process.stdout.isTTY ?? false;

  const log = (msg = "") => {
    if (isTTY) {
      process.stdout.write(`\r${msg}`.padEnd(80) + "\n");
    } else {
      console.log(msg);
    }
  };
  /** In-place overwrite (TTY only, no newline). */
  log.progress = (msg: string) => {
    process.stdout.write(`\r${msg}`.padEnd(80));
  };
  log.isTTY = isTTY;
  return log;
}

/** Generate output folder name from URL — just the hostname, losslessly reversible */
function generateDirName(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return "docs";
  }
}

/** Shorten a URL for display */
function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path.length > 50) {
      return u.hostname + path.slice(0, 25) + "..." + path.slice(-22);
    }
    return u.hostname + path;
  } catch {
    return url;
  }
}

// Subcommand: cache management
program
  .command("cache")
  .description("Manage the file cache")
  .option("--clear", "Clear all cached pages")
  .option("--stats", "Show cache statistics")
  .action((opts: Record<string, boolean>) => {
    if (opts.clear) {
      const count = cacheClear();
      console.log(`🗑️  Cleared ${count} cached entries.`);
    } else {
      const s = cacheStats();
      console.log(`📦 Cache: ${s.entries} entries, ${s.sizeKb}KB`);
      console.log(`   Location: ${getCacheDirPath()}`);
    }
  });

// Subcommand: fixlinks — rewrite absolute URLs → relative paths
program
  .command("fixlinks")
  .description("Rewrite absolute URLs → relative paths across .md files in an output directory")
  .argument("<dir>", "Output directory (e.g. shopify.dev)")
  .action((dir: string) => {
    const linksFixed = fixLinks(dir);
    if (linksFixed > 0) {
      console.log(`🔗 ${linksFixed} files updated with relative links`);
    } else {
      console.log(`🔗 No links to rewrite`);
    }
  });

program.parse();
