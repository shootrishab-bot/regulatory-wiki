"""
Offline, Playwright-independent parser for MeitY's document-listing row
markup (div.announcementbox rows) -- built and unit-tested against real
captured HTML (Orders and Notices, pages 1 and 2, human-relayed 2026-07-31)
BEFORE live Playwright access to meity.gov.in is available, the same
discipline used for dot_watcher.py's WAF-block-detection fix
(test_dot_blocked_detection.py).

WHY THIS IS SEPARATE FROM meity_watcher.py's own extract_cards():
meity_watcher.py's extract_cards() queries the live Playwright DOM directly
(page.query_selector_all). This module instead parses a raw HTML string with
BeautifulSoup, so its logic can be exercised offline against real captured
HTML with zero browser/network dependency. meity_watcher.py's
extract_cards() calls parse_rows() against page.content() rather than
duplicating selector logic in a second, untested Playwright-native dialect
-- so the exact code path exercised by these offline tests is the same code
that runs live, not a parallel reimplementation that could silently drift.

CONFIRMED REAL markup this parser is built against (Orders and Notices,
pages 1-2, 2026-07-31):

1. Standard row: div[role="row"].announcementbox, icon span with text
   "draft", title in p.mb-0, date in small.ptype with aria-label in
   DD.MM.YYYY format (parsed here, NOT the visible text -- avoids the
   DD/MM-vs-MM/DD ambiguity that hit DoT's REPORTS section), file size via
   small[aria-label="PDF size X KB/MB"], real PDF link in
   a[id^="btn-"][type="pdf"].
2. Grouped/aggregator row: same announcementbox wrapper, icon text
   "file_copy" instead of "draft", no date, a div.counter-box with the real
   sub-document count, and its a.download-btn (no type="pdf" attribute --
   this is the confirmed, real distinguishing feature from a standard row's
   link) points at a detail page instead of a direct PDF.
"""

from bs4 import BeautifulSoup
from dataclasses import replace
from datetime import date
from typing import Optional
from urllib.parse import urljoin

from normalized_document import NormalizedDocument

BASE_URL = "https://www.meity.gov.in"


def parse_date_ddmmyyyy(aria_label: Optional[str]) -> Optional[str]:
    """Parses a confirmed-real DD.MM.YYYY aria-label into ISO 8601
    (YYYY-MM-DD), per NormalizedDocument.published_date's contract. Returns
    the raw string unparsed (never fabricates a guess) if it doesn't match
    the expected shape -- this is the ONLY date field this parser reads;
    the visible small.ptype text is never used, precisely to avoid the
    DD/MM-vs-MM/DD ambiguity bug that hit DoT's REPORTS section."""
    if not aria_label:
        return None
    parts = aria_label.strip().split(".")
    if len(parts) != 3:
        return aria_label
    day_s, month_s, year_s = parts
    if not (day_s.isdigit() and month_s.isdigit() and year_s.isdigit()):
        return aria_label
    day, month, year = int(day_s), int(month_s), int(year_s)
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return aria_label


def parse_file_size(aria_label: Optional[str]) -> Optional[str]:
    """Strips the confirmed-real "PDF size " prefix from the size
    aria-label (e.g. "PDF size 209.02 KB" -> "209.02 KB")."""
    if not aria_label:
        return None
    prefix = "PDF size "
    if aria_label.startswith(prefix):
        return aria_label[len(prefix):].strip()
    return aria_label.strip()


def _abs_url(href: Optional[str]) -> Optional[str]:
    if not href:
        return None
    if href.startswith("/"):
        return urljoin(BASE_URL, href)
    return href


def parse_rows(html: str) -> list[dict]:
    """Parses every div.announcementbox row out of a MeitY listing page's
    HTML (real captured or live page.content()) into plain dicts. Returns
    both standard document rows and grouped/aggregator rows -- callers must
    check is_group before treating a row as a directly-downloadable
    document (see module docstring finding #2)."""
    soup = BeautifulSoup(html, "html.parser")
    rows = []

    for box in soup.select("div.announcementbox"):
        icon_el = box.select_one("span.material-symbols-outlined")
        icon = icon_el.get_text(strip=True) if icon_el else ""
        is_group = icon == "file_copy"

        title_el = box.select_one("p.mb-0")
        title = title_el.get_text(strip=True) if title_el else ""

        counter_el = box.select_one("div.counter-box")
        group_count = None
        if counter_el:
            counter_text = counter_el.get_text(strip=True)
            group_count = int(counter_text) if counter_text.isdigit() else None

        date_el = box.select_one("small.ptype")
        published_date_raw = date_el.get("aria-label") if date_el else None

        size_el = box.select_one("div.type-size small[aria-label]")
        file_size_raw = size_el.get("aria-label") if size_el else None

        if is_group:
            # Confirmed real: grouped rows' link has no type="pdf" attribute
            # -- this IS the distinguishing signal, not just the icon, so
            # both are checked independently rather than assuming they
            # always agree.
            link_el = box.select_one("a.download-btn")
        else:
            link_el = box.select_one('a[id^="btn-"][type="pdf"]')
            if not link_el:
                # Not observed in the confirmed sample (every real
                # non-grouped row had type="pdf") -- fall back rather than
                # silently drop a row whose shape wasn't anticipated.
                link_el = box.select_one("a.download-btn")

        href = _abs_url(link_el.get("href")) if link_el else None

        rows.append({
            "title": title,
            "is_group": is_group,
            "group_count": group_count,
            "published_date_raw": published_date_raw,
            "published_date": parse_date_ddmmyyyy(published_date_raw),
            "file_size": parse_file_size(file_size_raw),
            "link": href,
        })

    return rows


def find_archive_url(html: str) -> Optional[str]:
    """Reads the real "View Archive" button's href from a listing page's
    HTML, per the confirmed finding that the archive slug does not always
    match the section path (Orders and Notices' listing is
    /documents/orders-and-notices but its real archive is
    /archives?page=orders, not orders-and-notices) -- so this is never
    inferred, only read. Returns None if absent (confirmed real case: Act
    and Policies has no "View Archive" button at all)."""
    soup = BeautifulSoup(html, "html.parser")
    link_el = soup.select_one("a.archivemr")
    if not link_el:
        return None
    return _abs_url(link_el.get("href"))


def row_to_normalized_document(
    row: dict,
    regulator_code: str,
    category_hint: str,
    source_url: str,
) -> NormalizedDocument:
    """Converts a single STANDARD (non-grouped) row into the shared
    NormalizedDocument contract. Grouped rows are not convertible directly
    -- they have no file_url of their own until their detail page is
    expanded (see meity_watcher.py's expand_group_page(), which produces
    its own standard rows to convert)."""
    if row["is_group"]:
        raise ValueError("grouped/aggregator rows must be expanded before normalization, not converted directly")

    return NormalizedDocument(
        regulator_code=regulator_code,
        source_id=row["link"] or row["title"],
        title=row["title"],
        source_url=source_url,
        published_date=row["published_date"],
        file_url=row["link"],
        file_extension_hint="pdf" if row["link"] and row["link"].lower().endswith(".pdf") else None,
        category_hint=category_hint,
    )
