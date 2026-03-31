import { chromium } from "playwright";

async function main() {
  const url = process.argv[2] || "https://docs.astro.build/en/getting-started/";
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);

  const info = await p.evaluate(() => {
    const selectors = [
      "main article", "article", "main", '[role="main"]',
      ".content", ".docs-content", "#content", ".markdown-body",
      ".sl-markdown-content", "[data-pagefind-body]",
    ];
    const results = selectors.map(sel => {
      const el = document.querySelector(sel);
      return {
        selector: sel,
        found: !!el,
        htmlLen: el?.innerHTML?.length || 0,
        textLen: el?.textContent?.length || 0,
        preview: el?.textContent?.slice(0, 100) || "",
      };
    });

    // Also check direct children of body
    const bodyChildren = Array.from(document.body.children).map(el => ({
      tag: el.tagName,
      classes: (el as HTMLElement).className?.toString().slice(0, 60),
      id: (el as HTMLElement).id,
      htmlLen: el.innerHTML?.length || 0,
    }));

    return { selectors: results, bodyChildren };
  });

  console.log("Selectors:");
  for (const s of info.selectors) {
    if (s.found) {
      console.log(`  ✅ ${s.selector}: html=${s.htmlLen}, text=${s.textLen}, preview="${s.preview.trim().slice(0,60)}"`);
    }
  }
  console.log("\nBody children:");
  for (const c of info.bodyChildren) {
    console.log(`  <${c.tag} class="${c.classes}" id="${c.id}"> html=${c.htmlLen}`);
  }

  await b.close();
}

main();
