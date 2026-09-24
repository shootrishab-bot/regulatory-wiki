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

// Fallback last-page indexes, used only when page 0's pager cannot be read.
// The real value is read from the live pager on every run (readLastPage()):
// these used to be the ONLY source, hardcoded at 21 and 1 on 2026-08-14,
// and by 2026-09-24 the site had grown to ?page=22 and ?page=2, so every run
// was silently dropping the newest-overflowed last page of each feed.
const CIRCULARS_MAX_PAGE_DEFAULT = 22;
const CIRCULARS_ARCHIVE_MAX_PAGE_DEFAULT = 2;

const HTTP_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; TrilegalRegulatoryWikiBot/1.0; +internal-research-tool)",
  Accept: "text/html,application/xhtml+xml",
};

/** sha1(regulator|url|title) -- same convention as labour_adapter.py's _source_id(). */
export function makeSourceId(regulator: string, sourceUrl: string, title: string): string {
  return createHash("sha1").update(`${regulator}|${sourceUrl}|${title}`).digest("hex");
}

/**
 * Statuses that mean "the site is refusing us", as opposed to a page that
 * does not exist. Printed with the "[BLOCKED]" marker lib/sync.ts matches on.
 */
const BLOCK_STATUSES = new Set([401, 403, 429]);

export class BlockedError extends Error {}

// Pauses before each retry. The daily CI run saw pages 19-21 of circulars
// come back 403 after 18 clean pages in a row (sync runs 2026-09-20..23),
// the shape of a rate limit rather than a hard block, so a blocked or
// failed page gets two slower retries before it is given up on.
const RETRY_PAUSES_MS = [5_000, 20_000];

async function fetchHtml(url: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_PAUSES_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_PAUSES_MS[attempt - 1]);
    try {
      const res = await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res.text();
      lastError = BLOCK_STATUSES.has(res.status)
        ? new BlockedError(`HTTP ${res.status} fetching ${url}`)
        : new Error(`HTTP ${res.status} fetching ${url}`);
      if (res.status === 404) break; // retrying a missing page will not help
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error(`failed fetching ${url}`);
}

/** Report one failed fetch, tagging refusals with the "[BLOCKED]" marker. */
function reportFailure(label: string, err: unknown) {
  const message = (err as Error).message;
  if (err instanceof BlockedError) console.error(`[BLOCKED] ${label}: ${message}`);
  else console.error(`[ERROR] ${label}: ${message}`);
}

/**
 * The real last page index from the pager's own "Go to last page" link
 * (`<a href="?page=22" title="Go to last page">`), or null if the page has
 * no pager.
 */
function readLastPage(html: string): number | null {
  const $ = cheerio.load(html);
  const href = $('a[title="Go to last page"]').attr("href");
  const m = href?.match(/[?&]page=(\d+)/);
  return m ? Number(m[1]) : null;
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

/** A circulars page URL without its ?page=N -- the feed it belongs to. */
export function circularsFeedUrl(pageUrl: string): string {
  return pageUrl.replace(/\?page=\d+$/, "");
}

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

      // The id is keyed to the FEED (the page URL without ?page=N) plus the
      // file, never to the page number. It used to hash pageUrl itself, and
      // this feed is newest-first: each new circular pushes every older one
      // down a slot, so rows crossed page boundaries, got a new id, and were
      // ingested again. By 2026-09-24 that had stored 643 rows for ~400 real
      // documents. Title alone is not unique within a feed (387 distinct
      // titles for 402 rows), title + file is. listingUrl is the feed for
      // the same reason: the page a row sat on is stale within weeks.
      // scripts/rekey-saral-sanchar.ts moved the stored rows onto this id.
      const feedUrl = circularsFeedUrl(pageUrl);

      out.push({
        sourceId: makeSourceId(REGULATOR_CODE, feedUrl, `${title}|${fileUrl ?? ""}`),
        regulator: REGULATOR_CODE,
        sourceFeed,
        listingUrl: feedUrl,
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
  const { startPage = 0, delayMs = 750 } = opts;
  let maxPage = opts.maxPage ?? defaultMaxPage;
  const all: ScrapedDocument[] = [];

  for (let page = startPage; page <= maxPage; page++) {
    const url = `${BASE_URL}${path}${page === 0 ? "" : `?page=${page}`}`;
    console.log(`[scrape:${sourceFeed}] fetching page ${page}/${maxPage}: ${url}`);
    try {
      const html = await fetchHtml(url);
      if (page === 0 && opts.maxPage === undefined) {
        const live = readLastPage(html);
        if (live !== null && live !== maxPage) {
          console.log(`[scrape:${sourceFeed}] pager says last page is ${live} (default was ${maxPage})`);
          maxPage = live;
        }
      }
      const rows = parseCircularsPage(html, url, sourceFeed);
      console.log(`[scrape:${sourceFeed}] page ${page}: ${rows.length} rows`);
      all.push(...rows);
    } catch (err) {
      reportFailure(`${sourceFeed} page ${page}`, err);
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
  // Acts & Policies is one page; a failure there must cost only that feed,
  // not the circulars already scraped (it used to reject the whole
  // Promise.all and exit 1 with nothing written).
  const acts = scrapeActsAndPolicies().catch((err) => {
    reportFailure("acts-and-policies", err);
    return [] as ScrapedDocument[];
  });
  // The two paginated feeds run one after the other rather than in
  // parallel: they hit the same host, and doubling the request rate is
  // exactly what the 403s on the later circulars pages were responding to.
  const circulars = await scrapeCircularsFeed(opts);
  const archive = await scrapeCircularsArchiveFeed(opts);
  return dedupeBySourceId([...circulars, ...archive, ...(await acts)]);
}
