/**
 * DST extraction pipeline: PDF/HTML -> boilerplate-stripped Markdown, with an
 * OCR fallback for scanned/image PDFs. Its own stage, separate from both
 * scraping and classification -- lib/ingest.ts's own getFullText() is NOT
 * used for DST; this module's output is written straight into
 * NormalizedDocument.raw_text (with raw_text_source already set), so
 * lib/ingest.ts's PDF-only, no-OCR extraction is skipped entirely for this
 * regulator.
 *
 * Two real, confirmed-working pieces this relies on, both already available
 * in this project with ZERO new dependencies beyond turndown (HTML->Markdown,
 * added here -- there was no existing choice in the repo to reuse):
 *   - pdf-parse v2's own PDFParse.getScreenshot() renders a PDF page to a
 *     real raster image buffer in Node (backed by pdfjs-dist + @napi-rs/canvas,
 *     both already transitive deps of pdf-parse -- confirmed installed and
 *     working via a live smoke test against a real Saral Sanchar PDF,
 *     2026-08-17: real 1190x1684 image, real OCR text recovered).
 *   - tesseract.js was already a project dependency before this build.
 *
 * CACHING: every extraction result is written to scrapers/dst/cache/ as a
 * <sourceId>.md (the final Markdown) + <sourceId>.meta.json (method, char
 * count, error) pair. Re-running classification during taxonomy iteration
 * reads the cache instead of re-extracting -- extraction (especially OCR)
 * is the slow, expensive step; classification prompt/taxonomy iteration
 * should not have to pay for it repeatedly. Delete a cache entry to force
 * re-extraction for that one document.
 */

