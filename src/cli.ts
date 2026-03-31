#!/usr/bin/env node
/**
 * llm-docs CLI — Scrape JS-heavy doc sites into clean LLM-friendly markdown.
 *
 * Usage:
 *   llm-docs https://reactrouter.com/start/modes --depth 2 --max-urls 50
 */

import { Command } from "commander";
import { crawl } from "./crawl.js";
import { closeBrowser } from "./extract.js";
import { writeOutput } from "./output.js";
import { cacheStats, cacheClear } from "./cache.js";

const program = new Command();

program
  .name("llm-docs")
  .description("Scrape documentation sites into clean LLM-friendly markdown")
  .version("0.1.0")
  .argument("<url>", "Documentation URL to scrape")
  .option("-d, --depth <n>", "Crawl depth (0 = single page)", "0")
  .option("-m, --max-urls <n>", "Maximum pages to scrape", "50")
  .option("-c, --concurrency <n>", "Concurrent page fetches", "5")
  .option("-o, --output <dir>", "Output directory (default: auto-generated)")
  .option("-p, --path-prefix <prefix>", "Only follow links under this path")
  .option("--wait <ms>", "Wait time for JS rendering (ms)", "3000")
  .option("--timeout <ms>", "Page load timeout (ms)", "30000")
  .option("--no-filter", "Disable content filtering")
  .option("--no-readability", "Disable Readability (use raw body)")
  .option("--no-cache", "Skip file cache (~/.cache/llm-docs)")
  .action(async (url: string, opts: Record<string, string | boolean>) => {
    const depth = parseInt(opts.depth as string, 10);
    const maxUrls = parseInt(opts.maxUrls as string, 10);
    const concurrency = parseInt(opts.concurrency as string, 10);
    const waitFor = parseInt(opts.wait as string, 10);
    const timeout = parseInt(opts.timeout as string, 10);
    const useFilter = opts.filter !== false;
    const useReadability = opts.readability !== false;
    const noCache = opts.cache === false;
    const pathPrefix = (opts.pathPrefix as string) || "";
    const outDir = (opts.output as string) || generateOutputDir(url);

    console.log(`\n🔍 llm-docs — Scraping documentation`);
    console.log(`   URL:         ${url}`);
    console.log(`   Depth:       ${depth}`);
    console.log(`   Max pages:   ${maxUrls}`);
    console.log(`   Concurrency: ${concurrency}`);
    if (pathPrefix) console.log(`   Path prefix: ${pathPrefix}`);
    console.log(`   Cache:       ${noCache ? "disabled" : "~/.cache/llm-docs"}`);
    console.log(`   Output:      ${outDir}/`);
    console.log();

    try {
      const result = await crawl(url, {
        depth,
        maxUrls,
        concurrency,
        pathPrefix,
        noCache,
        waitFor,
        timeout,
        useReadability,
        onPageStart: (pageUrl, current, total) => {
          const short = shortenUrl(pageUrl);
          process.stdout.write(
            `\r  [${current}/${total}] 🔄 ${short}`.padEnd(80)
          );
        },
        onPageComplete: (pageResult, current, total) => {
          const short = shortenUrl(pageResult.url);
          const kb = (pageResult.markdown.length / 1024).toFixed(1);
          const fromCache = pageResult.elapsed === 0;
          const timing = fromCache ? "cached" : `${pageResult.elapsed}ms`;
          process.stdout.write(
            `\r  [${current}/${total}] ${fromCache ? "📦" : "✅"} ${short} (${kb}KB, ${timing})`.padEnd(
              80
            ) + "\n"
          );
        },
        onPageError: (pageUrl, error) => {
          const short = shortenUrl(pageUrl);
          process.stdout.write(
            `\r  ❌ ${short}: ${error.message}`.padEnd(80) + "\n"
          );
        },
      });

      // Write output tree
      const { files, totalBytes } = writeOutput({
        outDir,
        startUrl: url,
        result,
        useFilter,
      });

      // Summary
      const totalKb = (totalBytes / 1024).toFixed(1);
      const totalSec = (result.totalTime / 1000).toFixed(1);
      console.log(`\n✨ Done!`);
      console.log(
        `   Pages:   ${result.pages.length} scraped, ${result.errors.length} errors`
      );
      console.log(`   Output:  ${files} files in ${outDir}/ (${totalKb}KB)`);
      console.log(`   Entry:   ${outDir}/LLMTOC.md`);
      console.log(`   Time:    ${totalSec}s`);
    } catch (err) {
      console.error(`\n❌ Fatal error: ${err}`);
      process.exitCode = 1;
    } finally {
      await closeBrowser();
    }
  });

/** Generate output dir name from URL */
function generateOutputDir(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/\./g, "-") + "-docs";
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
  .description("Manage the file cache (~/.cache/llm-docs)")
  .option("--clear", "Clear all cached pages")
  .option("--stats", "Show cache statistics")
  .action((opts: Record<string, boolean>) => {
    if (opts.clear) {
      const count = cacheClear();
      console.log(`🗑️  Cleared ${count} cached entries.`);
    } else {
      const s = cacheStats();
      console.log(`📦 Cache: ${s.entries} entries, ${s.sizeKb}KB`);
      console.log(`   Location: ~/.cache/llm-docs`);
    }
  });

program.parse();
