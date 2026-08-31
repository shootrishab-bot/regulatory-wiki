/**
 * DST combined watcher+adapter entrypoint: scrapes every wired source
 * cluster, runs each real document through the extraction pipeline
 * (scrapers/dst/extract.ts: direct text -> OCR fallback, cached, boilerplate
 * stripped and converted to Markdown), and writes NormalizedDocument JSON --
 * the same combined-script pattern scrapers/saral-sanchar/watch.ts uses, for
 * the same reason: no intermediate CSV format worth the round-trip.
 *
 * BUILD ORDER (per the build request): dst-core wired first and proven
 * end-to-end alone; dst-calls, nsdi, and aistic are added as their own
 * modules once built, each just another entry in SOURCE_SCRAPERS below.
 *
 * Run via: npx tsx scrapers/dst/watch.ts
 */

import fs from "node:fs";
import path from "node:path";
import { scrapeDstCore } from "./sources/dst-core";
import { scrapeDstCalls } from "./sources/dst-calls";
import { scrapeNsdi } from "./sources/nsdi";
import { scrapeAistic } from "./sources/aistic";
import { extractDocument, shutdownOcr } from "./extract";
import type { DstScrapedDocument } from "./types";

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
  extraction_failed?: boolean;
}

const SOURCE_SCRAPERS: Array<() => Promise<DstScrapedDocument[]>> = [
  scrapeDstCore,
  scrapeDstCalls,
  scrapeNsdi,
  scrapeAistic,
];

function fileExtensionHint(url: string | null): string | null {
  if (!url) return null;
  const ext = url.split(".").pop()?.toLowerCase();
  return ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : null;
}

/**
 * Runs the real extraction pipeline for one document and folds the result
 * into NormalizedDocument's shape.
 *
 * On extraction failure, needs_download is set to FALSE -- REVISED
 * 2026-08-17 from an original design that left it true so lib/ingest.ts's
 * own (weaker, PDF-only, no-OCR) extraction would get a second try. That
 * was reasonable when failures looked rare; real evidence says otherwise
 * for DST -- 317 of 692 real documents (46%) failed extraction here, mostly
 * genuinely dead files on aistic.gov.in's old archive (confirmed: real
 * HTTP 200 with Content-Length: 0, even with session cookies and a real
 * Referer) plus a few pointing at nsdiclearinghouse.gov.in (confirmed down
 * separately). A "harmless redundant fetch" at that scale is not harmless
 * -- confirmed live: it turned a real batch run into a many-minutes-long
 * stall repeatedly retrying documents already known to be unrecoverable,
 * each paying a real 30s timeout for nothing. Since watch.ts's own
 * extraction already tried BOTH direct text and OCR, a second bare fetch in
 * ingest.ts has no realistic chance of succeeding where both already
 * failed -- needs_download=false skips that pointless retry entirely and
 * goes straight to title-only classification + a real text_extraction_failed
 * flag, same honest signal, none of the wasted time.
 *
 * raw_text_source mapping: OCR'd text reuses "pdf_excerpt" (defined in
 * normalized_document.py as "lower-confidence/partial, flag accordingly")
 * rather than adding a new NormalizedDocument variant just for this one
 * regulator -- OCR output is exactly that: lower-confidence than a clean
 * direct text-layer extraction, which is exactly what that value already
 * means to the rest of the pipeline.
 */
async function normalize(doc: DstScrapedDocument): Promise<NormalizedDocument> {
  const extraction = await extractDocument({
    sourceId: doc.sourceId,
    fileUrl: doc.fileUrl,
    htmlUrl: doc.htmlUrl,
  });

  const base: NormalizedDocument = {
    regulator_code: doc.regulator,
    source_id: doc.sourceId,
    title: doc.title,
    source_url: doc.htmlUrl ?? doc.listingUrl,
    published_date: doc.publishedDate,
    file_url: doc.fileUrl,
    file_extension_hint: fileExtensionHint(doc.fileUrl),
    category_hint: doc.sourceCluster,
    status_hint: doc.statusHint,
    raw_text: null,
    raw_text_source: null,
    needs_download: false,
    scraped_at: doc.scrapedAt,
  };

  if (extraction.method === "failed" || !extraction.text) {
    console.log(`  [extract] FAILED ${doc.title.slice(0, 60)} -- ${extraction.error}`);
    return { ...base, extraction_failed: true };
  }

  console.log(
    `  [extract] ${extraction.method} (${extraction.charCount} chars) ${doc.title.slice(0, 60)}`
  );

  return {
    ...base,
    raw_text: extraction.text,
    raw_text_source:
      extraction.method === "ocr"
        ? "pdf_excerpt"
        : extraction.method === "direct_html"
          ? "html_page"
          : "pdf_full",
    needs_download: false,
  };
}

const OUTPUT_PATH = path.join(__dirname, "..", "data", "dst_normalized.json");

async function main() {
  console.log("Scraping DST (dst-core, dst-calls, nsdi, aistic) ...");
  const scraped: DstScrapedDocument[] = [];
  for (const scraper of SOURCE_SCRAPERS) {
    scraped.push(...(await scraper()));
  }
  console.log(`Scraped ${scraped.length} real documents total.`);

  const byCluster: Record<string, number> = {};
  for (const d of scraped) byCluster[d.sourceCluster] = (byCluster[d.sourceCluster] ?? 0) + 1;
  console.log("By cluster:", byCluster);

  console.log("\nExtracting (direct -> OCR fallback, cached) ...");
  const normalized: NormalizedDocument[] = [];
  for (const doc of scraped) {
    normalized.push(await normalize(doc));
  }
  await shutdownOcr();

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(normalized, null, 2), "utf-8");
  console.log(`\nWrote ${normalized.length} normalized documents to ${OUTPUT_PATH}`);

  const withText = normalized.filter((d) => d.raw_text).length;
  const byMethod: Record<string, number> = {};
  for (const d of normalized) {
    const key = d.raw_text_source ?? "none";
    byMethod[key] = (byMethod[key] ?? 0) + 1;
  }
  console.log(`  documents with extracted text: ${withText}/${normalized.length}`);
  console.log("  by raw_text_source:", byMethod);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