import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { createWorker, type Worker } from "tesseract.js";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const CACHE_DIR = path.join(__dirname, "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Below this many real characters, direct extraction is treated as having
// failed (a scanned PDF's text layer is usually either empty or a handful
// of garbage characters from a stray OCR layer some scanners embed) --
// triggers the OCR fallback rather than sending near-nothing to the
// classifier and calling it done.
const MIN_DIRECT_CHARS = 200;
// Same threshold, applied to OCR's own output -- if OCR ALSO can't clear
// this bar (blank page, totally illegible scan), the document is flagged
// failed rather than silently accepted with garbage text.
const MIN_OCR_CHARS = 100;
// Real cap on how many pages get OCR'd per document -- OCR is slow (one
// tesseract.js recognize() call per page) and DST's older gazette
// notifications/OMs are rarely more than a handful of pages; a runaway
// hundred-page scan should not stall the whole batch. Matches this
// project's established pattern of a defensive page/size cap (e.g.
// aptel_watcher.py's HARD_CAP for semantic extraction).
const MAX_OCR_PAGES = 15;

export type ExtractionMethod = "direct_pdf" | "direct_html" | "ocr" | "failed";

export interface ExtractionResult {
  text: string | null;
  method: ExtractionMethod;
  charCount: number;
  error: string | null;
}

interface CachedMeta {
  method: ExtractionMethod;
  charCount: number;
  error: string | null;
  extractedAt: string;
}

function cachePaths(sourceId: string) {
  return {
    md: path.join(CACHE_DIR, `${sourceId}.md`),
    meta: path.join(CACHE_DIR, `${sourceId}.meta.json`),
  };
}

function readCache(sourceId: string): ExtractionResult | null {
  const { md, meta } = cachePaths(sourceId);
  if (!fs.existsSync(meta)) return null;
  try {
    const parsedMeta: CachedMeta = JSON.parse(fs.readFileSync(meta, "utf-8"));
    const text = fs.existsSync(md) ? fs.readFileSync(md, "utf-8") : null;
    return { text, method: parsedMeta.method, charCount: parsedMeta.charCount, error: parsedMeta.error };
  } catch {
    return null; // corrupt cache entry -- re-extract rather than crash
  }
}

function writeCache(sourceId: string, result: ExtractionResult) {
  const { md, meta } = cachePaths(sourceId);
  if (result.text) fs.writeFileSync(md, result.text, "utf-8");
  const cachedMeta: CachedMeta = {
    method: result.method,
    charCount: result.charCount,
    error: result.error,
    extractedAt: new Date().toISOString(),
  };
  fs.writeFileSync(meta, JSON.stringify(cachedMeta, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Markdown / boilerplate stripping
// ---------------------------------------------------------------------------

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

// Real, generic boilerplate selectors for a Drupal government site (nav,
// footer, accessibility toolbars, breadcrumbs, skip-links) -- refined
// against DST's actual live pages once sources/dst-core.ts inspects real
// DOM, same as the real "Main navigation" / "Dear Applicant," false
// positives found and fixed on eservices.dot.gov.in's own Acts & Policies
// page. Kept as a named, editable list rather than inlined so that
// refinement is a one-line diff, not a re-read of this whole module.
const BOILERPLATE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "script",
  "style",
  "noscript",
  ".skip-link",
  ".breadcrumb",
  "[class*='accessibility']",
  "[class*='toolbar']",
  "[id*='toolbar']",
  ".region-header",
  ".region-footer",
  ".site-footer",
  ".modal",
  ".popup",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
];

/**
 * Isolates real content from a fetched HTML page and converts it to
 * Markdown. `contentSelector` should target the real main-content container
 * once known for a given source (mirrors scrapers/saral-sanchar/scrape.ts's
 * CONTENT_SELECTOR pattern) -- falls back to <body> minus boilerplate when
 * not given, which is a safe but noisier default.
 */
export function htmlToMarkdown(html: string, contentSelector?: string): string {
  const $ = cheerio.load(html);
  BOILERPLATE_SELECTORS.forEach((sel) => $(sel).remove());

  const $content = contentSelector && $(contentSelector).length ? $(contentSelector) : $("body");
  const cleanedHtml = $content.html() ?? "";
  const markdown = turndown.turndown(cleanedHtml);

  // Collapse the runs of blank lines boilerplate-stripping tends to leave
  // behind into at most one, so the classifier isn't burning tokens on
  // whitespace -- the same "don't waste tokens on chrome" motivation the
  // build request itself called out.
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// PDF extraction: direct text layer first, OCR fallback second
// ---------------------------------------------------------------------------

let ocrWorker: Worker | null = null;
async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorker) {
    ocrWorker = await createWorker("eng");
  }
  return ocrWorker;
}

/** Call once after a batch finishes -- releases the tesseract worker process. */
export async function shutdownOcr(): Promise<void> {
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
}

async function extractPdfDirect(buffer: Buffer): Promise<{ text: string; charCount: number }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const text = (parsed.text || "").trim();
    return { text, charCount: text.length };
  } finally {
    await parser.destroy();
  }
}

async function extractPdfViaOcr(buffer: Buffer): Promise<{ text: string; charCount: number }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const pageCount = Math.min(info.total, MAX_OCR_PAGES);
    const shot = await parser.getScreenshot({
      partial: Array.from({ length: pageCount }, (_, i) => i + 1),
      imageBuffer: true,
      imageDataUrl: false,
      scale: 2.0,
    });

    const worker = await getOcrWorker();
    const pageTexts: string[] = [];
    for (const page of shot.pages) {
      if (!page.data) continue;
      const { data } = await worker.recognize(Buffer.from(page.data));
      pageTexts.push(data.text.trim());
    }
    const text = pageTexts.join("\n\n---\n\n").trim();
    return { text, charCount: text.length };
  } finally {
    await parser.destroy();
  }
}

/**
 * Full PDF extraction: direct text layer, falling back to OCR when direct
 * extraction is empty/near-empty (MIN_DIRECT_CHARS) or throws. Both stages
 * are individually fallible and handled -- returns method: "failed" rather
 * than throwing, so a batch run degrades one document at a time instead of
 * crashing.
 */
