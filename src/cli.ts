#!/usr/bin/env node
/**
 * llm-docs CLI — Scrape JS-heavy doc sites into clean LLM-friendly markdown.
 *
 * Usage:
 *   llm-docs https://reactrouter.com/start/modes --depth 2 --max-urls 50
 */

import { Command } from "commander";
import { writeFileSync } from "fs";
import { crawl, CrawlResult } from "./crawl.js";
import { closeBrowser } from "./extract.js";
import { filterMarkdown } from "./filter.js";

const program = new Command();

program
  .name("llm-docs")
  .description("Scrape documentation sites into clean LLM-friendly markdown")
  .version("0.1.0")
  .argument("<url>", "Documentation URL to scrape")
  .option("-d, --depth <n>", "Crawl depth (0 = single page)", "0")
  .option("-m, --max-urls <n>", "Maximum pages to scrape", "50")
  .option("-c, --concurrency <n>", "Concurrent page fetches", "5")
  .option("-o, --output <file>", "Output file path (default: auto-generated)")
  .option("-p, --path-prefix <prefix>", "Only follow links under this path")
  .option("--wait <ms>", "Wait time for JS rendering (ms)", "3000")
  .option("--timeout <ms>", "Page load timeout (ms)", "30000")
  .option("--no-filter", "Disable content filtering")
  .option("--no-readability", "Disable Readability (use raw body)")
  .action(async (url: string, opts: Record<string, string | boolean>) => {
    const depth = parseInt(opts.depth as string, 10);
    const maxUrls = parseInt(opts.maxUrls as string, 10);
    const concurrency = parseInt(opts.concurrency as string, 10);
    const waitFor = parseInt(opts.wait as string, 10);
    const timeout = parseInt(opts.timeout as string, 10);
    const useFilter = opts.filter !== false;
    const useReadability = opts.readability !== false;
    const pathPrefix = (opts.pathPrefix as string) || "";
    const outputPath =
      (opts.output as string) || generateOutputPath(url);

    console.log(`\n🔍 llm-docs — Scraping documentation`);
    console.log(`   URL:         ${url}`);
    console.log(`   Depth:       ${depth}`);
    console.log(`   Max pages:   ${maxUrls}`);
    console.log(`   Concurrency: ${concurrency}`);
    if (pathPrefix) console.log(`   Path prefix: ${pathPrefix}`);
    console.log(`   Output:      ${outputPath}`);
    console.log();

    try {
      const result = await crawl(url, {
        depth,
        maxUrls,
        concurrency,
        pathPrefix,
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
          process.stdout.write(
            `\r  [${current}/${total}] ✅ ${short} (${kb}KB, ${pageResult.elapsed}ms)`.padEnd(
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

      // Build combined markdown
      const combined = buildOutput(url, result, useFilter);

      // Write output
      writeFileSync(outputPath, combined, "utf-8");

      // Summary
      const totalKb = (combined.length / 1024).toFixed(1);
      const totalSec = (result.totalTime / 1000).toFixed(1);
      console.log(`\n✨ Done!`);
      console.log(`   Pages:   ${result.pages.length} scraped, ${result.errors.length} errors`);
      console.log(`   Output:  ${outputPath} (${totalKb}KB)`);
      console.log(`   Time:    ${totalSec}s`);
    } catch (err) {
      console.error(`\n❌ Fatal error: ${err}`);
      process.exitCode = 1;
    } finally {
      await closeBrowser();
    }
  });

/** Build the final combined markdown output */
function buildOutput(
  startUrl: string,
  result: CrawlResult,
  useFilter: boolean
): string {
  const sections: string[] = [];

  // Header with metadata
  const hostname = new URL(startUrl).hostname;
  sections.push(`# ${hostname} Documentation\n`);
  sections.push(
    `> Scraped from [${startUrl}](${startUrl}) — ${result.pages.length} pages, ${new Date().toISOString()}\n`
  );

  if (result.pages.length > 1) {
    // Table of contents
    sections.push(`## Table of Contents\n`);
    for (const page of result.pages) {
      const path = new URL(page.url).pathname;
      const anchor = slugify(page.url);
      sections.push(`- [${page.title || path}](#${anchor})`);
    }
    sections.push("");
  }

  // Page contents
  for (const page of result.pages) {
    if (result.pages.length > 1) {
      sections.push(`---\n`);
      const anchor = slugify(page.url);
      sections.push(`<a id="${anchor}"></a>\n`);
      sections.push(`> Source: ${page.url}\n`);
    }

    let content = page.markdown;
    if (useFilter) {
      content = filterMarkdown(content);
    }
    sections.push(content);
    sections.push("");
  }

  return sections.join("\n");
}

/** Generate output filename from URL */
function generateOutputPath(url: string): string {
  try {
    const u = new URL(url);
    const parts = [
      u.hostname.replace(/\./g, "-"),
      ...u.pathname
        .split("/")
        .filter(Boolean)
        .slice(0, 2),
    ];
    return parts.join("-") + "-docs.md";
  } catch {
    return "docs.md";
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

/** Create a URL slug for anchors */
function slugify(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname
      .replace(/^\//, "")
      .replace(/\/$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();
  } catch {
    return "page";
  }
}

program.parse();
