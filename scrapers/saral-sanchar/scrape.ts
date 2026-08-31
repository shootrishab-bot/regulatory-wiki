/**
 * Saral Sanchar / DoT eServices scraper -- eservices.dot.gov.in, the portal
 * behind Saral Sanchar (telecom licensing/authorisation, WPC, SACFA, RoW).
 *
 * NOT the same site as dot.gov.in (Akamai-WAF-blocked elsewhere in this
 * project, see labour_scrape.py's mole_whatsnew comment) -- eservices.dot.gov.in
 * is a plain, unprotected Drupal site. Confirmed live 2026-08-14: every real
 * page fetched here returned a real HTTP 200 with a plain `fetch()`, no
 * Playwright/browser automation needed, unlike dot_watcher.py.
 *
 * Written in TypeScript (not Python, unlike every other scraper in this
 * project) specifically because it needs no browser automation -- the only
 * reason this project's other scrapers are Python is Playwright. Runs via
 * `npx tsx` from the repo root, using the repo's own node_modules (cheerio),
 * not a separate package.json -- see lib/sync.ts's `runtime: "node"` support.
 */

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

export const REGULATOR_CODE = "SARALSANCHAR";

export type SourceFeed = "circulars-notifications" | "circulars-notifications-archive" | "acts-and-policies";

export interface ScrapedDocument {
  sourceId: string;
  regulator: typeof REGULATOR_CODE;
  sourceFeed: SourceFeed;
  listingUrl: string;
  siteCategory: string | null;
  issuedBy: string | null;
  servicesPath: string | null;
  archiveSection: string | null;
  title: string;
  fileUrl: string | null;
  fileSizeLabel: string | null;
  publishedDate: string | null;
  scrapedAt: string;
}

const BASE_URL = "https://eservices.dot.gov.in";
const CIRCULARS_PATH = "/circular-notifications-others";
const CIRCULARS_ARCHIVE_PATH = "/circular-notifications-others-archive";
const ACTS_AND_POLICIES_PATH = "/act-and-rules";

// REAL, CONFIRMED live 2026-08-14 via the page's own pager markup (`<a ...
// title="Go to last page">`): circulars' real last page is ?page=21 (22
// pages, 0-indexed), NOT ?page=20/21-pages as originally assumed by a
// pre-network-access reconstruction -- an off-by-one that would have
// silently dropped the real last page's rows every run. Re-check this each
// run; the site will grow past it.
const CIRCULARS_MAX_PAGE_DEFAULT = 21;
// REAL, CONFIRMED live 2026-08-14, same pager check: the separate real
// Archive feed (linked from the main circulars page's own "Archive" button,
// previously not scraped at all) has 2 real pages (0-1).
const CIRCULARS_ARCHIVE_MAX_PAGE_DEFAULT = 1;

const HTTP_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; TrilegalRegulatoryWikiBot/1.0; +internal-research-tool)",
  Accept: "text/html,application/xhtml+xml",
};

