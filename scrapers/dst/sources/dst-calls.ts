/**
 * DST funding calls scraper -- dst.gov.in/call-for-proposals (current/open
 * calls, no pagination) + dst.gov.in/archive-call-for-proposals (historical
 * calls, paginated). Real, confirmed live 2026-08-17 via direct DOM
 * inspection:
 *
 *   Both pages share the exact same real Drupal Views table: columns
 *   Title | Attachment | Start Date | End Date. Title's own <a> goes to a
 *   real node/detail page (URL pattern varies -- some are
 *   /callforproposals/<slug>, at least one is /callforproposals-0, a
 *   Drupal auto-alias when the natural slug was already taken -- so links
 *   are read generically from the Title cell, never filtered by URL
 *   pattern). Attachment is OFTEN empty (most calls have no separate PDF,
 *   the node page itself IS the real call text) but real when present
 *   (e.g. a real flyer PDF). Start/End Date cells carry the real date
 *   twice: a human DD/MM/YYYY display string AND a machine ISO datetime in
 *   the <span>'s own `content` attribute -- the ISO one is used directly,
 *   no DD/MM/YYYY parsing needed.
 *
 *   Real pager confirmed on the archive page: 18 real pages (0-17, ~20 rows
 *   each, ~360 real historical calls) -- read dynamically from the page's
 *   own "Go to last page" link rather than hardcoded, in case DST adds
 *   more archived calls later.
 *
 *   REAL SITE BUG, confirmed 2026-08-17 across every row checked on both
 *   pages: the End Date cell's <span>'s own machine-readable `content`
 *   attribute is WRONG -- it duplicates the Start Date's value verbatim,
 *   while the human-visible DD/MM/YYYY text in that same span is correct
 *   (e.g. one real row: Start Date content="2026-06-15...", End Date
 *   content ALSO says "2026-06-15..." but its own displayed text reads
 *   "03/09/2026"). Trusting the End Date's `content` attribute would have
 *   made every single call look like it ended the same day it started --
 *   confirmed by a first real run of this scraper, where 350/350 documents
 *   came back statusHint="Closed" including calls with a real, still-future
 *   display end date. Fixed by parsing BOTH dates from their own display
 *   text (DD/MM/YYYY) instead of the `content` attribute, not just the
 *   buggy one -- consistency over relying on a field this site has already
 *   proven unreliable once.
 *
 * statusHint: the real End Date is ground truth for Open vs Closed -- same
 * mechanism as MTCTE's Active/Expired status_hint (see lib/ingest.ts's
 * STATUS_HINT_TO_NAME), just derived here instead of read directly off a
 * site column. A call whose End Date has passed is definitively "Closed",
 * not a matter of classifier judgment.
 */

import { fetchHtml as fetchWithRetry } from "../fetch";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { REGULATOR_CODE, type DstScrapedDocument } from "../types";

