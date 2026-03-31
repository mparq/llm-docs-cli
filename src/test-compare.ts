#!/usr/bin/env tsx
/**
 * Compare Playwright extractor vs Firecrawl API output side by side.
 *
 * Usage:
 *   npx tsx src/test-compare.ts <url> [url2] ...
 */

import { extractMarkdown, closeBrowser } from "./extract.js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ||
  readFileSync(join(process.cwd(), ".env"), "utf-8")
    .split("\n")
    .find((l) => l.startsWith("FIRECRAWL_API_KEY="))
    ?.split("=")[1]
    ?.trim();

if (!FIRECRAWL_API_KEY) {
  console.error("❌ No FIRECRAWL_API_KEY found in .env");
  process.exit(1);
}

const urls = process.argv.slice(2);
if (urls.length === 0) {
  urls.push("https://reactrouter.com/start/modes#framework");
}

const outDir = join(process.cwd(), "test-output", "compare");
mkdirSync(outDir, { recursive: true });

function slug(url: string): string {
  const u = new URL(url);
  return (
    u.hostname.replace(/\./g, "-") +
    u.pathname.replace(/\//g, "-").replace(/-$/, "") +
    (u.hash ? u.hash.replace("#", "-") : "")
  );
}

async function firecrawlScrape(url: string): Promise<{ markdown: string; elapsed: number }> {
  const start = Date.now();
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 5000,
      timeout: 30000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${text}`);
  }

  const data = await res.json();
  const markdown = data.data?.markdown || "";
  return { markdown, elapsed: Date.now() - start };
}

function stats(md: string) {
  const lines = md.split("\n").length;
  const chars = md.length;
  const codeBlocks = (md.match(/```/g) || []).length / 2;
  const headings = (md.match(/^#{1,6}\s/gm) || []).length;
  const links = (md.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
  return { lines, chars, kb: (chars / 1024).toFixed(1), codeBlocks: Math.floor(codeBlocks), headings, links };
}

async function run() {
  for (const url of urls) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🔗 ${url}`);
    console.log("=".repeat(70));

    // Run both in parallel
    const [pw, fc] = await Promise.allSettled([
      extractMarkdown(url),
      firecrawlScrape(url),
    ]);

    const s = slug(url);

    // Playwright result
    if (pw.status === "fulfilled") {
      const r = pw.value;
      const st = stats(r.markdown);
      console.log(`\n🎭 Playwright:`);
      console.log(`   Size: ${st.kb}KB (${st.lines} lines)`);
      console.log(`   Headings: ${st.headings} | Code blocks: ${st.codeBlocks} | Links in MD: ${st.links}`);
      console.log(`   Links discovered (raw HTML): ${r.links.length}`);
      console.log(`   Time: ${r.elapsed}ms`);
      writeFileSync(join(outDir, `${s}-playwright.md`), r.markdown, "utf-8");
    } else {
      console.log(`\n🎭 Playwright: ❌ ${pw.reason}`);
    }

    // Firecrawl result
    if (fc.status === "fulfilled") {
      const r = fc.value;
      const st = stats(r.markdown);
      console.log(`\n🔥 Firecrawl:`);
      console.log(`   Size: ${st.kb}KB (${st.lines} lines)`);
      console.log(`   Headings: ${st.headings} | Code blocks: ${st.codeBlocks} | Links: ${st.links}`);
      console.log(`   Time: ${r.elapsed}ms`);
      writeFileSync(join(outDir, `${s}-firecrawl.md`), r.markdown, "utf-8");
    } else {
      console.log(`\n🔥 Firecrawl: ❌ ${fc.reason}`);
    }

    // Quick diff summary
    if (pw.status === "fulfilled" && fc.status === "fulfilled") {
      const pwS = stats(pw.value.markdown);
      const fcS = stats(fc.value.markdown);
      console.log(`\n📊 Comparison:`);
      console.log(`   Size:     PW ${pwS.kb}KB vs FC ${fcS.kb}KB`);
      console.log(`   Headings: PW ${pwS.headings} vs FC ${fcS.headings}`);
      console.log(`   Code:     PW ${pwS.codeBlocks} vs FC ${fcS.codeBlocks}`);
      console.log(`   Links:    PW ${pwS.links} vs FC ${fcS.links}`);
      console.log(`   Speed:    PW ${pw.value.elapsed}ms vs FC ${fc.value.elapsed}ms`);
    }
  }

  await closeBrowser();
  console.log(`\n✨ Files written to ${outDir}/`);
}

run().catch((err) => {
  console.error("Fatal:", err);
  closeBrowser().then(() => process.exit(1));
});
