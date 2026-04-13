#!/usr/bin/env node
/**
 * llm-docs CLI — Scrape JS-heavy doc sites into clean LLM-friendly markdown.
 *
 * Usage:
 *   llm-docs https://reactrouter.com/start/modes --depth 3 --max-urls 200
 */

import { Command } from "commander";
import { join } from "path";
import { crawl } from "./crawl.ts";
import { closeBrowser } from "./extract.ts";
import { writeOutput } from "./output.ts";
import { fixLinks } from "./fixlinks.ts";
import { cacheStats, cacheClear, getCacheDirPath } from "./cache.ts";
import { outlinks, groupOutlinks } from "./outlinks.ts";

const program = new Command();

program
  .name("llm-docs")
  .description("Scrape documentation sites into clean LLM-friendly markdown")
  .version("0.1.0")
  .argument("<url>", "Documentation URL to scrape")
  .option("-d, --depth <n>", "Crawl depth (1 = only direct links from <url>)", "3")
  .option("-m, --max-urls <n>", "Maximum pages to scrape", "200")
  .option("-c, --concurrency <n>", "Concurrent page fetches", "5")
  .option("-o, --output <dir>", "Base directory to write into (default: current directory)")
  .option("-i, --include <patterns>", "Only follow links matching patterns (comma-separated, prefix /path or regex /pattern/)", "")
  .option("-x, --exclude <patterns>", "Exclude URL paths matching patterns (comma-separated, prefix /path or regex /pattern/)", "")
  .option("--wait <ms>", "Wait time for JS rendering (ms)", "3000")
  .option("--timeout <ms>", "Page load timeout (ms)", "30000")
  .option("--no-filter", "Disable content filtering")
  .option("--no-cache", "Skip file cache")
  .option("--ignore-robots", "Ignore robots.txt rules")
  .addHelpText("after", `
Examples:
  llm-docs https://docs.example.com/api
  llm-docs https://docs.example.com/api -m 500 --exclude /changelog

Tips:
  Run one crawl at a time, sequentially. Don't run parallel scrapes.
  llm-docs has built-in concurrency and shares a single browser instance.

  Usually you don't need filters. The crawler prioritizes links under
  the start URL's path, so just point it at the right section and go.
  Prefer broad crawls — extra docs are cheap to delete afterward.

  Iterate: crawl, inspect with \`llm-docs links\`, then crawl deeper.
  Runs to the same -o merge cleanly (deterministic paths + cache).

Filtering:
  The crawler only follows same-domain links and prioritizes URLs
  close to the start path. Most crawls need no filtering at all.

  --exclude /pattern/   Skip matching paths. Useful for known junk
                        (e.g. /changelog, /\\d+\\.\\d+/ for old versions).
  --include /pattern/   Only follow matching paths. Useful for flat
                        sites (e.g. GraphQL APIs with hundreds of types
                        at the same level) where you need a few specific
                        areas: --include "/\\/(products|orders|customers)/"

  Both accept comma-separated path prefixes or /regex/ patterns.
  Exclude wins over include when both match.

After crawling:
  llm-docs links <dir>          Show same-domain URLs not yet scraped.
  llm-docs links <dir> --group 2   Group by path depth for a high-level view.
  llm-docs links <dir> --fix    Also rewrite absolute URLs → relative paths.

  Use --group to zoom in iteratively:
    $ llm-docs links shopify.dev --group 2
    10x  https://shopify.dev/docs/apps
     8x  https://shopify.dev/docs/api       ← looks relevant, zoom in
    $ llm-docs links shopify.dev --group 3
     3x  https://shopify.dev/docs/api/shopify-cli
     1x  https://shopify.dev/docs/api/app-home  ← worth pulling in
    $ llm-docs https://shopify.dev/docs/api/app-home -d 2 -o .

Output structure:
  Files mirror the URL path under a hostname folder:
    <output>/shopify.dev/docs/api/admin-graphql.md
    <output>/shopify.dev/docs/api/admin-graphql/mutations/productCreate.md
`)
  .action(async (url: string, opts: Record<string, string | boolean>) => {
    const depth = parseInt(opts.depth as string, 10);
    const maxUrls = parseInt(opts.maxUrls as string, 10);
    const concurrency = parseInt(opts.concurrency as string, 10);
    const waitFor = parseInt(opts.wait as string, 10);
    const timeout = parseInt(opts.timeout as string, 10);
    const useFilter = opts.filter !== false;
    const noCache = opts.cache === false;
    const ignoreRobots = opts.ignoreRobots === true;
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
    if (include.length) log(`   Include:     ${include.map(e => e instanceof RegExp ? e.toString() : e).join(", ")}`);
    if (exclude.length) log(`   Exclude:     ${exclude.map(e => e instanceof RegExp ? e.toString() : e).join(", ")}`);
    log(`   robots.txt:  ${ignoreRobots ? "ignored" : "respected"}`);
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
        include,
        exclude,
        noCache,
        ignoreRobots,
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
        onLinkFiltered: (filteredUrl) => {
          log(`  ⤵ skipped ${filteredUrl}`);
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
        log(`   Filtered: ${result.filteredLinks} same-domain links skipped by --include/--exclude`);
      }
      if (result.remainingLinks > 0) {
        log(`   Remaining: ${result.remainingLinks} links not visited (increase --max-urls to include them)`);
      }
      log(`   Output:  ${files} files in ${outDir}/ (${totalKb}KB)`);
      log(`   Browse:  ls -R ${outDir}/`);
      log(`   Time:    ${totalSec}s`);
      log(`\n   Tip: run \`llm-docs links ${outDir}\` to see unscraped URLs, add --fix to rewrite links`);
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

// Subcommand: links — show unscraped outbound links, optionally rewrite to relative paths
program
  .command("links")
  .description("Show same-domain URLs not yet scraped; --group <n> to aggregate by path depth, --fix to rewrite links")
  .argument("<dir>", "Output directory (e.g. shopify.dev)")
  .option("--fix", "Rewrite absolute URLs → relative paths in the output files")
  .option("--group <n>", "Group URLs by path depth (e.g. 2 = /docs/api)")
  .action((dir: string, opts: { fix?: boolean; group?: string }) => {
    if (opts.fix) {
      const linksFixed = fixLinks(dir);
      if (linksFixed > 0) {
        console.log(`🔗 ${linksFixed} files updated with relative links`);
      } else {
        console.log(`🔗 No links to rewrite`);
      }
    }

    const raw = outlinks(dir);
    if (raw.length === 0) {
      console.log("No outbound same-domain links found.");
      return;
    }

    const links = opts.group ? groupOutlinks(raw, parseInt(opts.group, 10)) : raw;
    const label = opts.group ? `${links.length} groups` : `${links.length} URLs`;
    console.log(`${label} referenced but not scraped:\n`);
    for (const { url, references } of links) {
      console.log(`  ${references}x  ${url}`);
    }
  });

program.parse();
