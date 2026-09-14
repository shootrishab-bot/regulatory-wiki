"""
Labour Law Document Scraper
Clean Playwright -- no stealth, no evasion.
Includes: WAF detection, retry/backoff, sequential requests, archive discovery.
"""

import asyncio
import json
import re
import sys
import time
from datetime import datetime
from urllib.parse import urljoin, urlparse
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup


# --- Configuration ---

# Delay between requests to different sites (seconds)
INTER_SOURCE_DELAY = 3

# Retry configuration
MAX_RETRIES = 3
BASE_BACKOFF = 2  # seconds

# WAF/block signatures to detect in response body or status
BLOCK_SIGNATURES = [
    "cloudflare",
    "incapsula",
    "access denied",
    "blocked",
    "captcha",
    "challenge",
    "please enable javascript",
    "ddos protection",
    "ray id",
    "checking your browser",
]


SOURCES = {
    # REAL, CONFIRMED 2026-08-06: this domain (a "master-labour" staging/
    # preview mirror on the shared digifootprint.gov.in platform, not the
    # production site) returns real HTTP 200 for every real document slug
    # tried (this one, and documents/act-and-policies) but has NO real
    # content behind either -- empty Next.js pageProps, or a silent
    # redirect to a client-rendered /404 page. It is not blocked; it is
    # broken/incomplete.
    #
    # The real production domain, found via this same host's own public
    # sitemap.xml (a passive, standard lookup -- no evasion), is
    # www.labour.gov.in, and the real gazette-notifications URL there is
    # confirmed to exist with exactly 3 real pages
    # (?page=1/2/3, per that sitemap). But www.labour.gov.in is ALSO
    # confirmed blocked via real Playwright requests: HTTP 403, the same
    # Akamai edge signature ("errors.edgesuite.net" reference ID) already
    # seen on this project's other blocked regulators (DoT, MeitY). Verified
    # directly, not assumed.
    #
    # Net real state: there is currently NO working path to real MoLE
    # gazette content. Left pointed at the broken mirror (not swapped to
    # the blocked production URL) since neither yields real data and the
    # mirror at least fails cheaply (fast 200, no retry/backoff wasted).
    # Do not re-attempt without new evidence the block has lifted.
    "mole_gazette": {
        "url": "https://master-labour.digifootprint.gov.in/documents/gazettes-notifications",
        "wait_selector": "table, .views-table, .document-list, tbody tr",
        "base_url": "https://master-labour.digifootprint.gov.in",
        "archive_discovery": True,
    },
    # REAL, CONFIRMED 2026-08-06: HTTP 403, Akamai edge block
    # ("errors.edgesuite.net" reference ID in the real response body),
    # reproduced 3/3 real attempts via the scraper's own retry logic.
    # Same real conclusion as mole_gazette above: labour.gov.in in any
    # form (bare or www) is blocked right now. Do not re-attempt without
    # new evidence the block has lifted.
    "mole_whatsnew": {
        "url": "https://labour.gov.in/",
        "wait_selector": ".whats-new, #block-views-whats-new-block, .view-whats-new",
        "base_url": "https://labour.gov.in",
        "archive_discovery": True,
    },
    # DEAD as of 2026-09-09 -- DO NOT USE, and do not "fix" by retrying it.
    # EPFO migrated its whole site: the apex host epfindia.gov.in no longer
    # accepts TCP connections on 443 or 80 at all, and this exact path
    # returns HTTP 404 on the replacement host (www.epfo.gov.in). Both
    # verified directly. The live replacement is
    # https://www.epfo.gov.in/circulars/, which is plain server-rendered HTML
    # and so is scraped WITHOUT Playwright -- see labour_watcher_epfo.py,
    # which no longer reads this dict at all. Kept here rather than deleted
    # so the note itself survives for the next person who goes looking.
    #
    # Historical (accurate when written, 2026-08-06): single real page, 371
    # real document rows, no pagination.
    "epfo_updates": {
        "url": "https://epfindia.gov.in/site_en/Updates.php",
        "wait_selector": "table, .content-table, tbody tr",
        "base_url": "https://epfindia.gov.in",
        "archive_discovery": True,
    },
    # DEAD as of 2026-09-09 -- same site migration as epfo_updates above,
    # same 404 on the replacement host, same replacement page. See that
    # entry's note and labour_watcher_epfo.py.
    #
    # Historical (accurate when written, 2026-08-06): single real page, 91
    # real document rows, no pagination.
    "epfo_circulars": {
        "url": "https://epfindia.gov.in/site_en/circulars.php",
        "wait_selector": "table, .content-table, tbody tr",
        "base_url": "https://epfindia.gov.in",
        "archive_discovery": False,
    },
    # REAL, CONFIRMED 2026-08-06: the old URL (www.esic.nic.in/notifications)
    # was dead on two independent counts -- TLS cert for that hostname is
    # issued for a DIFFERENT domain (*.esic.gov.in), confirmed via direct
    # cert inspection, and /notifications is a genuine 404 even on the
    # correct domain (no such page exists in the real nav at all). Real
    # site migrated to esic.gov.in; real nav's closest equivalent to
    # "notifications" is /circulars ("Instructions/Circular/Orders"), which
    # is what this now points at. Confirmed live and current (contained a
    # document dated the day of this investigation). Real pagination is
    # /circulars/index/page:N -- a colon-separated style, not the query-
    # param style the other sources use; see ARCHIVE_PATTERNS below.
    #
    # REAL, CONFIRMED 2026-08-06 (this pass): the pager's own "Next" link
    # is NOT trustworthy as a last-page signal -- direct inspection of a
    # deep page (page:15) showed "Next" rendered with aria-label="Next"
    # but an href pointing at page:14 (the PREVIOUS page), a genuine site
    # bug, not a parsing artifact. There is also no total-record-count
    # text anywhere on the page. Real stopping signal used instead: each
    # page holds exactly 10 real data rows until the genuine last page,
    # which holds fewer -- see PAGE_SIZE_HINTS and fetch_all_pages().
    "esic": {
        "url": "https://esic.gov.in/circulars",
        "wait_selector": "table, tbody tr",
        "base_url": "https://esic.gov.in",
        "archive_discovery": True,
        "pagination": {"style": "colon_path", "path_template": "/index/page:{n}"},
    },
    # REAL, CONFIRMED 2026-08-06: the old URL (https://clc.gov.in/) is the
    # bare homepage, not a document listing -- 0 real PDF links on it. Real
    # nav reveals THREE separate real document sections: /clc/circulars
    # ("Circulars/Orders"), /clc/acts-rules/acts-and-rules-0 ("Acts and
    # Rules"), and /clc/min-wages ("Minimum Wages") -- all three now wired
    # up below (previously only circulars was, a real undercount matching
    # this project's MIB precedent). Real pagination confirmed via
    # ?page=N (0-indexed) for all three; the real last page marks itself
    # with a non-linked <li class="pager-current last"> element (confirmed
    # directly on circulars page 1 vs. page 0, which instead shows a
    # separate CLICKABLE "pager-last last" <a> -- the two classes
    # together, with no <a>, is what actually means "you are on the real
    # last page"). See is_last_page().
    "clc": {
        "url": "https://clc.gov.in/clc/circulars",
        "wait_selector": "table, tbody tr",
        "base_url": "https://clc.gov.in",
        "archive_discovery": True,
        "pagination": {"style": "query_param", "param": "page"},
    },
    # REAL, CONFIRMED 2026-08-06: same real Drupal Views-field table shape
    # as circulars (S.No/Title/Date/Download), just a different real
    # column ORDER (Title, Date, Download) and a different real
    # "download" field class -- views-field-field-file-upload-wages, not
    # views-field-field-file-circular. parse_clc() resolves columns by
    # semantic class name already, so it is reused here (generalized to
    # match any "field-file*" class) rather than duplicated. Real
    # pagination: same ?page=N style, exactly 2 real pages, confirmed via
    # the same "pager-current last" marker.
    "clc_min_wages": {
        "url": "https://clc.gov.in/clc/min-wages",
        "wait_selector": "table, tbody tr",
        "base_url": "https://clc.gov.in",
        "archive_discovery": True,
        "pagination": {"style": "query_param", "param": "page"},
    },
    # REAL, CONFIRMED 2026-08-06: genuinely different structure from the
    # other two CLC sections -- a single-column table with NO header row
    # (every <tr> is real data) mixing real relative detail-page slugs
    # (e.g. "industrial-disputes-act") and real absolute PDF paths in the
    # same column. base_url is deliberately set to this LISTING page's own
    # URL, not the site root -- confirmed live that relative slugs only
    # resolve correctly (200, real content) when joined against this
    # page's own URL (see parse_clc_acts_rules() docstring).
    #
    # REAL, CONFIRMED 2026-08-06 (via fetch_all_pages()'s wrap-around
    # guard): this view's ?page=1 is a genuine SITE BUG, not a real second
    # page -- its own pager claims <li class="pager-current last">2</li>
    # (the same real "you are on the last page" marker CLC's other two
    # sections use correctly), but the row content returned is byte-for-
    # byte identical to page 0's 15 rows, confirmed by direct diff. Real
    # total for this section is 15 documents on ONE real page. This is
    # exactly the failure mode the wrap-around guard exists to catch even
    # on a style with a "direct" last-page marker -- caught here despite
    # an earlier manual spot-check (sampling only 3 titles) missing it.
    "clc_acts_rules": {
        "url": "https://clc.gov.in/clc/acts-rules/acts-and-rules-0",
        "wait_selector": "table, tbody tr",
        "base_url": "https://clc.gov.in/clc/acts-rules/acts-and-rules-0",
        "archive_discovery": True,
        "pagination": {"style": "query_param", "param": "page"},
    },
}

