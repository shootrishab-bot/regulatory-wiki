/**
 * NSDI (National Spatial Data Infrastructure) scraper -- nsdi.gov.in.
 * Real, confirmed live 2026-08-17 via direct DOM inspection (unverified
 * before this build -- inspected per the build brief's own instruction,
 * not guessed):
 *
 *   nsdi.gov.in itself 301-redirects to www.nsdi.gov.in, which is real and
 *   reachable (200). Genuinely different CMS from every other DST source --
 *   static, hand-written HTML (`.html` files, no Drupal/CMS templating, no
 *   pagination). Real content is extremely thin: exactly 4 distinct real
 *   documents exist across the ENTIRE site, confirmed by checking every
 *   real nav destination (index/home, nsdihistory, about, org, and the
 *   "NSDI METADATA STANDARDS" page nsdimetada.html, which itself
 *   302-redirects to a URL missing the .html extension) -- all of them
 *   repeat the exact same shared-header 2 links, and none add anything
 *   beyond the 2 more found on the homepage's own footer. All 4 real
 *   documents are reachable directly from the homepage alone, so that's
 *   the only page this scrapes.
 *
 *   REAL, CONFIRMED: a 5th nav item ("IDSF Monthly Report", pointing at
 *   `http://192.168.1.196:5000` -- a private LAN address, unreachable from
 *   outside DST's own network even if it were real) is NOT actually live on
 *   the page -- its real markup is HTML-commented-out in the template
 *   (`<!--<li><a href="...">IDSF Monthly Report</a></li>-->`), confirmed by
 *   reading the raw HTML directly, not assumed from the broken-looking URL
 *   alone. Correctly not scraped -- it was never really rendered as a link
 *   in the first place, this isn't a filtering decision.
 *
 * No per-item dates, no category signal -- matches the build brief's
 * expectation for these unverified sources exactly.
 */

import { fetchHtml as fetchWithRetry } from "../fetch";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { REGULATOR_CODE, type DstScrapedDocument } from "../types";

const BASE_URL = "https://www.nsdi.gov.in";
const PAGE_PATH = "/";

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

function parseHomepage(html: string, pageUrl: string): DstScrapedDocument[] {
  const $ = cheerio.load(html);
  const out: DstScrapedDocument[] = [];
  const scrapedAt = new Date().toISOString();

  $('a[href$=".pdf"]').each((_, a) => {
    const $a = $(a);
    const fileUrl = absoluteUrl($a.attr("href"));
    const title = $a.text().trim();
    if (!fileUrl || !title) return;

    out.push({
      sourceId: makeSourceId(pageUrl, title),
      regulator: REGULATOR_CODE,
      sourceCluster: "nsdi",
      listingUrl: pageUrl,
      title,
      fileUrl,
      htmlUrl: null,
      publishedDate: null,
      statusHint: null,
      scrapedAt,
    });
  });

  if (out.length === 0) {
    console.warn(`[scrape:nsdi] 0 rows parsed from ${pageUrl} -- selectors likely need updating`);
  }
  return out;
}

function dedupeBySourceId(docs: DstScrapedDocument[]): DstScrapedDocument[] {
  const seen = new Map<string, DstScrapedDocument>();
  for (const d of docs) seen.set(d.sourceId, d);
  return [...seen.values()];
}

// Checked 2026-09-24: https://www.nsdi.gov.in stopped answering (connection
// timeout) while plain http:// on the same host still serves the page. The
// canonical https URL stays the listing URL, because source_ids are hashed
// from it -- switching it would re-ingest every NSDI document already stored
// as a new one -- and http is only where the bytes are fetched from.
const HTTP_FALLBACK_URL = `http://www.nsdi.gov.in${PAGE_PATH}`;

export async function scrapeNsdi(): Promise<DstScrapedDocument[]> {
  const url = `${BASE_URL}${PAGE_PATH}`;
  console.log(`[scrape:nsdi] fetching ${url}`);
  try {
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.log(`[scrape:nsdi] ${url} failed (${(err as Error).message}); trying ${HTTP_FALLBACK_URL}`);
      html = await fetchHtml(HTTP_FALLBACK_URL);
    }
    const rows = dedupeBySourceId(parseHomepage(html, url));
    console.log(`[scrape:nsdi] ${rows.length} real documents`);
    return rows;
  } catch (err) {
    console.error(`[scrape:nsdi] failed:`, (err as Error).message);
    return [];
  }
}
