/**
 * DST International Cooperation Division scraper -- aistic.gov.in/ASEAN/ICDST.
 * Real, confirmed live 2026-08-17 via direct DOM inspection (this domain
 * was explicitly unverified before this build -- inspected per the build
 * brief's own instruction, not guessed):
 *
 *   The bare domain (aistic.gov.in) returns a real HTTP 403; the specific
 *   real path (/ASEAN/ICDST) returns a real 200 with substantial content
 *   (176KB). NOT a Drupal site -- an older, table-layout-based ASP-style
 *   page (three `<table>` elements found are pure visual layout, no real
 *   data in any of them).
 *
 *   REAL, CONFIRMED 2026-08-17 (revised after a first pass undercounted by
 *   ~2.5x): the visible "What's New" marquee (`<p class="marqueenew">`) is
 *   only a small rotating SUBSET (28 real links) of a much larger real
 *   archive that lives elsewhere on the same page as plain
 *   `<p><a href="/ASEAN/AbstractFilePath?FileName=...&PathKey=imrcd_files"
 *   target="_blank">Real Title</a>...</p>` entries -- 373 real
 *   `<a href="...AbstractFilePath...">` tags confirmed by direct grep count
 *   against the raw HTML, ~321 unique href+title pairs.
 *
 *   REAL BUG FOUND (2026-08-17): cheerio's own parsed DOM tree silently
 *   drops a large fraction of these -- `$("a[href*='AbstractFilePath']")`
 *   found only 149 of the real 373 anchor tags (confirmed: cheerio counted
 *   only 329 total `<a>` elements of ANY kind on this page, already less
 *   than the real number of AbstractFilePath anchors alone). This is a real
 *   HTML-parsing casualty of the page's old, deeply-nested table-layout
 *   markup, not a selector mistake -- confirmed by testing multiple cheerio
 *   parser configs, all landing on the same wrong count. Fixed by parsing
 *   this ONE page with a direct regex against the raw HTML instead of
 *   cheerio's DOM (recovers 372 of the real 373 anchors, ~321 unique after
 *   dedup) -- every other DST source module uses cheerio normally; this is
 *   a deliberate, evidence-backed exception for this one page's broken
 *   markup, not a style regression.
 *
 *   Real duplicates (items appearing in both the marquee subset and the
 *   full list, byte-for-byte identical href+title) collapse naturally via
 *   dedupeBySourceId(). No per-item date text exists anywhere on this page
 *   (the marquee's calendar icon is decorative, no real date follows it),
 *   so publishedDate is genuinely unavailable, not a parsing gap.
 *
 *   The file-serving URL (`/ASEAN/AbstractFilePath?FileName=X&PathKey=
 *   imrcd_files`), NOT a static path the way DST's own site works, is
 *   itself the real, working file link -- confirmed live with a real 200
 *   on a sample entry, not assumed.
 *
 * Scope: applies scrapers/dst/scope.ts's real exclusion filter -- this feed
 * is genuine Calls for Proposals / Results, but at least one confirmed
 * real recruitment ad ("Applications for appointment of Director,
 * Indo-German S&T Centre (IGSTC)") is mixed into the same list.
 *
 * NOTE on the file-serving domain: DST is the real nodal Department for
 * ASEAN-India STI cooperation (confirmed by the page's own "International
 * Cooperation Division" branding and DST_Regulatory_Taxonomy_v2_0.xlsx's
 * Schema Note) -- content here is tagged under the DST regulator, per the
 * build brief, not split into a separate regulator.
 */

import { createHash } from "node:crypto";
import { REGULATOR_CODE, type DstScrapedDocument } from "../types";
import { checkScope } from "../scope";

const BASE_URL = "https://aistic.gov.in";
const PAGE_PATH = "/ASEAN/ICDST";

const HTTP_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; TrilegalRegulatoryWikiBot/1.0; +internal-research-tool)",
  Accept: "text/html,application/xhtml+xml",
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function absoluteUrl(href: string): string | null {
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return null;
  }
}

function makeSourceId(sourceUrl: string, title: string): string {
  return createHash("sha1").update(`${REGULATOR_CODE}|${sourceUrl}|${title}`).digest("hex");
}

// See module docstring's "REAL BUG FOUND" note: direct regex against the raw
// HTML, not cheerio, for this one page -- cheerio's DOM tree silently drops
// most of the real anchors here due to the page's broken table markup.
const LINK_RE = /<a href="(\/ASEAN\/AbstractFilePath\?[^"]*)"[^>]*>([^<]*)<\/a>/g;

function parseWhatsNew(html: string, pageUrl: string): DstScrapedDocument[] {
  const out: DstScrapedDocument[] = [];
  const scrapedAt = new Date().toISOString();
  let excluded = 0;

  for (const match of html.matchAll(LINK_RE)) {
    const [, href, rawTitle] = match;
    const fileUrl = absoluteUrl(href);
    const title = rawTitle.trim();
    if (!fileUrl || !title) continue;

    const scope = checkScope(title);
    if (!scope.inScope) {
      excluded++;
      console.log(`  [scope] EXCLUDED (${scope.reason}): ${title.slice(0, 80)}`);
      continue;
    }

    out.push({
      sourceId: makeSourceId(pageUrl, title),
      regulator: REGULATOR_CODE,
      sourceCluster: "aistic",
      listingUrl: pageUrl,
      title,
      fileUrl,
      htmlUrl: null,
      publishedDate: null, // no real date signal anywhere on this page -- see module docstring
      statusHint: null,
      scrapedAt,
    });
  }

  console.log(`[scrape:aistic] ${out.length} in-scope matches (pre-dedup), ${excluded} excluded as out-of-scope`);
  if (out.length === 0) {
    console.warn(`[scrape:aistic] 0 rows parsed from ${pageUrl} -- selectors likely need updating`);
  }
  return out;
}

function dedupeBySourceId(docs: DstScrapedDocument[]): DstScrapedDocument[] {
  const seen = new Map<string, DstScrapedDocument>();
  for (const d of docs) seen.set(d.sourceId, d);
  return [...seen.values()];
}

export async function scrapeAistic(): Promise<DstScrapedDocument[]> {
  const url = `${BASE_URL}${PAGE_PATH}`;
  console.log(`[scrape:aistic] fetching ${url}`);
  try {
    const html = await fetchHtml(url);
    const rows = dedupeBySourceId(parseWhatsNew(html, url));
    console.log(`[scrape:aistic] ${rows.length} unique real documents after dedup`);
    return rows;
  } catch (err) {
    console.error(`[scrape:aistic] failed:`, (err as Error).message);
    return [];
  }
}