# Expected full-page row count, used only by fetch_all_pages() for
# sources with no direct real "last page" marker (see esic above).
PAGE_SIZE_HINTS = {
    "esic": 10,
}

# Real throttling between pages of the SAME source (distinct from
# INTER_SOURCE_DELAY, which is between different sources). Walking many
# real pages of one source back-to-back had no delay logic before this.
INTER_PAGE_DELAY = 1.5

# Defensive cap so a real crawl can never loop forever even if every
# other stopping signal fails.
MAX_PAGES_DEFAULT = 30


def is_blocked(response_status: int, html: str) -> tuple[bool, str]:
    """
    Detect WAF blocks, CAPTCHAs, and anti-bot pages.
    Returns (is_blocked, reason).
    """
    if response_status == 403:
        return True, f"HTTP 403 (WAF/block)"
    if response_status == 429:
        return True, f"HTTP 429 (rate limited)"
    if response_status in [503, 520, 521, 522, 523]:
        return True, f"HTTP {response_status} (protection service)"
    
    html_lower = html.lower()[:5000]  # Check first 5KB
    for sig in BLOCK_SIGNATURES:
        if sig in html_lower:
            return True, f"Block signature: '{sig}'"
    
    # Check if page is essentially empty (possible JS challenge not executed)
    text_content = "".join(html_lower.split())
    if len(text_content) < 200 and response_status == 200:
        return True, "Suspiciously empty page (possible JS challenge)"
    
    return False, ""


