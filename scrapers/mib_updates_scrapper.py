#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
MIB (Ministry of Information & Broadcasting) scraper.

STATUS (2026-07-31): Rewritten against REAL live site structure -- the
prior version was written once in a batch commit and never run for real
(no data output, no proof it ever worked). Confirmed live and reachable
with plain `requests` (status 200, real title, no WAF/Akamai signature --
unlike dot.gov.in/meity.gov.in, which are currently blocked for
Playwright). mib.gov.in is a Drupal Views site -- a different CMS
entirely from DoT/MeitY's Next.js template -- nothing was carried over
from those without independent verification here.

CONFIRMED REAL findings this rewrite is built from (live requests,
2026-07-31):

1. Pagination is real and was completely UNHANDLED by the prior version,
   which only ever read page 0 (implicit, no ?page= param) and hardcoded
   MAX_ITEMS_PER_CATEGORY = 10. Real last-page links read from each
   category's own pager: Notices -> page=8 (9 pages), Acts/Policies/
   Guidelines -> page=4 (5 pages), Other Communication -> page=1
   (2 pages). Confirmed real and DISTINCT rows on page 0 vs page 1 of
   Notices (no wrap-around) before trusting this.
2. Real page size is NOT uniform across categories: Notices has 10 rows
   per page; Acts/Policies/Guidelines and Other Communication both have
   20 rows per page (confirmed directly by counting real <tr> elements,
   not assumed from Notices). The prior MAX_ITEMS_PER_CATEGORY=10 global
   cap would have silently dropped half of every Acts/Policies/Guidelines
   and Other Communication page even if pagination had existed.
3. Column shape is NOT uniform: Notices and Other Communication both have
   6 columns (S.No, Title, Date, wings category, Type/Size,
   Download/Details). Acts/Policies/Guidelines has 7 -- an extra
   "Category" column inserted between Date and wings category. The prior
   version's fixed-position cols[3] would have silently mislabeled this
   column as wing_category for Acts/Policies/Guidelines. Fixed here by
   reading each real <td>'s own headers="view-...-table-column" attribute
   (which Drupal already stamps with a stable semantic key) instead of
   positional indexing -- this is real, robust, and requires no per-
   category special-casing.
4. Dates are raw fragile text (DD-MM-YYYY, e.g. "15-07-2026"), not a
   clean aria-label -- confirmed from real rows. The existing
   split-and-reorder normalization already handles this correctly.
5. Title cells have NO link in any real row checked across all 4 fetched
   pages -- detail_page_link will always be None. Code still checks for
   one defensively rather than assuming it can never appear.
6. NO per-section "View Archive" button exists (unlike DoT/MeitY) -- only
   a generic, site-wide footer "Archives" link (confirmed by its real
   context: grouped with Website Policy/Related Links/Sitemap/Help under
   "Useful Links", not tied to any specific category). Not scraped here;
   it is not a real archive of THIS listing's older content, just a
   generic site link.
7. NO grouped/aggregator rows found anywhere across all 4 real pages
   checked (0 download cells with more than one <a> tag) -- confirmed
   real absence, not assumed from never looking.
