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
  .option("-d, --depth <n>", "Crawl depth (0 = single page)", "2")
  .option("-m, --max-urls <n>", "Maximum pages to scrape", "50")
  .option("-c, --concurrency <n>", "Concurrent page fetches", "5")
  .option("-o, --output <dir>", "Base directory to write into (default: current directory)")
  .option("-p, --path-prefix <prefix>", "Only follow links under this path")
  .option("-x, --exclude <patterns>", "Exclude URL paths matching patterns (comma-separated, prefix /path or regex /pattern/)", "")
  .option("--wait <ms>", "Wait time for JS rendering (ms)", "3000")
  .option("--timeout <ms>", "Page load timeout (ms)", "30000")
  .option("--no-filter", "Disable content filtering")
  .option("--no-readability", "Disable Readability (use raw body)")
  .option("--no-cache", "Skip file cache")
  .addHelpText("after", `
How to scrape effectively — use the crawler, not loops:
  llm-docs is a BFS crawler, not a single-page fetcher. Let it discover pages
  for you by crawling links — don't manually loop over URLs with --depth 0.

    BAD:  for url in page1 page2 page3; do llm-docs $url -d 0; done
          (serial, slow, misses pages, no link discovery)
    GOOD: llm-docs https://docs.example.com/api -d 2 -m 500
          (one crawl finds everything via links)

  Recommended workflow:
    1. Recon:    llm-docs <url> --depth 1 --max-urls 10
                 Look at what pages were discovered — this reveals the site's
                 link structure (index pages, versioned paths, etc.)
    2. Expand:   llm-docs <url> --depth 2 --max-urls 500
                 Increase depth/max to follow the links you saw in step 1.
                 Cached pages from step 1 are free — only new pages are fetched.
    3. Prune:    delete folders/files you don't need
    4. Repeat:   target sub-sections with higher depth or different path-prefix

  Common pitfalls:
    - If a crawl returns fewer pages than expected, read the fetched files to
      see what links they actually contain. --path-prefix may be filtering out
      real links — sites often use paths that don't match the URL you started
      from: versioned URLs (/2026-04/...) vs aliases (/latest/...), or
      different hierarchies entirely (e.g. you start at /docs/custom-data/
      metafields but links point to /docs/metafields/...). Widen or adjust
      --path-prefix to match the actual link targets.
    - Similarly, if the landing page has few links, try --depth 1 first to find
      index/sitemap pages, then crawl from there with higher depth.
    - Prefer one broad crawl + prune over many narrow depth-0 fetches.
      Each depth-0 call launches a browser, fetches one page, and exits.
      A single depth-2 crawl reuses the browser and follows links in parallel.

  Why this works:
    - File cache is keyed per URL — already-fetched pages are free to revisit
    - --exclude, --path-prefix, and --depth can differ between runs
    - Deleted output files will be regenerated on the next run (cache still warm)
    - Run \`llm-docs fixlinks <dir>\` to convert absolute URLs to relative paths

Output structure:
  Output is a domain-based folder mirroring the site's URL tree:

    $ llm-docs https://shopify.dev/docs/api/admin-graphql --depth 2
    shopify.dev/
      docs/api/admin-graphql.md
      docs/api/admin-graphql/
        2026-04/full-index.md        ← discovered at depth 1
        2026-04/mutations/           ← discovered at depth 2
          productCreate.md
          ...

  The top-level folder is always the hostname (e.g. shopify.dev/).
  Use -o to place it elsewhere. Safe to delete, move, or reorganize.
`)
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
    const exclude = parseExclude((opts.exclude as string) || "");
    const baseDir = (opts.output as string) || ".";
    const outDir = join(baseDir, generateDirName(url));

    console.log(`\n🔍 llm-docs — Scraping documentation`);
    console.log(`   URL:         ${url}`);
    console.log(`   Depth:       ${depth}`);
    console.log(`   Max pages:   ${maxUrls}`);
    console.log(`   Concurrency: ${concurrency}`);
    if (pathPrefix) console.log(`   Path prefix: ${pathPrefix}`);
    if (exclude.length) console.log(`   Exclude:     ${exclude.map(e => e instanceof RegExp ? e.toString() : e).join(", ")}`);
    console.log(`   Cache:       ${noCache ? "disabled" : getCacheDirPath()}`);
    console.log(`   Output:      ${outDir}/`);
    console.log();

    try {
      const result = await crawl(url, {
        depth,
        maxUrls,
        concurrency,
        pathPrefix,
        exclude,
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
      console.log(`   Browse:  ls -R ${outDir}/`);
      console.log(`   Time:    ${totalSec}s`);
      console.log(`\n   Tip: run \`llm-docs fixlinks ${outDir}\` to rewrite absolute URLs → relative paths`);
    } catch (err) {
      console.error(`\n❌ Fatal error: ${err}`);
      process.exitCode = 1;
    } finally {
      await closeBrowser();
      process.exit(process.exitCode ?? 0);
    }
  });

/** Parse --exclude flag: comma-separated, supports /regex/ syntax */
function parseExclude(raw: string): (string | RegExp)[] {
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