/** sha1(regulator|url|title) -- same convention as labour_adapter.py's _source_id(). */
export function makeSourceId(regulator: string, sourceUrl: string, title: string): string {
  return createHash("sha1").update(`${regulator}|${sourceUrl}|${title}`).digest("hex");
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function absoluteUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeBySourceId(docs: ScrapedDocument[]): ScrapedDocument[] {
  const seen = new Map<string, ScrapedDocument>();
  for (const d of docs) seen.set(d.sourceId, d);
  return [...seen.values()];
}

// ----------------------------------------------------------------------------
// Feed 1 & 1b: Circulars/Notifications/Presentations/Others (paginated table),
// and its separate Archive variant (same real table shape, own pager, linked
// via the main feed's "Archive" button -- see module docstring).
// ----------------------------------------------------------------------------

function parseCircularsPage(html: string, pageUrl: string, sourceFeed: SourceFeed): ScrapedDocument[] {
  const $ = cheerio.load(html);
  const out: ScrapedDocument[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headerText = $table.find("thead").text().toLowerCase();
    const looksRight = headerText.includes("category") && (headerText.includes("published") || headerText.includes("date"));
    if (!looksRight && $table.find("thead").length > 0) return;

    $table.find("tbody tr").each((__, tr) => {
      const cells = $(tr)
        .find("td")
        .map((___, td) => $(td).text().trim())
        .get();
      if (cells.length < 6) return;

      // Expected column order: S.No | Category | Issued By | Services | Title | Download | Published Date
      const [, category, issuedBy, servicesOrTitle, titleOrDownload, , maybeDate] = cells;

      let servicesPath: string | null;
      let title: string;
      let publishedRaw: string | undefined;

      if (cells.length >= 7) {
        servicesPath = servicesOrTitle || null;
        title = titleOrDownload ?? "";
        publishedRaw = maybeDate;
      } else {
        servicesPath = null;
        title = servicesOrTitle ?? "";
        publishedRaw = cells[4];
      }

      const $tds = $(tr).find("td");
      const $downloadCell = $tds.filter((___, td) => $(td).find("a[href]").length > 0).first();
      const $a = $downloadCell.find("a[href]").first();
      const fileUrl = absoluteUrl($a.attr("href"));
      const fileSizeLabel = $a.text().trim() || null;

      if (!title) return;

      out.push({
        sourceId: makeSourceId(REGULATOR_CODE, pageUrl, title),
        regulator: REGULATOR_CODE,
        sourceFeed,
        listingUrl: pageUrl,
        siteCategory: category || null,
        issuedBy: issuedBy || null,
        servicesPath,
        archiveSection: null,
        title,
        fileUrl,
        fileSizeLabel,
        publishedDate: normaliseDate(publishedRaw),
        scrapedAt: new Date().toISOString(),
      });
    });
  });

  if (out.length === 0) {
    console.warn(`[scrape:${sourceFeed}] 0 rows parsed from ${pageUrl} -- selectors likely need updating`);
  }
  return out;
}

export interface ScrapeCircularsOptions {
  maxPage?: number;
  startPage?: number;
  delayMs?: number;
}

async function scrapeCircularsLikeFeed(
  path: string,
  sourceFeed: SourceFeed,
  opts: ScrapeCircularsOptions,
  defaultMaxPage: number
): Promise<ScrapedDocument[]> {
  const { maxPage = defaultMaxPage, startPage = 0, delayMs = 750 } = opts;
  const all: ScrapedDocument[] = [];

  for (let page = startPage; page <= maxPage; page++) {
    const url = `${BASE_URL}${path}${page === 0 ? "" : `?page=${page}`}`;
    console.log(`[scrape:${sourceFeed}] fetching page ${page}/${maxPage}: ${url}`);
    try {
      const html = await fetchHtml(url);
      const rows = parseCircularsPage(html, url, sourceFeed);
      console.log(`[scrape:${sourceFeed}] page ${page}: ${rows.length} rows`);
      all.push(...rows);
    } catch (err) {
      console.error(`[scrape:${sourceFeed}] failed on page ${page}:`, (err as Error).message);
    }
    if (page < maxPage) await sleep(delayMs);
  }

  return all;
}

export async function scrapeCircularsFeed(opts: ScrapeCircularsOptions = {}): Promise<ScrapedDocument[]> {
  return scrapeCircularsLikeFeed(CIRCULARS_PATH, "circulars-notifications", opts, CIRCULARS_MAX_PAGE_DEFAULT);
}

export async function scrapeCircularsArchiveFeed(opts: ScrapeCircularsOptions = {}): Promise<ScrapedDocument[]> {
  return scrapeCircularsLikeFeed(
    CIRCULARS_ARCHIVE_PATH,
    "circulars-notifications-archive",
    opts,
    CIRCULARS_ARCHIVE_MAX_PAGE_DEFAULT
  );
}

// ----------------------------------------------------------------------------
// Feed 2: Acts & Policies (grouped-by-heading archive)
// ----------------------------------------------------------------------------

const DATE_RE = /(\d{2}\/\d{2}\/\d{4})/;
const SIZE_RE = /([\d.]+\s?(?:KB|MB))\s*$/i;

