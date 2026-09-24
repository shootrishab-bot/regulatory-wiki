/**
 * DST core regulatory scraper -- dst.gov.in's Policies/Acts menu + the
 * Administration & Finance > OMs and Guidelines page. Real, confirmed live
 * 2026-08-17 via direct DOM inspection of all 6 pages (not guessed):
 *
 *   All 5 of {acts-orders, oms-and-guidelines, geospatial,
 *   national-data-sharing-and-accessibility-policy-0, ethical-guidelines}
 *   share ONE real, simple structure: a single
 *   `.view-content .views-row .field-content` container holding a flat
 *   sequence of `<p><a href="....pdf" title="The pdf file Open in new
 *   window">Real Title Text</a></p>` elements. No table, no per-item date
 *   column, no category column -- exactly what the build brief warned to
 *   expect. The anchor's own `title` attribute is a FIXED generic string on
 *   every single link ("The pdf file Open in new window"), never the real
 *   title -- the real title is the link's own text content. Some links wrap
 *   an `<img class="filefield icon">` before the closing `</a>` (a file-type
 *   icon); cheerio's `.text()` already strips it, so this needs no special
 *   handling, just confirmed so a future maintainer doesn't "fix" it by
 *   accident.
 *
 *   The 6th page (st-system-india/science-and-technology-policy-2013) is
 *   genuinely different: a real `<table>` with columns Title / Hindi
 *   Version / English Version, one row per policy revision (currently one
 *   real row: "STI Policy 2013"). Each language column's own link text is
 *   just "View"/"View " (generic, not a real title) -- the real title lives
 *   in that row's own first cell. Handled by a dedicated parser, not the
 *   flat-list one.
 *
 * Dates: confirmed real and inconsistent -- some titles embed a real date
 * ("OM dated 09.03.2026"), most don't. Best-effort regex extraction from the
 * title text per the build brief; null when no clean match, not guessed.
 */

import { fetchHtml as fetchWithRetry } from "../fetch";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { REGULATOR_CODE, type DstScrapedDocument } from "../types";

export type ScrapedDocument = DstScrapedDocument;

const BASE_URL = "https://dst.gov.in";

// Real, confirmed live 2026-08-17 -- see module docstring.
const FLAT_LIST_PAGES = [
  "/acts-orders",
  "/oms-and-guidelines",
  "/geospatial",
  "/national-data-sharing-and-accessibility-policy-0",
  "/ethical-guidelines",
];
const TABLE_PAGE = "/st-system-india/science-and-technology-policy-2013";

const HTTP_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; TrilegalRegulatoryWikiBot/1.0; +internal-research-tool)",
  Accept: "text/html,application/xhtml+xml",
};

function fetchHtml(url: string): Promise<string> {
  return fetchWithRetry(url, HTTP_HEADERS);
}

function absoluteUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return null;
  }
}

function makeSourceId(sourceUrl: string, title: string): string {
  return createHash("sha1").update(`${REGULATOR_CODE}|${sourceUrl}|${title}`).digest("hex");
}

// Best-effort date extraction from title text -- real evidence: dates appear
// as DD.MM.YYYY (e.g. "OM dated 09.03.2026") or DD/MM/YYYY; most titles have
// no date at all, and that's a real absence, not a parsing failure.
const DATE_RE = /(\d{1,2})[./](\d{1,2})[./](\d{4})/;
function extractDateFromTitle(title: string): string | null {
  const m = title.match(DATE_RE);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function isDocumentLink(href: string | undefined): boolean {
  return !!href && /\.(pdf|docx?|xlsx?)(\?.*)?$/i.test(href);
}

// REAL, CONFIRMED live 2026-08-17: the geospatial page has at least one real
// link whose own anchor text is just "Download" -- the real, descriptive
// title lives in the surrounding <p>, written as prose ending in
// " - Download" ("List of Features/Installations ... issued on 15.02.2021 -
// Download"). Falls back to the parent element's own text (with the
// generic word itself stripped off the end) whenever the anchor's own text
// is one of these placeholders, rather than ingesting a real document under
// a useless "Download"/"View" title.
const GENERIC_LINK_TEXT = /^(download|view|click here|read more)\.?$/i;

function resolveTitle($: cheerio.CheerioAPI, $a: cheerio.Cheerio<import("domhandler").Element>): string {
  const linkText = $a.text().trim();
  if (!GENERIC_LINK_TEXT.test(linkText)) return linkText;

  const parentText = $a.parent().text().replace(/\s+/g, " ").trim();
  const stripped = parentText.replace(new RegExp(`\\s*[-–—]?\\s*${linkText}\\s*$`, "i"), "").trim();
  return stripped || parentText || linkText;
}

function parseFlatListPage(html: string, pageUrl: string): ScrapedDocument[] {
  const $ = cheerio.load(html);
  const out: ScrapedDocument[] = [];
  const scrapedAt = new Date().toISOString();

  $("a[href]").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href");
    if (!isDocumentLink(href)) return;

    const fileUrl = absoluteUrl(href);
    if (!fileUrl) return;

    const title = resolveTitle($, $a);
    if (!title) return;

    out.push({
      sourceId: makeSourceId(pageUrl, title),
      regulator: REGULATOR_CODE,
      sourceCluster: "dst-core",
      listingUrl: pageUrl,
      title,
      fileUrl,
      htmlUrl: null,
      statusHint: null,
      publishedDate: extractDateFromTitle(title),
      scrapedAt,
    });
  });

  if (out.length === 0) {
    console.warn(`[scrape:dst-core] 0 rows parsed from ${pageUrl} -- selectors likely need updating`);
  }
  return out;
}

