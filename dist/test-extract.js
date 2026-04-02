#!/usr/bin/env tsx
/**
 * Quick test harness for the markdown extractor.
 *
 * Usage:
 *   npm run test-extract -- <url> [url2] [url3]
 *   npm run test-extract -- https://reactrouter.com/start/modes
 *
 * Writes output to ./test-output/<hostname>-<path>.md
 */
import { extractMarkdown, closeBrowser } from "./extract.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
const urls = process.argv.slice(2);
if (urls.length === 0) {
    // Default test URLs — a mix of JS-heavy doc sites
    urls.push("https://reactrouter.com/start/modes", "https://react.dev/learn", "https://docs.astro.build/en/getting-started/");
    console.log("No URLs provided, using defaults:\n", urls.join("\n "));
}
const outDir = join(process.cwd(), "test-output");
mkdirSync(outDir, { recursive: true });
async function run() {
    for (const url of urls) {
        console.log(`\n🔍 Extracting: ${url}`);
        try {
            const result = await extractMarkdown(url);
            // Generate filename from URL
            const urlObj = new URL(url);
            const slug = urlObj.hostname.replace(/\./g, "-") +
                urlObj.pathname.replace(/\//g, "-").replace(/-$/, "");
            const filename = `${slug || "index"}.md`;
            const filepath = join(outDir, filename);
            // Write with metadata header
            const header = [
                `<!-- Source: ${result.url} -->`,
                `<!-- Title: ${result.title} -->`,
                `<!-- Raw HTML: ${(result.rawHtmlLength / 1024).toFixed(1)}KB -->`,
                `<!-- Extracted: ${(result.markdown.length / 1024).toFixed(1)}KB -->`,
                `<!-- Time: ${result.elapsed}ms -->`,
                ``,
            ].join("\n");
            writeFileSync(filepath, header + result.markdown, "utf-8");
            console.log(`  ✅ ${result.title}`);
            console.log(`     HTML: ${(result.rawHtmlLength / 1024).toFixed(1)}KB → MD: ${(result.markdown.length / 1024).toFixed(1)}KB`);
            console.log(`     Links discovered: ${result.links.length}`);
            console.log(`     Time: ${result.elapsed}ms`);
            console.log(`     Written: ${filepath}`);
        }
        catch (err) {
            console.error(`  ❌ Failed: ${err}`);
        }
    }
    await closeBrowser();
    console.log("\n✨ Done! Check ./test-output/");
}
run().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
