/**
 * Saral Sanchar combined watcher+adapter entrypoint: scrapes all three real
 * feeds (circulars, circulars archive, acts & policies) and writes output
 * directly in the NormalizedDocument shape lib/ingest.ts consumes -- see
 * scrapers/normalized_document.py's dataclass, mirrored here field-for-field
 * since this scraper is TypeScript, not Python (see scrape.ts's docstring
 * for why).
 *
 * One combined script rather than a separate watcher/adapter pair (unlike
 * every Python regulator in this project): there is no intermediate master
 * CSV format to preserve here, and scrape.ts's ScrapedDocument already has
 * everything normalize() below needs, so a CSV round-trip would add a step
 * with nothing to gain from it. lib/sync.ts's RegulatorSync.adapter is
 * optional for exactly this case -- see its own comment.
 *
 * Run via: npx tsx scrapers/saral-sanchar/watch.ts
 */

import fs from "node:fs";
import path from "node:path";
import { scrapeAll, REGULATOR_CODE, type ScrapedDocument } from "./scrape";

// Mirrors scrapers/normalized_document.py's NormalizedDocument field-for-field.
interface NormalizedDocument {
  regulator_code: string;
  source_id: string;
  title: string;
  source_url: string;
  published_date: string | null;
  file_url: string | null;
  file_extension_hint: string | null;
  category_hint: string | null;
  status_hint: string | null;
  raw_text: string | null;
  raw_text_source: "html_page" | "pdf_full" | "pdf_excerpt" | null;
  needs_download: boolean;
  scraped_at: string | null;
}

// NormalizedDocument has one category_hint slot; siteCategory (the site's own
// top-level Category column / "Policy, Act and Rules") is the best single
// real signal, same convention as mib_adapter.py's category_hint mapping.
// issuedBy/servicesPath/archiveSection are real and useful but have no
// dedicated slot -- dropped here, same as MIB's wing_category/
// notifications_category, flagged in case a future NormalizedDocument
// revision adds room for them.
function normalize(doc: ScrapedDocument): NormalizedDocument {
  return {
    regulator_code: doc.regulator,
    source_id: doc.sourceId,
    title: doc.title,
    source_url: doc.listingUrl,
    published_date: doc.publishedDate,
    file_url: doc.fileUrl,
    file_extension_hint: doc.fileUrl ? (doc.fileUrl.split(".").pop()?.toLowerCase() ?? null) : null,
    category_hint: doc.siteCategory,
    status_hint: null,
    raw_text: null,
    raw_text_source: null,
    needs_download: Boolean(doc.fileUrl),
    scraped_at: doc.scrapedAt,
  };
}

const OUTPUT_PATH = path.join(__dirname, "..", "data", "saral_sanchar_normalized.json");

async function main() {
  console.log(`Scraping ${REGULATOR_CODE} (circulars, circulars archive, acts-and-policies) ...`);
  const scraped = await scrapeAll();
  console.log(`Scraped ${scraped.length} real documents total (deduped by sourceId).`);

  const byFeed: Record<string, number> = {};
  for (const d of scraped) byFeed[d.sourceFeed] = (byFeed[d.sourceFeed] ?? 0) + 1;
  console.log("By feed:", byFeed);

  const normalized = scraped.map(normalize);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(normalized, null, 2), "utf-8");
  console.log(`Wrote ${normalized.length} normalized documents to ${OUTPUT_PATH}`);

  const needsDownload = normalized.filter((d) => d.needs_download).length;
  const noDate = normalized.filter((d) => !d.published_date).length;
  console.log(`  needs_download=true: ${needsDownload}`);
  console.log(`  no published_date:   ${noDate}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