function parseTitleVersionTable(html: string, pageUrl: string): ScrapedDocument[] {
  const $ = cheerio.load(html);
  const out: ScrapedDocument[] = [];
  const scrapedAt = new Date().toISOString();

  const table = $("table").first();
  const headers = table
    .find("th")
    .map((_, th) => $(th).text().trim())
    .get();

  table
    .find("tbody tr")
    .each((_, tr) => {
      const cells = $(tr).find("td");
      if (cells.length === 0) return;
      const baseTitle = $(cells[0]).text().trim();
      if (!baseTitle) return;

      cells.each((i, td) => {
        if (i === 0) return; // the title cell itself, not a document link
        const $a = $(td).find("a[href]").first();
        const href = $a.attr("href");
        if (!isDocumentLink(href)) return;
        const fileUrl = absoluteUrl(href);
        if (!fileUrl) return;

        // Real column header (e.g. "Hindi Version") distinguishes rows that
        // would otherwise share an identical title -- "View"/"View " (the
        // link's own text) is never used as the title, see module docstring.
        const columnLabel = headers[i] ?? `column ${i}`;
        const title = `${baseTitle} (${columnLabel})`;

        out.push({
          sourceId: makeSourceId(pageUrl, title),
          regulator: REGULATOR_CODE,
          sourceCluster: "dst-core",
          listingUrl: pageUrl,
          title,
          fileUrl,
          htmlUrl: null,
          statusHint: null,
          publishedDate: extractDateFromTitle(baseTitle),
          scrapedAt,
        });
      });
    });

  if (out.length === 0) {
    console.warn(`[scrape:dst-core] 0 rows parsed from ${pageUrl} (table parser) -- selectors likely need updating`);
  }
  return out;
}

function dedupeBySourceId(docs: ScrapedDocument[]): ScrapedDocument[] {
  const seen = new Map<string, ScrapedDocument>();
  for (const d of docs) seen.set(d.sourceId, d);
  return [...seen.values()];
}

export async function scrapeDstCore(): Promise<ScrapedDocument[]> {
  const all: ScrapedDocument[] = [];

  for (const path of FLAT_LIST_PAGES) {
    const url = `${BASE_URL}${path}`;
    console.log(`[scrape:dst-core] fetching ${url}`);
    try {
      const html = await fetchHtml(url);
      const rows = parseFlatListPage(html, url);
      console.log(`[scrape:dst-core] ${path}: ${rows.length} rows`);
      all.push(...rows);
    } catch (err) {
      console.error(`[scrape:dst-core] failed on ${path}:`, (err as Error).message);
    }
  }

  const tableUrl = `${BASE_URL}${TABLE_PAGE}`;
  console.log(`[scrape:dst-core] fetching ${tableUrl}`);
  try {
    const html = await fetchHtml(tableUrl);
    const rows = parseTitleVersionTable(html, tableUrl);
    console.log(`[scrape:dst-core] ${TABLE_PAGE}: ${rows.length} rows`);
    all.push(...rows);
  } catch (err) {
    console.error(`[scrape:dst-core] failed on ${TABLE_PAGE}:`, (err as Error).message);
  }

  return dedupeBySourceId(all);
}