const BASE_URL = "https://dst.gov.in";
const CURRENT_PATH = "/call-for-proposals";
const ARCHIVE_PATH = "/archive-call-for-proposals";
const MAX_ARCHIVE_PAGE_FALLBACK = 25; // used only if the real "last page" link can't be found

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Real display text is DD/MM/YYYY (e.g. "03/09/2026") -- see module
// docstring's SITE BUG note for why this is used instead of the span's own
// `content` attribute.
function parseDisplayDate(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function statusFromEndDate(endDateIso: string | null): string | null {
  if (!endDateIso) return null;
  const end = new Date(endDateIso);
  if (isNaN(end.getTime())) return null;
  return end.getTime() >= Date.now() ? "Open" : "Closed";
}

function parseCallsTable(html: string, pageUrl: string): DstScrapedDocument[] {
  const $ = cheerio.load(html);
  const out: DstScrapedDocument[] = [];
  const scrapedAt = new Date().toISOString();

  $("table.views-table tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const $titleCell = $tr.find("td.views-field-title").first();
    const $a = $titleCell.find("a[href]").first();
    const title = $a.text().trim();
    const htmlUrl = absoluteUrl($a.attr("href"));
    if (!title || !htmlUrl) return;

    const $attachmentLink = $tr.find("td.views-field-field-attached a[href]").first();
    const attachmentHref = $attachmentLink.attr("href");
    const fileUrl = attachmentHref ? absoluteUrl(attachmentHref) : null;

    // Real column order confirmed live: Title | Attachment | Start Date | End Date --
    // the two date cells have no distinguishing class, so they're read positionally
    // (3rd/4th <td>), same as their real position in the table header. Both parsed
    // from display text, not the `content` attribute -- see module docstring's
    // real site-bug note (End Date's `content` duplicates Start Date's).
    const $dateCells = $tr.find("td");
    const startDate = parseDisplayDate($($dateCells.get(2)).find("span.date-display-single").text());
    const endDate = parseDisplayDate($($dateCells.get(3)).find("span.date-display-single").text());

    out.push({
      sourceId: makeSourceId(pageUrl, title),
      regulator: REGULATOR_CODE,
      sourceCluster: "dst-calls",
      listingUrl: pageUrl,
      title,
      fileUrl,
      htmlUrl,
      publishedDate: startDate,
      statusHint: statusFromEndDate(endDate),
      scrapedAt,
    });
  });

  if (out.length === 0) {
    console.warn(`[scrape:dst-calls] 0 rows parsed from ${pageUrl} -- selectors likely need updating`);
  }
  return out;
}

function findLastArchivePage(html: string): number {
  const $ = cheerio.load(html);
  const lastHref = $('a[title="Go to last page"]').attr("href");
  const match = lastHref?.match(/page=(\d+)/);
  return match ? parseInt(match[1], 10) : MAX_ARCHIVE_PAGE_FALLBACK;
}

function dedupeBySourceId(docs: DstScrapedDocument[]): DstScrapedDocument[] {
  const seen = new Map<string, DstScrapedDocument>();
  for (const d of docs) seen.set(d.sourceId, d);
  return [...seen.values()];
}

export async function scrapeDstCalls(): Promise<DstScrapedDocument[]> {
  const all: DstScrapedDocument[] = [];

  const currentUrl = `${BASE_URL}${CURRENT_PATH}`;
  console.log(`[scrape:dst-calls] fetching ${currentUrl}`);
  try {
    const html = await fetchHtml(currentUrl);
    const rows = parseCallsTable(html, currentUrl);
    console.log(`[scrape:dst-calls] current: ${rows.length} rows`);
    all.push(...rows);
  } catch (err) {
    console.error(`[scrape:dst-calls] failed on current calls page:`, (err as Error).message);
  }

  const archivePage0Url = `${BASE_URL}${ARCHIVE_PATH}`;
  console.log(`[scrape:dst-calls] fetching ${archivePage0Url}`);
  let lastPage = 0;
  try {
    const html = await fetchHtml(archivePage0Url);
    lastPage = findLastArchivePage(html);
    const rows = parseCallsTable(html, archivePage0Url);
    console.log(`[scrape:dst-calls] archive page 0/${lastPage}: ${rows.length} rows`);
    all.push(...rows);
  } catch (err) {
    console.error(`[scrape:dst-calls] failed on archive page 0:`, (err as Error).message);
  }

  for (let page = 1; page <= lastPage; page++) {
    const url = `${BASE_URL}${ARCHIVE_PATH}?page=${page}`;
    console.log(`[scrape:dst-calls] fetching archive page ${page}/${lastPage}`);
    await sleep(500);
    try {
      const html = await fetchHtml(url);
      const rows = parseCallsTable(html, url);
      console.log(`[scrape:dst-calls] archive page ${page}: ${rows.length} rows`);
      all.push(...rows);
    } catch (err) {
      console.error(`[scrape:dst-calls] failed on archive page ${page}:`, (err as Error).message);
    }
  }

  return dedupeBySourceId(all);
}