async def _fetch_single(browser, url: str, wait_selector):
    """
    Fetch exactly one URL: new context, real headers, block-check. No
    retry loop, no archive discovery -- the single building block that
    both fetch_page() (one-shot entrypoint) and fetch_all_pages() (real
    multi-page crawler) share, so context/header setup and block
    detection live in exactly one place.

    Returns (context, page, result_dict). The context is left OPEN and
    the caller is responsible for closing it -- callers that need
    archive_discovery must use the still-live `page` object first.
    """
    context = await browser.new_context(
        viewport={"width": 1920, "height": 1080},
        locale="en-IN",
        timezone_id="Asia/Kolkata",
    )
    page = await context.new_page()

    await page.set_extra_http_headers({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
    })

    response = await page.goto(url, wait_until="domcontentloaded", timeout=60000)
    response_status = response.status if response else 0

    if wait_selector:
        try:
            await page.wait_for_selector(wait_selector, timeout=15000)
        except Exception:
            pass  # Continue -- content might still be parseable

    await page.wait_for_timeout(2000)
    html = await page.content()
    final_url = page.url

    blocked, block_reason = is_blocked(response_status, html)

    return context, page, {
        "url": url,
        "final_url": final_url,
        "status": response_status,
        "blocked": blocked,
        "block_reason": block_reason,
        "html": html,
        "html_length": len(html),
    }