// REAL, CONFIRMED live 2026-08-14: two real false-positive sections found on
// the first run against the live page --
//   1. "Main navigation": the site's own <nav aria-label="Main navigation">
//      landmark has a visually-hidden <h2>Main navigation</h2> OUTSIDE the
//      real content area, which an unscoped `$("h2, h3, h4")` walk picked up
//      and mis-attributed one real link (a user-manual PDF) to.
//   2. "Dear Applicant,": a real on-page portal-migration notice box (inside
//      the content area) uses an <h4>Dear Applicant,</h4> as its own visual
//      heading -- not a real document-section name.
// Fixed two ways: (a) scope the heading walk to the real content container
// (`main#content`), which alone kills false positive #1, and (b) skip any
// heading whose text ends in a comma or colon (a salutation/sentence
// fragment, never a real section name like "Authorisation" or "Right of Way
// Permissions"), which kills #2 without needing a hardcoded exclusion list.
const CONTENT_SELECTOR = "main#content";
function looksLikeSalutation(text: string): boolean {
  return /[,:]\s*$/.test(text);
}

function parseActsAndPoliciesPage(html: string, pageUrl: string): ScrapedDocument[] {
  const $ = cheerio.load(html);
  const out: ScrapedDocument[] = [];

  const $content = $(CONTENT_SELECTOR);
  const headingSelector = "h2, h3, h4";
  const headings = ($content.length ? $content.find(headingSelector) : $(headingSelector)).toArray();

  headings.forEach((heading) => {
    const $heading = $(heading);
    const sectionTitle = $heading.text().trim();
    if (!sectionTitle || sectionTitle.length > 80 || looksLikeSalutation(sectionTitle)) return;

    let $cursor = $heading.next();
    const hrefs: string[] = [];
    const linkTexts: string[] = [];
    let guard = 0;
    while ($cursor.length && !$cursor.is(headingSelector) && guard < 200) {
      $cursor.find("a[href]").each((_, a) => {
        hrefs.push($(a).attr("href") ?? "");
        linkTexts.push($(a).text());
      });
      if ($cursor.is("a[href]")) {
        hrefs.push($cursor.attr("href") ?? "");
        linkTexts.push($cursor.text());
      }
      $cursor = $cursor.next();
      guard++;
    }

    for (let i = 0; i < hrefs.length; i++) {
      const fileUrl = absoluteUrl(hrefs[i]);
      if (!fileUrl || !/\.(pdf|docx?|xlsx?)$/i.test(fileUrl)) continue;

      const rawText = linkTexts[i].replace(/\s+/g, " ").trim();
      const dateMatch = rawText.match(DATE_RE);
      const sizeMatch = rawText.match(SIZE_RE);
      const publishedRaw = dateMatch?.[1];
      const fileSizeLabel = sizeMatch?.[1] ?? null;

      let title = rawText;
      if (dateMatch) title = title.slice(0, dateMatch.index).trim();
      title = title.replace(SIZE_RE, "").trim();
      if (!title) continue;

      out.push({
        sourceId: makeSourceId(REGULATOR_CODE, pageUrl, title),
        regulator: REGULATOR_CODE,
        sourceFeed: "acts-and-policies",
        listingUrl: pageUrl,
        siteCategory: "Policy, Act and Rules",
        issuedBy: null,
        servicesPath: null,
        archiveSection: sectionTitle,
        title,
        fileUrl,
        fileSizeLabel,
        publishedDate: normaliseDate(publishedRaw ?? null),
        scrapedAt: new Date().toISOString(),
      });
    }
  });

  const deduped = dedupeBySourceId(out);
  if (deduped.length === 0) {
    console.warn(`[scrape:acts-and-policies] 0 rows parsed from ${pageUrl} -- selectors likely need updating`);
  }
  return deduped;
}

export async function scrapeActsAndPolicies(): Promise<ScrapedDocument[]> {
  const url = `${BASE_URL}${ACTS_AND_POLICIES_PATH}`;
  console.log(`[scrape:acts-and-policies] fetching ${url}`);
  const html = await fetchHtml(url);
  const rows = parseActsAndPoliciesPage(html, url);
  console.log(`[scrape:acts-and-policies] ${rows.length} rows`);
  return rows;
}

export async function scrapeAll(opts: ScrapeCircularsOptions = {}): Promise<ScrapedDocument[]> {
  const [circulars, archive, acts] = await Promise.all([
    scrapeCircularsFeed(opts),
    scrapeCircularsArchiveFeed(opts),
    scrapeActsAndPolicies(),
  ]);
  return dedupeBySourceId([...circulars, ...archive, ...acts]);
}
