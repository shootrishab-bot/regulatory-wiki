import asyncio
import html as html_module
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urljoin, urlparse, parse_qs, urlencode, urlunparse

import aiohttp
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import Config
from .source_id import make_source_id

logger = logging.getLogger(__name__)


@dataclass
class ScrapedItem:
    source_id: str
    title: str
    url: Optional[str]           # link to the document/detail page, if any
    source_url: str              # the listing page this was found on
    source_feed: str             # 'homepage' | 'tenders' | 'market_studies' | 'antitrust_orders' | 'combination_notifications'
    date: Optional[str]
    scraped_at: str


class RateLimiter:
    """Minimum gap between requests to cci.gov.in, shared across all fetch calls."""

    def __init__(self, seconds: float):
        self.seconds = seconds
        self._last = 0.0
        self._lock = asyncio.Lock()

    async def wait(self):
        async with self._lock:
            elapsed = time.monotonic() - self._last
            if elapsed < self.seconds:
                await asyncio.sleep(self.seconds - elapsed)
            self._last = time.monotonic()


_DATE_PATTERNS = [
    r"(\d{4}-\d{2}-\d{2})",
    r"(\d{1,2}[./]\d{1,2}[./]\d{4})",
    r"(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})",
]


def extract_date(text: str) -> Optional[str]:
    for pattern in _DATE_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


