import asyncio
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional
from urllib.parse import urljoin

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
    url: Optional[str]     # link to the document (PDF or detail page), if any
    source_url: str        # the listing/page this was found on
    source_feed: str       # 'compliance_orders' | 'downloads' | 'whats_new' | 'careers' |
                            # 'tenders' | 'legislation' | 'faq' | 'rti' | 'international' |
                            # 'publications' | 'annual_reports'
    date: Optional[str]    # ISO YYYY-MM-DD if parseable, raw text otherwise
    scraped_at: str


class RateLimiter:
    """Minimum gap between requests to fiuindia.gov.in, shared across all fetch calls."""

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


class FIUFetcher:
    """Rate-limited, retried HTTP layer. All scraping functions go through this.

    CONFIRMED live 2026-08-25: unlike cci.gov.in, fiuindia.gov.in needs no
    session warm-up, cookies, or CSRF token for any real page or PDF -- a
    single unauthenticated GET with a browser User-Agent returns real content
    immediately, even for a page never visited before in that session."""

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
    async def download_pdf(self, session: aiohttp.ClientSession, url: str, dest_path) -> bool:
        await self.limiter.wait()
        headers = {"User-Agent": self.config.USER_AGENT}
        async with session.get(
            url, headers=headers, timeout=aiohttp.ClientTimeout(total=self.config.REQUEST_TIMEOUT)
        ) as resp:
            if resp.status != 200:
                logger.warning("PDF GET %s -> HTTP %s", url, resp.status)
                return False
            content = await resp.read()
            dest_path.write_bytes(content)
            return True


# ============================================================================
# Date parsing -- FIU-IND's real pages mix several different formats, all
# confirmed live 2026-08-25. Centralised here so every extractor below
# produces an already-ISO'd `date` field rather than pushing per-feed reparsing
# downstream into run_fiu_adapter.py the way the legacy fiu_adapter.py did for
# its one single format.
# ============================================================================

_ORDINAL_SUFFIX_RE = re.compile(r"(\d+)(st|nd|rd|th)\b", re.IGNORECASE)
_DOT_DATE_RE = re.compile(r"\b(\d{2})\.(\d{2})\.(\d{4})\b")
_AS_ON_DATED_RE = re.compile(
    r"\b(?:as on|dated)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})", re.IGNORECASE
)
_MONTH_ORDINAL_YEAR_RE = re.compile(
    r"\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b"
)
_MONTH_YEAR_RE = re.compile(r"^([A-Za-z]+)\s+(\d{4})$")

_MONTH_FORMATS = ("%B %d %Y",)  # month name already resolved to full name below


def _try_month_day_year(month: str, day: str, year: str) -> Optional[str]:
    for fmt_month in (month, month[:3]):
        try:
            dt = datetime.strptime(f"{fmt_month} {int(day):02d} {year}", "%B %d %Y")
            return dt.date().isoformat()
        except ValueError:
            try:
                dt = datetime.strptime(f"{fmt_month} {int(day):02d} {year}", "%b %d %Y")
                return dt.date().isoformat()
            except ValueError:
                continue
    return None


def parse_date_to_iso(text: Optional[str], month_year_fallback: Optional[str] = None) -> Optional[str]:
    """Best-effort ISO (YYYY-MM-DD) date extraction from FIU-IND's real,
    inconsistent date formats: ordinal 'Month Dth[,] YYYY' (Compliance Orders'
    own Date column, the same format fiu_adapter.py's docstring already
    documented from a real 2026-07-28 run), dotted 'DD.MM.YYYY' (Careers/
    Tenders title prefixes), and free-text 'as on'/'dated DDth Month YYYY'
    (Downloads/What's New titles). Falls back to a carried-forward 'Month
    YYYY' section header (day defaulted to the 1st) when no exact date is
    findable in the row's own text -- better than no date at all for a
    month-grouped feed with no other date signal on some rows."""
    if text:
        cleaned = _ORDINAL_SUFFIX_RE.sub(r"\1", text)

        m = _DOT_DATE_RE.search(cleaned)
        if m:
            dd, mm, yyyy = m.groups()
            try:
                return datetime(int(yyyy), int(mm), int(dd)).date().isoformat()
            except ValueError:
                pass

        m = _AS_ON_DATED_RE.search(cleaned)
        if m:
            day, month, year = m.groups()
            iso = _try_month_day_year(month, day, year)
            if iso:
                return iso

        m = _MONTH_ORDINAL_YEAR_RE.search(cleaned)
        if m:
            month, day, year = m.groups()
            iso = _try_month_day_year(month, day, year)
            if iso:
                return iso

    if month_year_fallback:
        m = _MONTH_YEAR_RE.match(month_year_fallback.strip())
        if m:
            month, year = m.groups()
            iso = _try_month_day_year(month, "1", year)
            if iso:
                return iso

    return None