async def _fetch_with_retry(browser, url: str, wait_selector, label: str, attempt: int = 1):
    """
    _fetch_single() plus the project's standard retry/backoff on both
    exceptions and detected blocks. Returns (context, page, result) on
    success -- context/page are None once retries are exhausted or the
    fetch fails outright, and `result` alone is the final answer.
    """
    try:
        context, page, result = await _fetch_single(browser, url, wait_selector)
    except Exception as e:
        if attempt < MAX_RETRIES:
            backoff = BASE_BACKOFF * (2 ** (attempt - 1))
            print(
                f"[ERROR] {label}: {type(e).__name__}: {e}. "
                f"Retrying in {backoff}s (attempt {attempt + 1}/{MAX_RETRIES})...",
                file=sys.stderr,
            )
            await asyncio.sleep(backoff)
            return await _fetch_with_retry(browser, url, wait_selector, label, attempt + 1)
        print(
            f"[FAILED] {label}: {type(e).__name__} after {MAX_RETRIES} attempts: {e}",
            file=sys.stderr,
        )
        return None, None, {
            "url": url,
            "final_url": None,
            "status": None,
            "blocked": False,
            "error": f"{type(e).__name__}: {e}",
            "html": None,
            "html_length": 0,
        }

    if result["blocked"]:
        await context.close()
        if attempt < MAX_RETRIES:
            backoff = BASE_BACKOFF * (2 ** (attempt - 1))
            print(
                f"[BLOCKED] {label}: {result['block_reason']}. "
                f"Retrying in {backoff}s (attempt {attempt + 1}/{MAX_RETRIES})...",
                file=sys.stderr,
            )
            await asyncio.sleep(backoff)
            return await _fetch_with_retry(browser, url, wait_selector, label, attempt + 1)
        print(
            f"[FAILED] {label}: Blocked after {MAX_RETRIES} attempts. "
            f"Last reason: {result['block_reason']}",
            file=sys.stderr,
        )
        result["html"] = (result["html"] or "")[:2000]  # snippet for diagnosis
        return None, None, result

    return context, page, result


async def fetch_page(browser, source_key: str, attempt: int = 1):
    """Fetch a single page (source's configured base URL) with retry and block detection."""
    config = SOURCES[source_key]
    url = config["url"]
    wait_selector = config.get("wait_selector")

    context, page, result = await _fetch_with_retry(browser, url, wait_selector, source_key)

    if context is None:
        if "error" in result:
            return {
                "source_key": source_key,
                "url": url,
                "final_url": None,
                "status": None,
                "blocked": False,
                "error": result["error"],
                "html": None,
                "html_length": 0,
                "archive_urls": [],
            }
        return {
            "source_key": source_key,
            "url": url,
            "final_url": result["final_url"],
            "status": result["status"],
            "blocked": True,
            "block_reason": result["block_reason"],
            "html": result["html"],
            "html_length": result["html_length"],
        }

    archive_urls = []
    if config.get("archive_discovery"):
        archive_urls = await discover_archives(page, url)
    await context.close()

    return {
        "source_key": source_key,
        "url": url,
        "final_url": result["final_url"],
        "status": result["status"],
        "blocked": False,
        "html": result["html"],
        "html_length": result["html_length"],
        "archive_urls": archive_urls,
        "scraped_at": datetime.utcnow().isoformat(),
    }


