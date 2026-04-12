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
Examples:
  llm-docs https://docs.example.com/api -d 2 -m 200
  llm-docs https://docs.example.com/api -d 2 -m 500 \\
    --include "/\\/(products|orders|customers)/"

  ONE broad crawl is always better than many narrow ones — each run pays
  browser startup cost, and pages are cached so widening filters is free.

  Multiple runs to the same -o directory compose naturally — output paths
  are deterministic (hostname + URL path), so runs with different filters
  merge into one tree without duplicates or conflicts.

Filtering (applied in order: --path-prefix → --include → --exclude):
  Only same-domain links are followed. These flags narrow further:
  --path-prefix /docs/api       Only follow links under this path prefix.
  --include /pattern/           Allowlist — comma-separated prefixes or /regex/.
  --exclude /pattern/           Blocklist — same syntax, wins over --include.

  If a crawl returns fewer pages than expected, check the "Filtered" count
  in the output — a too-narrow --path-prefix is the most common cause.

After crawling:
  llm-docs fixlinks <dir>       Rewrite absolute URLs → relative paths.

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