def _resolve_href(base_page_url: str, href: str) -> str:
    return urljoin(base_page_url, href)


# ============================================================================
# Compliance Orders -- CONFIRMED live 2026-08-25: real listing page is
# files/Compliance_Orders/orders.html (the build brief's guessed
# pdfs/judgements/ is a raw file-storage directory with no listing, HTTP 200
# + empty body). Static HTML, 13 year-tables (2013-2025), 126 real rows.
# Same 5-column shape [S.No, Date, Description, Size, link] the legacy
# fiu_watcher.py already scraped, just not truncated to a top-10 here.
# ============================================================================

async def extract_compliance_orders(
    fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config
) -> List[ScrapedItem]:
    html = await fetcher.fetch_html(session, config.COMPLIANCE_ORDERS_URL)
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")

    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []
    for table in soup.find_all("table"):
        tbody = table.find("tbody") or table
        for tr in tbody.find_all("tr", recursive=False) or tbody.find_all("tr"):
            tds = tr.find_all("td", recursive=False)
            if len(tds) < 5:
                continue
            date_text = tds[1].get_text(strip=True)
            title = tds[2].get_text(strip=True)
            if not title:
                continue
            a = tds[4].find("a")
            url = _resolve_href(config.COMPLIANCE_ORDERS_URL, a["href"]) if a and a.get("href") else None
            items.append(
                ScrapedItem(
                    source_id=make_source_id(config.COMPLIANCE_ORDERS_URL, title),
                    title=title,
                    url=url,
                    source_url=config.COMPLIANCE_ORDERS_URL,
                    source_feed="compliance_orders",
                    date=parse_date_to_iso(date_text),
                    scraped_at=now,
                )
            )
    logger.info("Compliance Orders: %d real items found", len(items))
    return items


# ============================================================================
# Generic single-column table listing -- shared by Downloads, Publications,
# and Tenders: one real <table>, each real row is a <td> holding one or more
# real documents. CONFIRMED live 2026-08-25 (raw DOM inspection, not
# guessed): real rows are NOT always one link each -- many are a
# `<ul><li><a href=...>Title</a></li>...</ul>` list with several real,
# independently-linked documents packed into a single <tr> (4 real rows on
# Tenders alone, e.g. a tender notice plus its own "Letter of Authorisation"
# sub-document as a second <li> in the same row). The first-draft version of
# this extractor took only tr.find("a") (the first anchor) and tr.get_text()
# (the WHOLE row's text, every <li> concatenated with no separator) as ONE
# item -- confirmed live to both silently drop every <li> after the first AND
# glue unrelated titles together with no space between them (e.g. "...on
# Deputation BasisFinancial Intelligence Unit-India and..." -- two distinct
# real announcements read as one garbled title). Fixed here by emitting one
# ScrapedItem per real <a href> in the row, using that anchor's OWN text as
# its title -- correct regardless of how many real documents one row holds.
# ============================================================================

def _extract_simple_table_listing(
    html: str, page_url: str, source_feed: str,
    require_leading_date: bool = False,
) -> List[ScrapedItem]:
    soup = BeautifulSoup(html, "html.parser")
    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []
    seen_hrefs = set()

    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            anchors = tr.find_all("a", href=True)
            if not anchors:
                continue
            # A leading date (e.g. Tenders' "20.11.2018-") often sits in a
            # sibling <span> BEFORE the first anchor, outside any single
            # anchor's own text -- checked against the whole row, not
            # per-anchor, so later <li> sub-documents in the same dated row
            # aren't wrongly excluded for lacking their own date prefix.
            row_text = tr.get_text(strip=True)
            if require_leading_date and not _DOT_DATE_RE.match(row_text):
                continue

            for a in anchors:
                title = a.get_text(strip=True)
                if not title:
                    continue
                url = _resolve_href(page_url, a["href"])
                if url in seen_hrefs:
                    continue
                seen_hrefs.add(url)
                items.append(
                    ScrapedItem(
                        source_id=make_source_id(page_url, title),
                        title=title,
                        url=url,
                        source_url=page_url,
                        source_feed=source_feed,
                        date=parse_date_to_iso(title) or parse_date_to_iso(row_text),
                        scraped_at=now,
                    )
                )
    return items