async def discover_archives(page, base_url: str) -> list[str]:
    """
    Look for pagination links, archive sections, 'View All', year-based listings,
    and other multi-page content indicators.
    Returns list of discovered URLs to investigate.
    """
    discovered = []
    
    # Common archive/pagination patterns
    archive_patterns = [
        "a[href*='page=']",
        "a[href*='page/']",
        "a[href*='?page']",
        # REAL, CONFIRMED 2026-08-06: esic.gov.in/circulars paginates via
        # /circulars/index/page:2 (colon-separated, not '=' or '/'-terminated)
        # inside a real <div class="paging-option"> that none of the
        # patterns above match. Found by direct inspection of real live
        # HTML, not assumed -- this is a genuinely distinct real
        # pagination style from every other source in this file.
        "a[href*='page:']",
        ".paging-option a",
        ".pager a",
        ".pagination a",
        "a:has-text('View All')",
        "a:has-text('Archive')",
        "a:has-text('Older')",
        "a:has-text('Previous')",
        "a[href*='archive']",
        "a[href*='year']",
        "a[href*='notifications']",
        ".view-all a",
        "#block-views-whats-new-block a",  # Drupal blocks
    ]
    
    for pattern in archive_patterns:
        try:
            links = await page.query_selector_all(pattern)
            for link in links:
                href = await link.get_attribute("href")
                if href:
                    full_url = urljoin(base_url, href)
                    # Deduplicate and filter out self-references
                    if full_url != base_url and full_url not in discovered:
                        discovered.append(full_url)
        except Exception:
            continue
    
    # Also check for year-based dropdowns or filters
    try:
        year_options = await page.query_selector_all("select option[value*='20']")
        for opt in year_options:
            val = await opt.get_attribute("value")
            if val and len(val) >= 4 and val[:4].isdigit():
                # Construct year-filter URL if it's a query param
                if "?" in base_url:
                    year_url = f"{base_url}&year={val}"
                else:
                    year_url = f"{base_url}?year={val}"
                if year_url not in discovered:
                    discovered.append(year_url)
    except Exception:
        pass
    
    return discovered[:20]  # Cap to prevent explosion


def build_page_url(config: dict, page_index: int) -> str:
    """
    Build the real URL for page `page_index` (0-based; 0 is always the
    source's configured base URL) per the source's own real pagination
    style.
    """
    if page_index == 0:
        return config["url"]

    pagination = config["pagination"]
    style = pagination["style"]

    if style == "query_param":
        # Real, confirmed 2026-08-06: CLC's ?page=N is 0-indexed on the
        # site's own side too (page=1 is the SECOND real page), so
        # page_index maps straight through with no offset.
        param = pagination.get("param", "page")
        sep = "&" if "?" in config["url"] else "?"
        return f"{config['url']}{sep}{param}={page_index}"

    if style == "colon_path":
        # Real, confirmed 2026-08-06: ESIC's base URL (page_index=0) has
        # no colon suffix at all; the site's own links number the SECOND
        # real page "page:2" (1-indexed from a human's page 1), so
        # page_index (0-based) maps to human page (page_index + 1).
        human_page = page_index + 1
        path = pagination["path_template"].format(n=human_page)
        return f"{config['url']}{path}"

    raise ValueError(f"Unknown pagination style: {style!r}")