7b. The 3/203 rows with no ALLOWED_FILE_EXTENSIONS match are NOT
   genuinely fileless -- confirmed by pulling their real raw HTML
   directly (2026-07-31): each has a real <a href> in the download cell
   pointing at an EXTERNAL site instead of a direct file (indiacode.nic.in
   for the two 1994/1995 Cable TV Act/Rules rows; skill.nfdcindia.com for
   the Skill Development notice, one level deeper inside a wrapping <div
   class="external-link-button"> -- still reachable via find_all("a",
   href=True)'s default recursion). Captured separately as
   external_link/link_type rather than folded into pdf_link, since an
   external reference site is genuinely not the same kind of thing as a
   direct downloadable file.
8. No real block/WAF response was ever observed for MIB during this
   investigation (5 real requests, all 200, all real content) -- so
   there is no real "Access Denied" fixture to build exact-match
   detection from, unlike dot_watcher.py's REAL captured 403 page.
   Blocked-detection here is deliberately conservative and generic
   instead of pattern-matching a signature that was never actually seen:
   any non-200 status, OR a 200 response that is missing BOTH of the two
   markers confirmed present on every one of the 5 real successful pages
   fetched (a title ending in "Ministry of Information and Broadcasting"
   AND a real <table class="cols-N"> element) is treated as suspect and
   raised as BlockedError rather than silently treated as "0 real rows".

STATUS (2026-07-31, second pass): the original 3 categories were NOT
MIB's complete real document corpus -- confirmed by going to the real
site navigation directly (not inferred from the 3 hardcoded URLs) and
by a real 18-row document-type index page (/en/documents/reports,
itself a MeitY-style grouped/aggregator view: each row names a real
document Type plus a real per-type count and a "View All" link).
Real findings from this second pass:

9. The Reports index's own per-type counts are CONFIRMED authoritative
   for some categories (its counts for Acts/Policy/Guidelines=89,
   Notices=88, Other Communications=26 exactly match already-scraped
   real data; Advisories=175, Press Releases=514, Budget Overview=9,
   Vacancies=32 all exactly matched a real fetch to each category's own
   last real page) but CONFIRMED STALE for others: Annual Reports
   (index says 45, live site currently has 7), Autonomous Bodies (33
   vs 8 live), Citizen Charter (10 vs 4 live), Monthly Summary for
   Cabinet (46 vs 6 live), Online Reports (21 vs 0 live, real
   views-empty marker), Other Documents (4 vs 0 live, real views-empty
   marker), Tender Notices (12 vs 0 live, real views-empty marker).
   Live listings are authoritative here, not the index -- this scraper
   walks each category's own real pager rather than trusting any
   static count.
10. 3 real sections exist OUTSIDE the Reports index entirely (found via
    direct main-nav / offerings-menu links, not listed among its 18
    rows): CCA (1 real doc), E-Book/Handbook (24 real docs, real date
    format "Mon-YYYY" e.g. "Dec-2025" rather than DD-MM-YYYY, and a
    real "flipbook" link type -- /en/flipbook/N, an internal viewer
    page, not a downloadable file), FM Radio Auctions (23 real docs).
    Confirms the Reports index, while useful, is not itself a
    substitute for checking the real nav directly.
11. "Provisions regarding Official Language" (found in the real nav
    Documents submenu) is CONFIRMED NOT a real document corpus --
    single-column external links to the Rajbhasha government portal,
    no table, no real documents. Correctly excluded here.
12. Column shape varies further than the original 3 categories showed:
    some categories have a real "Financial Year" field instead of (or
    alongside) a date (Accounting and Reports, Budget Overview,
    Detailed Demand for Grant, Internal Audit); Vacancies has TWO real
    date fields (posting date + last date to apply); Autonomous Bodies'
    date field uses a different real header key
    (view-field-date-table-column) than Notices/Advisories/Press
    Releases (view-field-date-range-table-column); Annual Reports only
    has the "-1"-suffixed date key, no base one. Handled via an
    explicit real-key priority list, not a positional guess.
13. Which "view-nothing*-table-column" cell holds the real download
    link vs. the file-size text is NOT consistent: Vacancies has it
    reversed relative to Notices; Accounting and Reports uses a real
    THIRD "nothing-2" column for the link (nothing-1 holds size).
    Fixed by resolving these two roles from real content (does this
    cell contain an <a href>?) instead of trusting a fixed header key,
    rather than hardcoding a position that would silently break on the
    next new category.
14. Detailed Demand for Grant embeds its real file size inside the
    link's own text ("View (12.53 MB)") rather than a separate cell --
    file_info is honestly left None here rather than regex-scraping a
    size back out of link text that was never cleanly separated.
"""

from pathlib import Path
import csv
import json
import hashlib
import re
from datetime import datetime, UTC
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

# -------------------------------------------------
# CONFIG
# -------------------------------------------------

CATEGORIES = {
    "notices": "https://mib.gov.in/en/documents/notification/notices",
    "acts_policy_guidelines": "https://mib.gov.in/en/documents/notification/acts-policy-guidelines",
    "other_communication": "https://mib.gov.in/en/documents/notification/Other-communication",
    # Real, confirmed 2026-07-31 additions -- found via direct site nav
    # and the real 18-row Reports index (see module docstring items
    # 9-11). "Provisions regarding Official Language" deliberately
    # excluded -- confirmed not a real document corpus (external portal
    # links only, no table).
    "advisories": "https://mib.gov.in/en/documents/notification/advisories",
    "press_releases": "https://mib.gov.in/en/documents/notification/press-releases",
    "office_memorandums": "https://mib.gov.in/en/documents/notification/office-memorandums",
    "tender_notices": "https://mib.gov.in/en/offerings/notification/tender-notices",
    "accounting_and_reports": "https://mib.gov.in/en/ministry/budget-account/accounting-and-reports",
    "annual_reports": "https://mib.gov.in/en/documents/annual_reports",
    "autonomous_bodies": "https://mib.gov.in/en/documents/autonomous-bodies",
    "budget_overview": "https://mib.gov.in/en/ministry/budget-and-accounts/budgets-overview",
    "citizen_charter": "https://mib.gov.in/en/documents/citizen_charter",
    "detailed_demand_for_grant": "https://mib.gov.in/en/ministry/budget-account/detail-demand-for-grant",
    "internal_audit": "https://mib.gov.in/en/ministry/budget-account/internal-audits",
    "monthly_summary_for_cabinet": "https://mib.gov.in/en/documents/monthly_summary_for_cabinet",
    "online_reports": "https://mib.gov.in/en/documents/online_reports",
    "other_documents": "https://mib.gov.in/en/document/other_documents",
    "vacancies": "https://mib.gov.in/en/vacancy-and-training",
    "ebook_handbook": "https://mib.gov.in/en/document/e-book-handbook",
    "cca": "https://mib.gov.in/en/chief-controller-of-accounts",
    "fm_radio_auctions": "https://mib.gov.in/en/offerings/FM-radio-auctions",
}

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MASTER_CSV = DATA_DIR / "mib_master.csv"
NEW_JSON = DATA_DIR / "mib_new_entries.json"
DATA_DIR.mkdir(exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

ALLOWED_FILE_EXTENSIONS = (
    ".pdf",
    ".xlsx",
    ".xls",
    ".csv",
    ".doc",
    ".docx",
)

# Real, confirmed defensive cap -- Notices' own real last page was 8; this
# is a backstop against an unexpected runaway loop, not the real stopping
# condition (that is each category's own real last-page number, read live
# from its own pager).
MAX_PAGES_PER_CATEGORY = 100

CSV_FIELDS = [
    "id",
    "date",
    "date_secondary",  # real, confirmed 2026-07-31: Vacancies has a
                       # second, semantically distinct real date field
                       # (last date to apply) alongside "date" (posting
                       # date) -- None for every category that only has
                       # one real date field
    "title",
    "pdf_link",
    "external_link",  # real, confirmed 2026-07-31: a small number of rows
                       # link to an external site (indiacode.nic.in,
                       # skill.nfdcindia.com, wavesindia.org) instead of a
                       # direct file -- captured here rather than silently
                       # dropped when no ALLOWED_FILE_EXTENSIONS match is
                       # found
    "flipbook_link",   # real, confirmed 2026-07-31: E-Book/Handbook rows
                       # link to an internal flipbook viewer page
                       # (/en/flipbook/N), not a downloadable file and not
                       # an external site either -- a real third link
                       # shape, kept separate from both
    "link_type",       # "file" | "external" | "flipbook" | "none" --
                       # explicit rather than leaving callers to infer it
                       # from which link field happens to be populated
    "detail_page_link",
    "pdf_filename",
    "wing_category",
    "notifications_category",  # real, confirmed present ONLY on
                                # acts_policy_guidelines -- None elsewhere,
                                # not fabricated for categories that don't
                                # have it
    "accounting_reports_category",  # real, confirmed present ONLY on
                                # accounting_and_reports (e.g. "Account at
                                # Glance") -- None elsewhere
    "financial_year",  # real, confirmed present on Accounting and
                       # Reports, Budget Overview, Detailed Demand for
                       # Grant, Internal Audit -- these categories often
                       # have NO separate date field at all, so this is
                       # kept as its own honest field rather than forced
                       # into "date"
    "file_info",
    "category",
    "page_number",
    "created_at",
]

# Real, confirmed 2026-07-31: the header key actually used for a row's
# date is NOT consistent across categories -- Notices/Advisories/Press
# Releases/Vacancies use view-field-date-range-table-column, Autonomous
# Bodies/E-Book-Handbook/FM Radio Auctions/CCA use
# view-field-date-table-column, and Annual Reports has ONLY the
# "-1"-suffixed key with no base one. Tried in this order; first real
# match wins.
DATE_FIELD_PRIORITY = (
    "view-field-date-range-table-column",
    "view-field-date-table-column",
    "view-field-date-range-1-table-column",
)

FLIPBOOK_LINK_RE = re.compile(r"/flipbook/\d+", re.I)


class BlockedError(Exception):
    """Raised when a response looks suspect (non-200, or missing the real
    markers every genuine MIB listing page has) rather than silently
    treating it as a real, empty page."""


# -------------------------------------------------
# HELPERS
# -------------------------------------------------

def make_id(title, date, category, link):
    raw = f"{title}|{date}|{category}|{link}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def normalize_date(date_str):
    parts = re.split(r"[./-]", date_str)
    if len(parts) == 3:
        return f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
    return date_str or "unknown-date"


def make_pdf_filename(title, date, extension):
    slug = re.sub(r"[^\w\s-]", "", title.lower())
    slug = re.sub(r"\s+", "-", slug).strip("-")[:80]
    return f"{normalize_date(date)}_{slug}.{extension}"


def ensure_master_csv():
    if not MASTER_CSV.exists():
        with open(MASTER_CSV, "w", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=CSV_FIELDS).writeheader()


def load_existing_ids():
    if not MASTER_CSV.exists():
        return set()
    # encoding="utf-8" required -- same real lesson learned across every
    # other watcher in this project: Windows' default cp1252 locale
    # cannot decode real scraped title text (MIB titles include real
    # non-ASCII punctuation, e.g. curly quotes/en-dashes -- confirmed in
    # live rows fetched during this investigation).
    with open(MASTER_CSV, newline="", encoding="utf-8") as f:
        return {row["id"] for row in csv.DictReader(f)}


# -------------------------------------------------
# BLOCK / SANITY DETECTION
# -------------------------------------------------

def check_response_or_raise(res, url, label):
    if res.status_code != 200:
        raise BlockedError(f"non-200 status {res.status_code} for {label} ({url})")

    text_lower = res.text.lower()
    has_real_title = "ministry of information and broadcasting" in text_lower
    has_real_table = bool(re.search(r'<table class="cols-\d+"', res.text))

    if not (has_real_title and has_real_table):
        raise BlockedError(
            f"response for {label} ({url}) is missing the real markers every "
            f"genuine MIB listing page had during investigation "
            f"(title match={has_real_title}, table match={has_real_table}) -- "
            f"treating as suspect, not as a genuinely empty page"
        )


# -------------------------------------------------
# PAGINATION
# -------------------------------------------------

def find_last_page_number(soup):
    """Reads the real last-page number from the page's own Drupal pager
    (li.pager__item--last > a href="?page=N"). Returns 0 (single page,
    no pager) if no pager is present -- confirmed real possibility if a
    category ever has <= one page of real content, not assumed to always
    exist."""
    last_link = soup.select_one("li.pager__item--last a[href]")
    if not last_link:
        return 0
    match = re.search(r"page=(\d+)", last_link["href"])
    return int(match.group(1)) if match else 0


# -------------------------------------------------
# PARSER
# -------------------------------------------------

def parse_table_row(row, category, base_url, page_number):
    # Real, confirmed fix: read each real <td>'s own headers="view-...-
    # table-column" attribute (Drupal's own stable semantic key) instead
    # of positional cols[N] indexing -- Acts/Policies/Guidelines has a
    # real extra "Category" column that shifts fixed positions relative
    # to Notices/Other Communication.
    cells = {}
    for td in row.find_all("td"):
        # bs4 treats "headers" as a multi-valued attribute (like "class")
        # and returns a list even for the real single-value case observed
        # here (e.g. headers="view-title-table-column") -- found live via
        # a real TypeError on the first actual run, not anticipated in
        # advance.
        raw_key = td.get("headers", "")
        key = " ".join(raw_key) if isinstance(raw_key, list) else raw_key
        if key:
            cells[key] = td

    title_td = cells.get("view-title-table-column")

    date_td = None
    for key in DATE_FIELD_PRIORITY:
        if key in cells:
            date_td = cells[key]
            break
    # Real, confirmed 2026-07-31: Vacancies has TWO distinct real date
    # fields (posting date + last date to apply). Only capture a second
    # one when it's genuinely a different cell from the one already
    # picked above -- Annual Reports' ONLY date field happens to live
    # under the same "-1" key used as Vacancies' secondary field, and
    # must not be double-counted as its own secondary date.
    date_secondary_td = cells.get("view-field-date-range-1-table-column")
    if date_secondary_td is date_td:
        date_secondary_td = None

    wing_td = cells.get("view-field-wings-category-table-column")
    notif_category_td = cells.get("view-field-notifications-category-table-column")
    accounting_category_td = cells.get("view-field-accounting-reports-categor-1-table-column")
    financial_year_td = cells.get("view-field-financial-year-table-column")

    # Real, confirmed 2026-07-31: some categories have neither a real
    # date field (Budget Overview) nor a wing/notifications category --
    # only "title" is universal. financial_year-only rows (Budget
    # Overview, and Accounting and Reports/Detailed Demand for
    # Grant/Internal Audit alongside a real date) are legitimate, not a
    # parse failure.
    if title_td is None or (date_td is None and financial_year_td is None):
        return None

    title = title_td.get_text(" ", strip=True)
    date = date_td.get_text(strip=True) if date_td else None
    date_secondary = date_secondary_td.get_text(strip=True) if date_secondary_td else None
    wing_category = wing_td.get_text(strip=True) if wing_td else None
    notifications_category = notif_category_td.get_text(strip=True) if notif_category_td else None
    accounting_reports_category = accounting_category_td.get_text(strip=True) if accounting_category_td else None
    financial_year = financial_year_td.get_text(strip=True) if financial_year_td else None

    # Real, confirmed 2026-07-31: which "view-nothing*-table-column" cell
    # holds the real download link vs. the file-size text is NOT
    # consistent across categories (see module docstring item 13) --
    # resolved here by real content (does this cell contain a link?)
    # rather than a fixed header key. E-Book/Handbook's real link lives
    # in its own dedicated "view-field-flipbook-link-table-column" cell
    # (not a generic "nothing" placeholder), so it's included as a
    # candidate here too rather than missed by the "nothing*" filter.
    flipbook_field_td = cells.get("view-field-flipbook-link-table-column")
    nothing_tds = [td for key, td in cells.items() if key.startswith("view-nothing")]
    if flipbook_field_td is not None:
        nothing_tds.append(flipbook_field_td)
    download_td = None
    file_info_td = None
    for td in nothing_tds:
        if download_td is None and td.find("a", href=True):
            download_td = td
        elif file_info_td is None:
            file_info_td = td
    file_info = file_info_td.get_text(strip=True) if file_info_td else None

    file_link = None
    file_extension = None
    external_link = None
    flipbook_link = None
    if download_td is not None:
        for a in download_td.find_all("a", href=True):
            href = a["href"].strip()
            href_lower = href.lower()
            if href_lower.endswith(ALLOWED_FILE_EXTENSIONS):
                file_link = urljoin(base_url, href)
                file_extension = href_lower.split(".")[-1]
                break
        if file_link is None:
            # Confirmed real (2026-07-31): a small number of rows link to
            # an external site (indiacode.nic.in, skill.nfdcindia.com,
            # wavesindia.org) or an internal flipbook viewer
            # (/en/flipbook/N, E-Book/Handbook only) instead of a direct
            # file -- find_all("a", href=True) already recurses into
            # descendants, so this reaches the one real case where the
            # <a> sits inside a wrapping <div class="external-link-button">
            # rather than directly in the <td>.
            first_link = download_td.find("a", href=True)
            if first_link:
                href = urljoin(base_url, first_link["href"].strip())
                if FLIPBOOK_LINK_RE.search(href):
                    flipbook_link = href
                else:
                    external_link = href

    link_type = (
        "file" if file_link else
        "flipbook" if flipbook_link else
        "external" if external_link else
        "none"
    )

    # Confirmed real: title cells had no <a> in every row checked during
    # investigation. Still checked defensively rather than assumed to
    # never exist.
    detail_page_link = None
    title_tag = title_td.find("a", href=True)
    if title_tag:
        detail_page_link = urljoin(base_url, title_tag["href"].strip())

    entry_id = make_id(
        title,
        date or financial_year or "",
        category,
        file_link or external_link or flipbook_link or detail_page_link or ""
    )

    return {
        "id": entry_id,
        "date": date,
        "date_secondary": date_secondary,
        "title": title,
        "pdf_link": file_link,
        "external_link": external_link,
        "flipbook_link": flipbook_link,
        "link_type": link_type,
        "detail_page_link": detail_page_link,
        "pdf_filename": (
            make_pdf_filename(title, date, file_extension)
            if file_link and file_extension and date else None
        ),
        "wing_category": wing_category,
        "notifications_category": notifications_category,
        "accounting_reports_category": accounting_reports_category,
        "financial_year": financial_year,
        "file_info": file_info,
        "category": category,
        "page_number": page_number,
        "created_at": datetime.now(UTC).isoformat(),
    }


# -------------------------------------------------
# SCRAPER
# -------------------------------------------------

def scrape_category(category, base_url):
    entries = []
    page_number = 0
    last_page = None
    first_title_seen_per_page = {}

    while True:
        if page_number > MAX_PAGES_PER_CATEGORY:
            print(f"[WARN] {category}: hit defensive MAX_PAGES_PER_CATEGORY cap -- stopping")
            break

        url = base_url if page_number == 0 else f"{base_url}?page={page_number}"
        res = requests.get(url, headers=HEADERS, timeout=30)

        try:
            check_response_or_raise(res, url, f"{category} page {page_number}")
        except BlockedError as e:
            print(f"[BLOCKED] {category} page {page_number}: {e}")
            print(f"[BLOCKED] stopping {category} here -- NOT treating prior pages as complete if this is page 0")
            break

        soup = BeautifulSoup(res.text, "html.parser")

        if last_page is None:
            last_page = find_last_page_number(soup)
            print(f"[INFO] {category}: real last page = {last_page} (from live pager)")

        rows = soup.select("table tbody tr")
        print(f"[INFO] {category} page {page_number}: {len(rows)} real rows found")

        if not rows:
            print(f"[WARN] {category} page {page_number}: 0 rows on a page within the known real page range -- flagging for review, not silently treated as genuinely empty")
            break

        first_title = None
        for row in rows:
            parsed = parse_table_row(row, category, base_url, page_number)
            if parsed:
                if first_title is None:
                    first_title = parsed["title"]
                entries.append(parsed)

        # Wrap-around/loop guard: if this page's first real title matches
        # a title already seen on an earlier page of this same category,
        # stop rather than looping forever -- defensive backstop even
        # though the real last-page number above is the primary signal.
        if first_title in first_title_seen_per_page.values():
            print(f"[WARN] {category} page {page_number}: first row title repeats an earlier page's -- stopping (wrap-around guard)")
            break
        first_title_seen_per_page[page_number] = first_title

        if page_number >= last_page:
            break

        page_number += 1

    return entries


# -------------------------------------------------
# MAIN
# -------------------------------------------------

def main():
    print("[INFO] Starting MIB scraper")

    ensure_master_csv()
    existing_ids = load_existing_ids()
    new_entries = []

    for category, url in CATEGORIES.items():
        print(f"[INFO] Scraping {category}")
        entries = scrape_category(category, url)
        print(f"[INFO] {category}: {len(entries)} total real rows parsed across all pages")

        for entry in entries:
            if entry["id"] not in existing_ids:
                new_entries.append(entry)
                existing_ids.add(entry["id"])

    if new_entries:
        with open(MASTER_CSV, "a", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=CSV_FIELDS).writerows(new_entries)

    with open(NEW_JSON, "w", encoding="utf-8") as f:
        json.dump(new_entries, f, ensure_ascii=False, indent=2)

    print(f"[INFO] New entries added: {len(new_entries)}")


if __name__ == "__main__":
    main()