async def extract_downloads(fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """CONFIRMED live 2026-08-25: files/Downloads/Downloads.html, 1 table, 12
    real rows -- Guidelines and Circulars (VDA Guidelines, TCSP Guidelines,
    MSCS Guidelines, VDA SP registration circular revisions, Personal Hearing
    Policy). No separate date/size columns; dates, where present at all, are
    embedded in the title text ('...Updated as on 8thJanuary 2026', '...dated
    15thSeptember 2025') -- parse_date_to_iso handles both."""
    html = await fetcher.fetch_html(session, config.DOWNLOADS_URL)
    if not html:
        return []
    items = _extract_simple_table_listing(html, config.DOWNLOADS_URL, "downloads")
    logger.info("Downloads: %d real items found", len(items))
    return items


async def extract_publications(fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """CONFIRMED live 2026-08-25: files/Publication/Publication.html is a
    small, mostly-blank table with exactly one real document (a compliance
    Brochure PDF), reusing the same generic single-column listing shape."""
    html = await fetcher.fetch_html(session, config.PUBLICATIONS_URL)
    if not html:
        return []
    items = _extract_simple_table_listing(html, config.PUBLICATIONS_URL, "publications")
    logger.info("Publications: %d real items found", len(items))
    return items


async def extract_tenders(fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """CONFIRMED live 2026-08-25: files/Footer_Links/tenders.html, 1 table,
    122 rows. Real tender/auction/disposal-notice rows all have a title
    prefixed 'DD.MM.YYYY-...' -- require_leading_date filters out the one
    real non-tender row (a plain link to https://etenders.gov.in/)."""
    html = await fetcher.fetch_html(session, config.TENDERS_URL)
    if not html:
        return []
    items = _extract_simple_table_listing(
        html, config.TENDERS_URL, "tenders", require_leading_date=True
    )
    logger.info("Tenders: %d real items found", len(items))
    return items


# ============================================================================
# Month-grouped listings -- What's New (archive.html) and Careers
# (job_opp.html) share the same real shape: a lone-cell "Month YYYY" header
# row (no link) followed by one-or-more content rows (single cell + a real
# document link). Neither row type has its own explicit date column, so the
# most recent "Month YYYY" header is carried forward as a fallback for rows
# whose own title text has no parseable exact date.
# ============================================================================

def _extract_month_grouped_listing(html: str, page_url: str, source_feed: str) -> List[ScrapedItem]:
    """Same real per-<li> multi-document row shape as
    _extract_simple_table_listing's own docstring documents -- CONFIRMED live
    2026-08-25 against archive.html directly: 51 of its real rows hold 2+
    independently-linked real announcements in one <tr> (e.g. a Deputy
    Director vacancy notice and an unrelated FIU-IND/I4C MoU announcement,
    concatenated with no separator by a whole-row get_text() and silently
    losing the MoU's own real PDF link entirely under a first-anchor-only
    read). Emits one item per real <a href>, same fix."""
    soup = BeautifulSoup(html, "html.parser")
    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []
    seen_hrefs = set()

    for table in soup.find_all("table"):
        current_month_header: Optional[str] = None
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if not tds:
                continue
            anchors = tr.find_all("a", href=True)
            if not anchors:
                # A lone-cell row with no link and no other content is a
                # "Month YYYY" section header -- confirmed live, every real
                # header row on both pages has exactly this shape.
                text = tr.get_text(strip=True)
                if text and _MONTH_YEAR_RE.match(text):
                    current_month_header = text
                continue

            for a in anchors:
                title = a.get_text(strip=True)
                if not title:
                    continue
                url = _resolve_href(page_url, a["href"])
                if url in seen_hrefs:
                    continue
                seen_hrefs.add(url)
                items.append(
                    ScrapedItem(
                        source_id=make_source_id(page_url, title),
                        title=title,
                        url=url,
                        source_url=page_url,
                        source_feed=source_feed,
                        date=parse_date_to_iso(title, month_year_fallback=current_month_header),
                        scraped_at=now,
                    )
                )
    return items


async def extract_whats_new(fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """CONFIRMED live 2026-08-25: files/misc/archive.html, NOT one of the
    build brief's original 6 pages (unconfirmed going in) -- a real "What's
    New" feed, 2 tables (recent + full archive), ~199 real rows across
    2023-2026: inter-agency MoUs (RBI, NABARD, IRDAI, NHB, India-Qatar FIU
    meeting), NBFC non-compliance disclosure lists, recruitment notices,
    auction notices. Best real-site match for Subject: Public Communication &
    Outreach, though not every row is pure PR (the NBFC lists and vacancy
    notices are also cross-posted here) -- classification, not this
    extractor, decides Subject/Instrument Type per item."""
    html = await fetcher.fetch_html(session, config.WHATS_NEW_URL)
    if not html:
        return []
    items = _extract_month_grouped_listing(html, config.WHATS_NEW_URL, "whats_new")
    logger.info("What's New: %d real items found", len(items))
    return items


async def extract_careers(fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """CONFIRMED live 2026-08-25: files/misc/job_opp.html, same month-grouped
    shape as What's New, 54 real rows of recruitment/vacancy notices. No
    Instrument Type in FIU_Regulatory_Taxonomy_v1_0.xlsx fits this content --
    left for the classifier's no-clean-fit rule to surface as needs_review
    rather than invented here; see ../taxonomy-findings.md for the proposed
    fix."""
    html = await fetcher.fetch_html(session, config.CAREERS_URL)
    if not html:
        return []
    items = _extract_month_grouped_listing(html, config.CAREERS_URL, "careers")
    logger.info("Careers: %d real items found", len(items))
    return items


# ============================================================================
# Static single-document pages -- CONFIRMED live 2026-08-25: each of these is
# real, static prose content with NO listing table -- the page itself IS one
# document, not a feed of many. Content comes from the page's own HTML
# (cleaned to Markdown by pipeline.py/extractor.py), not a linked PDF.
# ============================================================================

_STATIC_PAGES = [
    # (config attr name, title, source_feed)
    ("PMLA_ACT_URL", "Prevention of Money Laundering Act, 2002", "legislation"),
    ("SCHEDULED_OFFENCES_URL", "PMLA Scheduled Offences", "legislation"),
    ("PML_RECORDS_RULES_URL", "Prevention of Money-Laundering (Maintenance of Records) Rules, 2005", "legislation"),
    (
        "WMD_SECTION12A_URL",
        "Section 12A of the Weapons of Mass Destruction and Their Delivery Systems "
        "(Prohibition of Unlawful Activities) Act, 2005",
        "legislation",
    ),
    ("FAQ_URL", "FIU-IND Frequently Asked Questions", "faq"),
    ("RTI_URL", "FIU-IND Right to Information", "rti"),
    ("INTERNATIONAL_URL", "FIU-IND International Cooperation", "international"),
]


async def extract_static_pages(fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    now = datetime.utcnow().isoformat()
    items: List[ScrapedItem] = []
    for attr, title, source_feed in _STATIC_PAGES:
        page_url = getattr(config, attr)
        items.append(
            ScrapedItem(
                source_id=make_source_id(page_url, title),
                title=title,
                url=page_url,
                source_url=page_url,
                source_feed=source_feed,
                date=None,
                scraped_at=now,
            )
        )
    logger.info("Static single-document pages: %d items", len(items))
    return items


# ============================================================================
# Annual Reports -- CONFIRMED live 2026-08-25: both real, hosted, real PDFs,
# but orphaned from every crawlable page (not in Downloads.html,
# Publication.html, the About page, or the site's own sitemap.html) -- see
# config.py's ANNUAL_REPORT_SEED_URLS and ../taxonomy-findings.md for the
# discovery trail. Seeded directly rather than skipped.
# ============================================================================

async def extract_annual_reports(config: Config) -> List[ScrapedItem]:
    now = datetime.utcnow().isoformat()
    return [
        ScrapedItem(
            source_id=make_source_id(config.DOWNLOADS_URL, title),
            title=title,
            url=url,
            source_url=config.DOWNLOADS_URL,  # closest real "home" page; not actually linked there, see docstring
            source_feed="annual_reports",
            date=None,
            scraped_at=now,
        )
        for url, title in config.ANNUAL_REPORT_SEED_URLS
    ]


async def scrape_all_sources(fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config) -> List[ScrapedItem]:
    """Scrapes every source and returns the deduplicated pool (by source_id)."""
    results = await asyncio.gather(
        extract_compliance_orders(fetcher, session, config),
        extract_downloads(fetcher, session, config),
        extract_publications(fetcher, session, config),
        extract_tenders(fetcher, session, config),
        extract_whats_new(fetcher, session, config),
        extract_careers(fetcher, session, config),
        extract_static_pages(fetcher, session, config),
        extract_annual_reports(config),
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
        seen[item.source_id] = item  # last write wins, same dedupe convention as cci_scraper
    return list(seen.values())