def is_last_page(html: str, style: str) -> bool:
    """
    True if this page's OWN markup says it is the real last page.

    Real, confirmed 2026-08-06 (CLC, query_param style): Drupal's pager
    marks the genuine last page with a plain (non-linked) <li> combining
    BOTH "pager-current" and "last" classes -- e.g.
    <li class="pager-current last">2</li>. On every other page, "last" is
    instead a separate CLICKABLE <a> ("pager-last last"), which does NOT
    match this check (it lacks pager-current). Confirmed by direct
    comparison of circulars page 0 vs. page 1.

    No direct marker exists for colon_path style (ESIC) -- its own
    "Next" link is a confirmed real site bug (see esic's SOURCES
    comment), so that style always returns False here and relies on the
    row-count heuristic in fetch_all_pages() instead.
    """
    if style == "query_param":
        return bool(re.search(r'class="[^"]*\bpager-current\b[^"]*\blast\b[^"]*"', html))
    return False


def _rough_row_signature_and_count(html: str):
    """
    Parser-independent, deliberately crude signal used only for the
    wrap-around guard and the "genuinely empty page" stop condition --
    does not need to be a real title, just something stable enough to
    notice a page repeating earlier content. Returns (first_row_text or
    None, real_data_row_count).
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        return None, 0

    body = table.find("tbody") or table
    data_rows = [r for r in body.find_all("tr") if r.find_all("td")]
    if not data_rows:
        return None, 0

    first_signature = data_rows[0].get_text(" ", strip=True)[:120]
    return first_signature, len(data_rows)


async def fetch_all_pages(browser, source_key: str, max_pages: int = MAX_PAGES_DEFAULT):
    """
    Real multi-page crawler. discover_archives() only ever found
    candidate pagination links; nothing fetched them. This walks a
    source's own real pagination pattern (per its `pagination` config in
    SOURCES) page by page until it hits a real last page, using:

      1. A direct real "last page" marker when the site provides one
         (query_param/CLC style -- see is_last_page()).
      2. A short-page heuristic (fewer real data rows than a full page)
         when no direct marker exists (colon_path/ESIC style, whose
         "Next" link is a confirmed real site bug -- see PAGE_SIZE_HINTS).
      3. A wrap-around guard (this page's first real row repeats an
         earlier page's) as a defensive backstop in case either signal
         above is wrong on some page.
      4. A MAX_PAGES safety cap.

    Sources with no `pagination` config fall back to a single fetch_page()
    call. Returns a list of per-page result dicts (same shape as
    fetch_page()'s return value, each additionally tagged with
    `page_index`), with a real inter-page throttling delay between pages
    of this SAME source (INTER_PAGE_DELAY).
    """
    config = SOURCES[source_key]
    pagination = config.get("pagination")
    if not pagination:
        return [await fetch_page(browser, source_key)]

    style = pagination["style"]
    wait_selector = config.get("wait_selector")
    expected_page_size = PAGE_SIZE_HINTS.get(source_key)

    pages = []
    seen_signatures = []
    page_index = 0
    hit_cap = True

    while page_index < max_pages:
        url = build_page_url(config, page_index)
        label = f"{source_key} page {page_index}"

        if page_index > 0:
            await asyncio.sleep(INTER_PAGE_DELAY)

        context, page, result = await _fetch_with_retry(browser, url, wait_selector, label)
        if context is not None:
            await context.close()

        result = {**result, "source_key": source_key, "page_index": page_index}

        if result.get("blocked") or result.get("error"):
            print(f"[STOP] {label}: blocked/errored, stopping crawl.", file=sys.stderr)
            pages.append(result)
            hit_cap = False
            break

        html = result.get("html") or ""
        signature, row_count = _rough_row_signature_and_count(html)

        if signature is None:
            print(f"[STOP] {label}: no real data rows found, stopping (page not counted).", file=sys.stderr)
            hit_cap = False
            break

        if signature in seen_signatures:
            print(f"[STOP] {label}: repeats an earlier page's content (wrap-around), stopping (page not counted).", file=sys.stderr)
            hit_cap = False
            break

        seen_signatures.append(signature)
        result["scraped_at"] = datetime.utcnow().isoformat()
        pages.append(result)

        if is_last_page(html, style):
            print(f"[DONE] {label}: real last page (pager marker).", file=sys.stderr)
            hit_cap = False
            break

        if expected_page_size is not None and row_count < expected_page_size:
            print(
                f"[DONE] {label}: {row_count} real rows (< full page of {expected_page_size}), real last page.",
                file=sys.stderr,
            )
            hit_cap = False
            break

        page_index += 1

    if hit_cap:
        print(f"[WARN] {source_key}: hit MAX_PAGES cap ({max_pages}) without a confirmed real last page.", file=sys.stderr)

    return pages


# REAL, CONFIRMED 2026-08-06: EPFO Circulars' year control ("Select
# Division (Current Year)") is NOT a URL-pagination pattern -- it is a
# genuine jQuery AJAX call the page's own <select id="dd"> triggers on
# change: $('#tbl_body').load('get_cir_content.php', {yr: $('#dd').val()}).
# Confirmed real and working by driving the actual control via Playwright
# and observing real, different table content per year (2024-2025
# returned 361 real rows vs. the current-year default's 91). These are
# the exact real <option value="..."> entries the site's own dropdown
# lists (read directly from its HTML) -- prior years genuinely ARE
# reachable, this is not "current fiscal year only" as first assumed.
# The blank/default option (current year) is deliberately excluded here;
# it is already covered by the normal fetch_page("epfo_circulars") path.
EPFO_CIRCULARS_YEARS = [
    "2025-2026", "2024-2025", "2023-2024", "2022-2023", "2021-2022",
    "2020-2021", "2019-2020", "2018-2019", "2017-2018", "2016-2017",
    "2015-2016", "2014-2015", "2013-2014", "2012-2013", "2011-2012",
    "2010-2011", "2009-2010", "Old Circulars",
]


async def fetch_epfo_circulars_history(browser, years: list = None):
    """
    Real multi-year crawler for EPFO Circulars. Unlike fetch_all_pages()
    (URL-based pagination), this drives the page's own real AJAX dropdown
    in a single browser session: one navigation, then one real
    select_option() + content-change wait per year, since the site swaps
    #tbl_body's content in place rather than issuing a new page load.

    Returns a list of dicts (one per year), each with the same "html"/
    "blocked" shape fetch_page() produces so parse_epfo_circulars() and
    validate_parser_result() work unchanged on every year's snapshot.
    """
    config = SOURCES["epfo_circulars"]
    years = years if years is not None else EPFO_CIRCULARS_YEARS

    context = await browser.new_context(
        viewport={"width": 1920, "height": 1080},
        locale="en-IN",
        timezone_id="Asia/Kolkata",
    )
    page = await context.new_page()
    await page.set_extra_http_headers({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    })

    results = []
    try:
        response = await page.goto(config["url"], wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector("#dd", timeout=15000)
    except Exception as e:
        await context.close()
        print(f"[FAILED] epfo_circulars_history: could not load base page: {type(e).__name__}: {e}", file=sys.stderr)
        return results

    for year in years:
        label = f"epfo_circulars_history year {year}"
        try:
            before = await page.eval_on_selector(
                "#tbl_body tr:nth-child(2)", "el => el ? el.innerText.slice(0,80) : null"
            )
            await page.select_option("#dd", year)
            try:
                await page.wait_for_function(
                    """(before) => {
                        const row = document.querySelector('#tbl_body tr:nth-child(2)');
                        return row && row.innerText.slice(0,80) !== before;
                    }""",
                    arg=before,
                    timeout=15000,
                )
            except Exception:
                pass  # real content might legitimately start the same; capture whatever is there regardless
            await page.wait_for_timeout(800)
            html = await page.content()
        except Exception as e:
            print(f"[ERROR] {label}: {type(e).__name__}: {e}. Skipping this year.", file=sys.stderr)
            results.append({
                "source_key": "epfo_circulars", "year": year, "url": config["url"],
                "blocked": False, "error": f"{type(e).__name__}: {e}", "html": None, "html_length": 0,
            })
            await asyncio.sleep(INTER_PAGE_DELAY)
            continue

        blocked, block_reason = is_blocked(200, html)
        result = {
            "source_key": "epfo_circulars",
            "year": year,
            "url": config["url"],
            "blocked": blocked,
            "html": html,
            "html_length": len(html),
            "scraped_at": datetime.utcnow().isoformat(),
        }
        if blocked:
            result["block_reason"] = block_reason
            print(f"[STOP] {label}: {block_reason}, stopping year-crawl.", file=sys.stderr)
            results.append(result)
            break

        results.append(result)
        await asyncio.sleep(INTER_PAGE_DELAY)

    await context.close()
    return results


async def scrape_epfo_circulars_history():
    """Standalone entrypoint: real full year-history crawl for EPFO Circulars."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        results = await fetch_epfo_circulars_history(browser)
        await browser.close()
        return results


async def scrape_all_sequential():
    """Scrape all sources sequentially with delays between sites."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ]
        )
        
        results = []
        for i, source_key in enumerate(SOURCES.keys()):
            if i > 0:
                print(f"[THROTTLE] Waiting {INTER_SOURCE_DELAY}s before next source...", file=sys.stderr)
                await asyncio.sleep(INTER_SOURCE_DELAY)
            
            result = await fetch_page(browser, source_key)
            results.append(result)
        
        await browser.close()
        return results


async def scrape_single(source_key: str):
    """Scrape a single source."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ]
        )
        result = await fetch_page(browser, source_key)
        await browser.close()
        return [result]