class CCIFetcher:
    """Rate-limited, retried HTTP layer. All scraping functions go through this."""

    def __init__(self, config: Config):
        self.config = config
        self.limiter = RateLimiter(config.RATE_LIMIT_SECONDS)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=15),
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError)),
    )
    async def fetch_html(self, session: aiohttp.ClientSession, url: str) -> Optional[str]:
        await self.limiter.wait()
        headers = {"User-Agent": self.config.USER_AGENT}
        async with session.get(
            url, headers=headers, timeout=aiohttp.ClientTimeout(total=self.config.REQUEST_TIMEOUT)
        ) as resp:
            if resp.status == 200:
                return await resp.text()
            logger.warning("GET %s -> HTTP %s", url, resp.status)
            return None

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=15),
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError)),
    )
    async def download_pdf(
        self, session: aiohttp.ClientSession, url: str, dest_path
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Returns (ok, etag, last_modified). The two headers come from this
        same real download -- no extra request -- and are what
        filter_changed_items() compares against on a future re-scrape to
        decide whether this document needs downloading again at all."""
        await self.limiter.wait()
        headers = {"User-Agent": self.config.USER_AGENT}
        async with session.get(
            url, headers=headers, timeout=aiohttp.ClientTimeout(total=self.config.REQUEST_TIMEOUT)
        ) as resp:
            if resp.status != 200:
                logger.warning("PDF GET %s -> HTTP %s", url, resp.status)
                return False, None, None
            content = await resp.read()
            dest_path.write_bytes(content)
            return True, resp.headers.get("ETag"), resp.headers.get("Last-Modified")

    async def head_fingerprint(
        self, session: aiohttp.ClientSession, url: str
    ) -> Optional[Tuple[Optional[str], Optional[str]]]:
        """Cheap HEAD-only check for filter_changed_items(): confirmed live
        2026-08-25 that cci.gov.in's own file server returns real, stable
        ETag and Last-Modified headers on its PDF files (static-file-server
        behavior, not something these documents' own content controls) --
        this is what makes a HEAD request a reliable substitute for a full
        GET+OCR+classify just to check "has this changed".

        Returns (etag, last_modified) on a real 200 response, or None on any
        failure -- deliberately NOT retried the way fetch_html/download_pdf
        are: a failed check should make the caller fall back to reprocessing
        (fail open toward correctness), not burn retries on what is only an
        optimization in the first place.

        Deliberately does NOT go through self.limiter (the 2.0s-gap, single-
        global-lock download limiter) -- filter_changed_items() instead
        bounds these calls with its own concurrency cap
        (config.HEAD_CHECK_CONCURRENCY). See that config field's own comment
        for why reusing the download limiter here would defeat the point of
        this whole check.
        """
        headers = {"User-Agent": self.config.USER_AGENT}
        try:
            async with session.head(
                url, headers=headers,
                timeout=aiohttp.ClientTimeout(total=self.config.REQUEST_TIMEOUT),
                allow_redirects=True,
            ) as resp:
                if resp.status != 200:
                    logger.info("HEAD %s -> HTTP %s, treating as changed", url, resp.status)
                    return None
                return resp.headers.get("ETag"), resp.headers.get("Last-Modified")
        except Exception as exc:
            logger.warning("HEAD fingerprint check failed for %s: %s", url, exc)
            return None


# ============================================================================
# Homepage Latest Updates feed
# ============================================================================
# REAL, CONFIRMED 2026-08-18: the old selectors below never matched anything
# real -- confirmed live ("Could not find Latest Updates section", 0 items).
# The real homepage has a `<section class="... latestupdates">` containing 4
# tabs (What's New / Public Notices / Latest Events / Press Releases), each a
# `<ul class="data-autoscroll"><li class="d-flex"><a href=...>title</a></li>`
# marquee -- static server-rendered HTML, no AJAX involved. `.latestupdates`
# is scoped to that whole section so items from all 4 tabs are picked up, not
# just "What's New".

FEED_SELECTORS = [
    ".latestupdates", ".latest-updates", ".news-feed", ".whats-new", ".home-news",
    ".scroll-news", ".update-list", ".feed-list", "#latest-news", ".homepage-news",
]
ITEM_SELECTOR = "ul.data-autoscroll li, .item, .news-item, .update-item, .list-item, article"


async def extract_homepage_feed(fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    logger.info("Scraping homepage Latest Updates feed...")
    html = await fetcher.fetch_html(session, config.HOMEPAGE_URL)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    feed_section = None
    for selector in FEED_SELECTORS:
        found = soup.select(selector)
        if found:
            feed_section = found[0]
            break
    if feed_section is None:
        for heading in soup.find_all(["h2", "h3", "h4"]):
            if "latest" in heading.text.lower() and "update" in heading.text.lower():
                feed_section = heading.parent
                break
    if feed_section is None:
        logger.warning(
            "Could not find Latest Updates section with known selectors -- "
            "inspect the real homepage DOM and update FEED_SELECTORS in scraper.py"
        )
        return []

    items: List[ScrapedItem] = []
    now = datetime.utcnow().isoformat()
    for el in feed_section.select(ITEM_SELECTOR):
        text = el.get_text(strip=True)
        if not text:
            continue
        link = el.find("a")
        if link:
            title = link.get_text(strip=True)
            href = link.get("href")
            url = urljoin(config.BASE_URL, href) if href else None
        else:
            title, url = text, None
        if not title:
            continue

        items.append(
            ScrapedItem(
                source_id=make_source_id(config.HOMEPAGE_URL, title),
                title=title,
                url=url,
                source_url=config.HOMEPAGE_URL,
                source_feed="homepage",
                date=extract_date(text),
                scraped_at=now,
            )
        )
    logger.info("Homepage feed: %d raw items found", len(items))
    return items


# ----------------------------------------------------------------------------
# Shared helper for the site's other DataTables-backed GET endpoints (Tenders,
# Market Studies current + archive) -- same server-side DataTables shape as
# Combination Notifications (confirmed live for all three 2026-08-18: real
# `<script>` DataTable({...}) config on each rendered page names a real GET
# `.../list` endpoint, no CSRF token present on any of these three, unlike
# Antitrust Orders), so they reuse `_extract_via_api` + the shared record
# helpers rather than duplicating pagination/parsing logic.
# ----------------------------------------------------------------------------

def _build_datatable_get_url(list_url: str, columns: List[str]) -> str:
    params = {
        "draw": "1", "start": "0", "length": str(_PAGE_LENGTH),
        "search[value]": "", "search[regex]": "false",
        "order[0][column]": "0", "order[0][dir]": "desc",
        "searchString": "", "fromdate": "", "todate": "",
    }
    for i, c in enumerate(columns):
        params[f"columns[{i}][data]"] = c
        params[f"columns[{i}][name]"] = c
        params[f"columns[{i}][searchable]"] = "true"
        params[f"columns[{i}][orderable]"] = "true"
        params[f"columns[{i}][search][value]"] = ""
        params[f"columns[{i}][search][regex]"] = "false"
    return f"{list_url}?{urlencode(params)}"


# ============================================================================
# Tenders
# ============================================================================

_TENDERS_COLUMNS = ["DT_RowIndex", "title", "date_of_issue", "last_date_of_submission", "due_date_extended", "files"]


async def extract_tenders(fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """
    REAL, CONFIRMED 2026-08-18: the rendered /tenders page is a static shell;
    the real listing loads via a GET DataTables AJAX call to
    https://www.cci.gov.in/fetch-tender-list (found in the page's own inline
    DataTable() config -- same discovery method used for Antitrust Orders and
    Combination Notifications, no CSRF needed here). Confirmed live: 16 real
    tenders, same file_content/files record shape as Combination
    Notifications, so this reuses _extract_via_api + the shared record
    helpers rather than a bespoke parser. The prior DOM-scraping version of
    this function matched generic site-nav <li> elements (header/footer
    links, e.g. "Home", "Contact Us") -- 0 of its "10 items found" were real
    tenders.
    """
    list_url = f"{config.BASE_URL}/fetch-tender-list"
    endpoint = {"method": "GET", "url": _build_datatable_get_url(list_url, _TENDERS_COLUMNS), "request_payload": None}
    return await _extract_via_api(fetcher, session, config, config.TENDERS_URL, "tenders", endpoint)


# ============================================================================
# Market Studies (current + archive)
# ============================================================================

_MARKET_STUDIES_COLUMNS = ["DT_RowIndex", "title", "files"]


async def extract_market_studies(fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """
    REAL, CONFIRMED 2026-08-18: same situation as Tenders -- both
    /economics-research/market-studies and its /market-studies-archive
    sibling are static shells whose real listings load via GET DataTables
    AJAX calls (.../market-studies/list and .../market-studies-archive/list,
    both found in each page's own inline DataTable() config, no CSRF).
    Confirmed live: 9 real current studies + 19 real archived studies = 28
    total, same file_content/files record shape as the other feeds. The
    prior DOM-scraping version matched `a[href$=".pdf"]` against the static
    shell and only ever found nav/breadcrumb links -- 0 real studies.
    """
    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []
    for page_url, list_url in (
        (config.MARKET_STUDIES_URL, f"{config.MARKET_STUDIES_URL}/list"),
        (config.MARKET_STUDIES_ARCHIVE_URL, f"{config.MARKET_STUDIES_ARCHIVE_URL}/list"),
    ):
        endpoint = {"method": "GET", "url": _build_datatable_get_url(list_url, _MARKET_STUDIES_COLUMNS), "request_payload": None}
        items.extend(await _extract_via_api(fetcher, session, config, page_url, "market_studies", endpoint))
    logger.info("Market studies (current + archive): %d items total", len(items))
    return items


# ============================================================================
# AJAX search pages (Antitrust Orders, Combination Notifications)
# ============================================================================

async def extract_search_page(
    fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config, page_url: str, source_feed: str
) -> List[ScrapedItem]:
    """
    REAL, CONFIRMED 2026-08-18 (live verification, per the build brief's own
    instruction to inspect rather than guess further once the generic
    discovery/fallback path came up empty):

    Antitrust Orders is special-cased to `_extract_antitrust_orders_verified`
    below -- `discover`'s generic capture found 0 candidate endpoints here
    (the page's DataTable apparently does not auto-fire its initial AJAX call
    the way Combination Notifications' does, and the date-input fill both
    pages' discovery attempts try genuinely times out before any submit is
    possible either way -- see data/cci/api_discovery.json's own "notes").
    Reading the page's own inline `DataTable({...})` JS config directly
    (not guessed) revealed a real, working endpoint the generic capture
    missed: POST https://www.cci.gov.in/antitrust/orders/list, gated by a
    real per-page-load CSRF token embedded in that same inline script (no
    separate <meta name="csrf-token"> tag exists on this page -- checked).
    Confirmed live: recordsTotal=1231 real antitrust order cases, real
    pagination via start/length. DOM fallback was never needed here.

    Combination Notifications keeps using the generic discovered-endpoint
    path (`_extract_via_api`), since `discover` found a real, working GET API
    there with no auth complications -- see that function's own real-shape
    handling for two things fixed after live testing: (1) pagination, since
    a raw endpoint replay would otherwise be stuck on the single page-length
    `discover` happened to capture (10 of the real 23 records); (2) file URL
    extraction, since this feed's real record shape has no plain url/link
    field -- confirmed live -- only a `file_content` JSON string and a
    `files` HTML fragment, which the generic extractor didn't parse before.
    """
    if page_url == config.ANTITRUST_ORDERS_URL:
        return await _extract_antitrust_orders_verified(fetcher, session, config)

    discovered = _load_discovered_endpoint(config, page_url)
    if discovered is not None:
        items = await _extract_via_api(fetcher, session, config, page_url, source_feed, discovered)
        if items:
            return items
        logger.warning(
            "Discovered API for %s returned 0 items -- falling back to DOM scraping. "
            "The discovery may be stale; consider re-running `discover`.",
            page_url,
        )

    return await _extract_via_dom_fallback(config, page_url, source_feed)


# A committed copy of data/cci/api_discovery.json, the output of the
# package's own `discover` command. data/ is gitignored, so on any machine
# that has never run `discover` -- every CI run -- the live file does not
# exist, Combination Notifications fell through to the DOM fallback (which
# times out on the page's date input), and the feed silently returned 0
# items every day. The live file still wins whenever it exists, so
# re-running `discover` keeps working as before; refresh this seed from it
# if the endpoint ever changes.
_DISCOVERY_SEED_PATH = Path(__file__).with_name("api_discovery.seed.json")


def _load_discovered_endpoint(config: Config, page_url: str) -> Optional[dict]:
    path = config.DISCOVERY_LOG_PATH if config.DISCOVERY_LOG_PATH.exists() else _DISCOVERY_SEED_PATH
    if not path.exists():
        return None
    try:
        log = json.loads(path.read_text())
    except Exception:
        return None
    entry = log.get(page_url)
    if not entry or not entry.get("endpoints_found"):
        return None
    high_confidence = [e for e in entry["endpoints_found"] if e["confidence"] == "high"]
    return (high_confidence or entry["endpoints_found"])[0]


# ----------------------------------------------------------------------------
# Shared record parsing -- both real DataTables record shapes seen live
# (Combination Notifications' plain GET API and Antitrust Orders' CSRF-gated
# POST one) reuse this rather than duplicating field-guessing logic.
# ----------------------------------------------------------------------------

_HREF_RE = re.compile(r'href="([^"]+)"')


def _extract_title_from_record(rec: dict) -> Optional[str]:
    """
    REAL, CONFIRMED 2026-08-18: Antitrust Orders' own `title` field is NOT a
    real document title -- every sampled row returned the exact same fixed
    HTML fragment naming the case's current procedural stage (e.g.
    '<span class="blue">Section 26(2)</span>'), not a per-document title.
    That regime is detected here by the presence of real `case_no` +
    `description` fields (confirmed unique to that shape) and a real title
    is built from them instead. Combination Notifications' own `title` field
    IS a real, distinct, human-written title per row -- used directly there.
    """
    if rec.get("case_no") and rec.get("description"):
        case_no = str(rec["case_no"]).strip()
        description = BeautifulSoup(str(rec["description"]), "html.parser").get_text(strip=True)
        return f"{case_no}: {description}" if description else case_no

    for key in ("title", "name", "caseTitle", "case_title", "orderTitle"):
        raw = rec.get(key)
        if not raw:
            continue
        text = BeautifulSoup(str(raw), "html.parser").get_text(strip=True)
        if text:
            return text
    return None


def _extract_file_url_from_record(config: Config, rec: dict) -> Optional[str]:
    """
    REAL, CONFIRMED 2026-08-18: neither real record shape (Antitrust Orders,
    Combination Notifications) has a plain `url`/`link`/`fileUrl`/`pdfUrl`
    field -- the generic extractor's old fallback chain never matched
    anything on either real feed. Real data lives in `file_content` (an
    HTML-entity-escaped JSON string naming the real file, e.g.
    '[{"title":"Order","file_name":"images/antitrustorder/en/order....pdf",
    ...}]') on both feeds, confirmed live. The direct file URL is
    BASE_URL + file_name verbatim -- confirmed live with a real 200 +
    application/pdf content-type on samples from both feeds, not assumed.
    Falls back to a real href inside the `files` HTML fragment (the
    document's detail page, not a direct file) if file_content is absent or
    unparseable, then to plain field names as a last resort in case a future
    feed uses those instead.
    """
    file_content_raw = rec.get("file_content")
    if file_content_raw:
        try:
            parsed = json.loads(html_module.unescape(str(file_content_raw)))
            if isinstance(parsed, list) and parsed and parsed[0].get("file_name"):
                return urljoin(config.BASE_URL + "/", parsed[0]["file_name"])
        except Exception:
            pass

    files_html = rec.get("files")
    if files_html:
        m = _HREF_RE.search(str(files_html))
        if m:
            return m.group(1)

    for key in ("url", "link", "fileUrl", "pdfUrl"):
        if rec.get(key):
            return urljoin(config.BASE_URL, rec[key])
    return None


# Defensive cap on total records paginated through for any one source, so a
# misread of `recordsTotal` (or a future site change) can't loop forever --
# real evidence so far is 1231 (antitrust orders) and 23 (combination
# notifications), both comfortably under this.
_MAX_PAGINATED_RECORDS = 5000
_PAGE_LENGTH = 100


async def _extract_via_api(
    fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config,
    page_url: str, source_feed: str, endpoint: dict,
) -> List[ScrapedItem]:
    """
    Replays the endpoint `discover` captured. REVISED 2026-08-18 after live
    testing against Combination Notifications' real endpoint: the captured
    URL bakes in whatever start/length the discovery run happened to use
    (start=0&length=10), which without pagination would silently cap every
    real run at that same first page (10 of the real 23 records) forever.
    Now pages through start/length itself, using the captured URL as a
    template and `recordsTotal`/`recordsFiltered` to know when to stop --
    confirmed live that both are present and accurate on the real response.
    POST endpoints (not seen via generic discovery yet, but handled for
    completeness) paginate via the JSON request_payload's own start/length
    keys the same way.
    """
    method = endpoint.get("method", "GET").upper()
    api_url = endpoint["url"]
    payload = endpoint.get("request_payload")
    headers = {"User-Agent": config.USER_AGENT, "X-Requested-With": "XMLHttpRequest"}

    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []
    start = 0
    total = None

    while total is None or start < min(total, _MAX_PAGINATED_RECORDS):
        await fetcher.limiter.wait()
        try:
            if method == "GET":
                parsed = urlparse(api_url)
                qs = parse_qs(parsed.query)
                qs["start"] = [str(start)]
                qs["length"] = [str(_PAGE_LENGTH)]
                paged_url = urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))
                async with session.get(paged_url, headers=headers, timeout=aiohttp.ClientTimeout(total=config.REQUEST_TIMEOUT)) as resp:
                    body = await resp.json()
            else:
                paged_payload = dict(payload or {})
                paged_payload["start"] = start
                paged_payload["length"] = _PAGE_LENGTH
                async with session.post(api_url, headers=headers, json=paged_payload, timeout=aiohttp.ClientTimeout(total=config.REQUEST_TIMEOUT)) as resp:
                    body = await resp.json()
        except Exception as exc:
            logger.error("Discovered API call failed for %s at start=%d: %s", api_url, start, exc)
            break

        total = body.get("recordsTotal") if isinstance(body, dict) else None
        records = body if isinstance(body, list) else next(
            (body[k] for k in ("data", "results", "items", "orders", "notifications", "records") if isinstance(body.get(k), list)),
            [],
        )
        if not records:
            break

        for rec in records:
            title = _extract_title_from_record(rec)
            if not title:
                continue
            date_field = next((v for k, v in rec.items() if "date" in k.lower()), None)
            items.append(
                ScrapedItem(
                    source_id=make_source_id(page_url, title),
                    title=title,
                    url=_extract_file_url_from_record(config, rec),
                    source_url=page_url,
                    source_feed=source_feed,
                    date=str(date_field) if date_field else None,
                    scraped_at=now,
                )
            )

        if total is None:
            break  # not a paginated DataTables-shaped response; one page is all we get
        start += _PAGE_LENGTH

    logger.info("API extraction for %s: %d items (recordsTotal=%s)", page_url, len(items), total)
    return items


# ----------------------------------------------------------------------------
# Antitrust Orders -- verified live 2026-08-18, see extract_search_page's
# own docstring for the full real evidence trail.
# ----------------------------------------------------------------------------

_CSRF_TOKEN_RE = re.compile(r"X-CSRF-TOKEN['\"]?\s*:\s*[\"']([^\"']+)[\"']")


async def _extract_antitrust_orders_verified(
    fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config
) -> List[ScrapedItem]:
    page_url = config.ANTITRUST_ORDERS_URL
    list_url = f"{page_url}/list"
    base_headers = {"User-Agent": config.USER_AGENT}

    await fetcher.limiter.wait()
    try:
        async with session.get(page_url, headers=base_headers, timeout=aiohttp.ClientTimeout(total=config.REQUEST_TIMEOUT)) as resp:
            html = await resp.text()
    except Exception as exc:
        logger.error("Could not load %s to obtain a CSRF token: %s", page_url, exc)
        return []

    m = _CSRF_TOKEN_RE.search(html)
    if not m:
        logger.error(
            "Could not find the real X-CSRF-TOKEN in %s -- the page's own inline "
            "DataTable() JS config may have changed; re-inspect the live page.",
            page_url,
        )
        return []
    headers = {**base_headers, "X-CSRF-TOKEN": m.group(1), "X-Requested-With": "XMLHttpRequest"}

    # Real column order confirmed live via the page's own inline DataTable()
    # config -- see extract_search_page's docstring.
    columns = ["DT_RowIndex", "case_no", "description", "type", "main_order_date", "order_date", "files"]

    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []
    start = 0
    total = None
    draw = 1

    while total is None or start < min(total, _MAX_PAGINATED_RECORDS):
        await fetcher.limiter.wait()
        data = {"draw": str(draw), "start": str(start), "length": str(_PAGE_LENGTH)}
        for i, col in enumerate(columns):
            data[f"columns[{i}][data]"] = col

        try:
            async with session.post(
                list_url, headers=headers, data=data, timeout=aiohttp.ClientTimeout(total=config.REQUEST_TIMEOUT)
            ) as resp:
                if resp.status != 200:
                    logger.error("Antitrust orders /list POST -> HTTP %s at start=%d", resp.status, start)
                    break
                body = await resp.json()
        except Exception as exc:
            logger.error("Antitrust orders /list POST failed at start=%d: %s", start, exc)
            break

        total = body.get("recordsTotal", 0)
        records = body.get("data", [])
        if not records:
            break

        for rec in records:
            title = _extract_title_from_record(rec)
            if not title:
                continue
            items.append(
                ScrapedItem(
                    source_id=make_source_id(page_url, title),
                    title=title,
                    url=_extract_file_url_from_record(config, rec),
                    source_url=page_url,
                    source_feed="antitrust_orders",
                    date=rec.get("order_date") or rec.get("main_order_date"),
                    scraped_at=now,
                )
            )

        start += _PAGE_LENGTH
        draw += 1

    logger.info("Antitrust orders verified API: %d items (recordsTotal=%s)", len(items), total)
    return items


async def _extract_via_dom_fallback(config: Config, page_url: str, source_feed: str) -> List[ScrapedItem]:
    """Drives the real search form with Playwright and scrapes rendered results.
    Generic selectors -- verify against the live DOM (see api_discovery.py docstring)."""
    from playwright.async_api import async_playwright

    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            await page.goto(page_url, wait_until="networkidle", timeout=config.REQUEST_TIMEOUT * 1000)

            date_inputs = await page.query_selector_all('input[type="date"], input[name*="date" i]')
            if len(date_inputs) >= 2:
                await date_inputs[0].fill("2021-01-01")
                await date_inputs[-1].fill("2026-12-31")

            submit = await page.query_selector('button[type="submit"], input[type="submit"]')
            if submit:
                await submit.click()
                await page.wait_for_load_state("networkidle", timeout=config.REQUEST_TIMEOUT * 1000)

            results = await page.query_selector_all("table tbody tr, .result-item, .order-item")
            for result in results:
                text = (await result.text_content() or "").strip()
                if len(text) < 10:
                    continue
                link = await result.query_selector("a")
                if link:
                    title = (await link.text_content() or "").strip()
                    href = await link.get_attribute("href")
                    url = urljoin(config.BASE_URL, href) if href else None
                else:
                    title, url = text[:200], None
                if not title:
                    continue
                items.append(
                    ScrapedItem(
                        source_id=make_source_id(page_url, title),
                        title=title,
                        url=url,
                        source_url=page_url,
                        source_feed=source_feed,
                        date=extract_date(text),
                        scraped_at=now,
                    )
                )
        except Exception as exc:
            logger.error("DOM fallback failed for %s: %s", page_url, exc)
        finally:
            await browser.close()

    logger.info("DOM fallback for %s: %d items", page_url, len(items))
    return items


async def scrape_all_sources(fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """Scrapes every source and returns the deduplicated pool (by source_id)."""
    results = await asyncio.gather(
        extract_homepage_feed(fetcher, session, config),
        extract_tenders(fetcher, session, config),
        extract_market_studies(fetcher, session, config),
        extract_search_page(fetcher, session, config, config.ANTITRUST_ORDERS_URL, "antitrust_orders"),
        extract_search_page(fetcher, session, config, config.COMBINATION_NOTIFICATIONS_URL, "combination_notifications"),
        return_exceptions=True,
    )

    all_items: List[ScrapedItem] = []
    for r in results:
        if isinstance(r, Exception):
            logger.error("A source scraper raised: %s", r)
            continue
        all_items.extend(r)

    seen = {}
    for item in all_items:
        seen[item.source_id] = item  # last write wins, same as every other regulator's dedupe
    return list(seen.values())