export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const direct = await extractPdfDirect(buffer);
    if (direct.charCount >= MIN_DIRECT_CHARS) {
      return { text: direct.text, method: "direct_pdf", charCount: direct.charCount, error: null };
    }
  } catch (err) {
    // Direct extraction failing outright (corrupt/encrypted text layer) is
    // itself real signal to try OCR, not a reason to give up -- fall
    // through deliberately.
    console.log(`  [extract] direct PDF extraction failed (${(err as Error).message}), trying OCR`);
  }

  try {
    const ocr = await extractPdfViaOcr(buffer);
    if (ocr.charCount >= MIN_OCR_CHARS) {
      return { text: ocr.text, method: "ocr", charCount: ocr.charCount, error: null };
    }
    return {
      text: null,
      method: "failed",
      charCount: 0,
      error: `OCR produced only ${ocr.charCount} chars (below ${MIN_OCR_CHARS} threshold) -- likely a blank or illegible scan`,
    };
  } catch (err) {
    return { text: null, method: "failed", charCount: 0, error: `OCR failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Orchestration: cache-aware, per-document entrypoint
// ---------------------------------------------------------------------------

export interface ExtractionInput {
  sourceId: string;
  /** A direct PDF file link, when this document is a PDF. */
  fileUrl: string | null;
  /** An HTML node page to extract directly, when there's no PDF (or in
   * addition to needing the page for context) -- e.g. some Call for
   * Proposals pages. */
  htmlUrl: string | null;
  /** Real main-content CSS selector for htmlUrl, once known for this source. */
  htmlContentSelector?: string;
}

/**
 * Cache-aware extraction: returns the cached Markdown immediately if this
 * sourceId was already extracted, otherwise runs the real extraction
 * (PDF direct -> OCR, or HTML -> Markdown) and caches the result before
 * returning it.
 */
export async function extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
  const cached = readCache(input.sourceId);
  if (cached) return cached;

  let result: ExtractionResult;

  if (input.fileUrl) {
    try {
      // REAL BUG FOUND AND FIXED (2026-08-17): this fetch had no timeout,
      // unlike every scraper's own fetchHtml() in this project (all of
      // which set AbortSignal.timeout(30_000)). A real run against
      // aistic.gov.in's old file-serving endpoint hung here indefinitely on
      // one document, silently stalling the entire sequential extraction
      // batch for 15+ minutes with zero further progress until killed by
      // hand -- confirmed by process inspection, not assumed. Every fetch
      // in this file now has the same 30s timeout as the rest of the
      // pipeline, so one bad document degrades to a normal "failed"
      // ExtractionResult instead of hanging the whole run.
      const res = await fetch(input.fileUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        result = { text: null, method: "failed", charCount: 0, error: `HTTP ${res.status} fetching ${input.fileUrl}` };
      } else {
        const buffer = Buffer.from(await res.arrayBuffer());
        result = await extractPdf(buffer);
      }
    } catch (err) {
      result = { text: null, method: "failed", charCount: 0, error: `Fetch failed: ${(err as Error).message}` };
    }
  } else if (input.htmlUrl) {
    try {
      const res = await fetch(input.htmlUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        result = { text: null, method: "failed", charCount: 0, error: `HTTP ${res.status} fetching ${input.htmlUrl}` };
      } else {
        const html = await res.text();
        const markdown = htmlToMarkdown(html, input.htmlContentSelector);
        result =
          markdown.length >= MIN_DIRECT_CHARS
            ? { text: markdown, method: "direct_html", charCount: markdown.length, error: null }
            : { text: null, method: "failed", charCount: markdown.length, error: "HTML page had near-empty real content after boilerplate stripping" };
      }
    } catch (err) {
      result = { text: null, method: "failed", charCount: 0, error: `Fetch failed: ${(err as Error).message}` };
    }
  } else {
    result = { text: null, method: "failed", charCount: 0, error: "No fileUrl or htmlUrl provided" };
  }

  writeCache(input.sourceId, result);
  return result;
}