async def scrape_single_all_pages(source_key: str):
    """Scrape a single source, walking its full real pagination if configured."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ]
        )
        results = await fetch_all_pages(browser, source_key)
        await browser.close()
        return results


# --- CLI ---
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Scrape labour law regulator documents")
    parser.add_argument("--source", choices=list(SOURCES.keys()), help="Scrape a specific source")
    parser.add_argument("--all", action="store_true", help="Scrape all sources sequentially")
    parser.add_argument(
        "--paginate", action="store_true",
        help="With --source, walk its full real pagination (fetch_all_pages) instead of just the first page",
    )
    parser.add_argument(
        "--epfo-circulars-history", action="store_true",
        help="Walk EPFO Circulars' full real year-history via its AJAX dropdown",
    )
    parser.add_argument("--output", default="-", help="Output file (default: stdout)")

    args = parser.parse_args()

    async def main():
        if args.epfo_circulars_history:
            results = await scrape_epfo_circulars_history()
        elif args.all:
            results = await scrape_all_sequential()
        elif args.source and args.paginate:
            results = await scrape_single_all_pages(args.source)
        elif args.source:
            results = await scrape_single(args.source)
        else:
            print("Use --source <name> or --all", file=sys.stderr)
            sys.exit(1)
        
        # Summary
        total = len(results)
        blocked = sum(1 for r in results if r.get("blocked"))
        errors = sum(1 for r in results if r.get("error"))
        archives = sum(len(r.get("archive_urls", [])) for r in results)
        
        print(
            f"\n[SUMMARY] Total: {total} | Blocked: {blocked} | Errors: {errors} | "
            f"Archive URLs discovered: {archives}",
            file=sys.stderr,
        )
        
        for r in results:
            status = "OK"
            if r.get("blocked"):
                status = f"BLOCKED ({r.get('block_reason', 'unknown')})"
            elif r.get("error"):
                status = f"ERROR ({r.get('error', 'unknown')[:50]})"
            print(f"  - {r['source_key']}: {status} | {r.get('html_length', 0)} bytes", file=sys.stderr)
        
        # Strip full HTML from output JSON to keep it readable
        output_results = []
        for r in results:
            out = {k: v for k, v in r.items() if k != "html"}
            out["html_snippet"] = (r.get("html") or "")[:500]
            output_results.append(out)
        
        output = json.dumps(output_results, ensure_ascii=False, indent=2)
        
        if args.output == "-":
            print(output)
        else:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
    
    asyncio.run(main())