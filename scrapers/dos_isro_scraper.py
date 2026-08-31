"""
DOS-ISRO Ecosystem Parser -- offline-testable parsing for all 4 real sources
in the DOS_ISRO_Regulatory_Taxonomy_v1_0.xlsx scope: isro.gov.in, IN-SPACe
(inspace.gov.in), NSIL (nsilindia.co.in), and DOS (dos.gov.in -- confirmed
dead, see below). Supersedes isro_scraper.py, which only covered isro.gov.in
alone -- kept as three of these functions' basis (parse_isro_tenders,
parse_isro_press_releases, parse_isro_annual_reports are carried over
unchanged; see their own docstrings for the real bugs already fixed there).

STATUS (2026-08-19): every function below is verified against real,
live-fetched HTML/JSON, not assumed from the taxonomy workbook's research
notes. Real findings from this build:

1. dos.gov.in is CONFIRMED DEAD -- `curl` returns a connection failure
   (HTTP_STATUS:000), not even a 404. Matches the taxonomy's Schema Note
   assumption exactly. No DOS-specific scraping is attempted; DOS's real
   policy documents are confirmed hosted on isro.gov.in instead (see
   parse_isro_policy_page below).

2. isro.gov.in's "Policies" section is NOT a real listing page -- checked
   live. IndiaSpacePolicy.html is a single-document landing page (one PDF:
   IndianSpacePolicy2023.pdf), and the site's own "Policies" nav filter
   only surfaces 2 items total (India Space Policy 2023 + a generic
   Website Policy page, not space-sector-substantive). The taxonomy's
   other named historical policies (RSDP 2001/2011, 1997 Spacecom Policy,
   Draft SpaceRS 2020) are NOT reachable from any isro.gov.in listing found
   during this build -- flagged as a real gap, not silently assumed absent.
   parse_isro_policy_page() therefore parses a single-document landing
   page shape, not a listing.

3. inspace.gov.in is a ServiceNow Service Portal (confirmed live via
   sp_min.jsx/app_com.jsdbx asset signatures in the raw HTML) -- a
   genuinely different, third site architecture in this project (Drupal
   for DoT/MeitY, static List.js tables for isro.gov.in, ServiceNow here).
   Real content loads via `GET /api/now/sp/page?id=<page_id>&portal_id=...`,
   which returns JSON, NOT a DOM to scrape with BeautifulSoup. CONFIRMED
   this does NOT need Playwright at scrape time -- only needed it once,
   during discovery, to find the API shape. A plain `requests.Session()`
   works: load any real inspace.gov.in page once to get session cookies
   AND extract the real CSRF token (`var g_ck = '...'` embedded in that
   page's own HTML), then pass that token as the `X-UserToken` header on
   subsequent `/api/now/sp/page` calls -- confirmed live, byte-identical
   record count (113) via this method vs. a full Playwright capture.

   Two real pages parsed here:
   - `inspace_authorizations`: a real, structured data table (ServiceNow
     widget field `widget.data.missions`), 113 real individual
     Authorization records confirmed live, spanning
     PMA/IN-SPACe/AUTH/2022/01 through .../2026/139 -- this fills the
     taxonomy's own flagged "not yet inventoried" gap for individual real
     Authorization records.
   - `inspace_ngp_update_page`: a single real document (the NGP PDF),
     embedded as a download link inside a widget's own `widget.template`
     HTML field, NOT `widget.data` -- a different real widget shape from
     Authorizations. CONFIRMED the widget extraction must be scoped to
     `result.containers` only, NOT `result.theme` -- `result.theme` (site-
     wide header/footer chrome, shared across every inspace.gov.in page)
     ALSO contains an unrelated real `sys_attachment.do` link (a footer
     "ICC on Prevention of Sexual Harassment" policy PDF) that would be a
     false positive if the whole JSON tree were searched indiscriminately.

   Other real inspace.gov.in pages exist per the site's own real nav menu
   (Publications, Data Disseminators, Events, Opportunities, International
   Collaboration -- all directly relevant taxonomy Subjects) but are NOT
   yet scraped here -- confirmed present, not yet built, flagged as a
   follow-up rather than silently claimed complete.

4. nsilindia.co.in is Drupal-based (confirmed live: `/sites/default/files/`
   file paths, same convention as DoT/MeitY/MIB), reachable with plain
   `requests`, no WAF/JS-rendering issue observed. Two real pages parsed:
   - `/tenders`: a real custom table (not a generic Drupal Views block --
     confirmed a bespoke markup, not `div.views-row`/`div.announcementbox`).
     Real columns: Title (tender type, e.g. "Request for Proposal (RFP)"),
     Description (contains the real Tender Reference Number, Tender ID,
     and a CPPP external-portal link -- NSIL's own tenders largely route
     bidders to the shared central government eProcurement portal,
     eprocure.gov.in/etenders.gov.in, rather than hosting the bid process
     itself), Tender Start/End Date (REAL machine-readable ISO datetimes
     already present in `<span property="dc:date" ... content="...">` --
     no fragile date-text parsing needed, unlike every other source in
     this file), Attachment (real NIT/EoI/corrigendum PDF links), and a
     real Status column with literal "Open"/"Close" text -- a genuine
     site-provided status signal, confirmed live, the first one of these
     4 sources to have one.
   - `/annual-report`: a real 2-column table (Year | Documents), each
     year's Documents cell holding multiple real PDF links (English/Hindi
     Annual Report, MGT-7/MGT-8 corporate filing forms) -- confirmed live,
     2019-20 through 2024-25.
"""

from bs4 import BeautifulSoup
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin
from datetime import datetime
import re

ISRO_BASE_URL = "https://www.isro.gov.in"
NSIL_BASE_URL = "https://www.nsilindia.co.in"
INSPACE_BASE_URL = "https://www.inspace.gov.in"


def parse_date_from_text(text: str) -> Optional[str]:
    """Parse a date string into ISO format (YYYY-MM-DD). Handles every real
    format confirmed live across all 4 sources: DD.MM.YYYY / DD-MM-YYYY
    (ISRO Tenders' Advt. No. cell), "Month DD, YYYY" / "Mon DD, YYYY" (ISRO
    Press Releases, Annual Reports), and "DD Month, YYYY" (IN-SPACe
    Authorizations, e.g. "16 July, 2026"). Carried over from
    isro_scraper.py -- see that file's history for the two real
    comma/whitespace bugs already fixed here (formats requiring a literal
    comma can never match post-normalization; commas adjacent to digits
    with no space, e.g. "Oct,11,2021", must become a SPACE not empty
    string, or tokens glue together unparseably).

    Extended here for IN-SPACe's Authorization records, hand-entered by
    different people over time with real, wildly inconsistent formats --
    confirmed live: "08Jul 2026" (no space before month), "29th June 2026"
    (ordinal suffix), "27-Mar-26" (2-digit year), "28 Nov. 2025" (trailing
    period after abbreviated month), "11-June-2026" (full month name with
    dashes, not abbreviated). The 3 new normalization steps below and the
    5 new format strings are confirmed safe no-ops against every
    previously-working ISRO/NSIL format -- verified together, not assumed
    independently safe."""
    if not text:
        return None

    text = text.strip()
    text = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", text, flags=re.IGNORECASE)
    # Only strip a period immediately after a LETTER (abbreviation dots like
    # "Nov."), not digit.digit -- blindly stripping every period would break
    # the "%d.%m.%Y" dotted format (e.g. "03.03.2026" -> unparseable
    # "03032026"), confirmed via a regression check before this shipped.
    text = re.sub(r"(?<=[A-Za-z])\.", "", text)
    # "Sept" (4-letter, real hand-entered abbreviation confirmed live on 4
    # real records) isn't recognized by strptime's %b, which requires the
    # standard 3-letter form -- normalize before the digit-letter spacing
    # step below so "30Sept2025"-style runs (none observed, but matches
    # the same messiness pattern as "08Jul") still resolve correctly too.
    text = re.sub(r"\bSept\b", "Sep", text, flags=re.IGNORECASE)
    text = re.sub(r"(\d)([A-Za-z])", r"\1 \2", text)
    text = re.sub(r"\s+", " ", text.replace(",", " ")).strip()

    formats = [
        "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y",
        "%d %B %Y", "%d %b %Y",
        "%B %d %Y", "%b %d %Y",
        "%d-%b-%Y", "%d/%b/%Y", "%d-%B-%Y", "%d/%B/%Y",
        "%d %b %y", "%d-%b-%y", "%d/%b/%y",
        "%Y-%m-%d",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue

    patterns = [
        r'(\d{1,2})[./-](\d{1,2})[./-](\d{4})',
        r'(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})',
        r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s+(\d{4})',
        r'(\d{4})-(\d{1,2})-(\d{1,2})',
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        groups = match.groups()
        try:
            if groups[0].isdigit() and len(groups[0]) == 4:
                return datetime(int(groups[0]), int(groups[1]), int(groups[2])).date().isoformat()
            if groups[0].isdigit():
                return datetime(int(groups[2]), int(groups[1]), int(groups[0])).date().isoformat()
            return datetime.strptime(f"{groups[0]} {groups[1]} {groups[2]}", "%b %d %Y").date().isoformat()
        except ValueError:
            pass

    return None


# ============================================================================
# isro.gov.in -- Tenders.html, Press.html, AnnualReports.html
# (carried over from isro_scraper.py, unchanged logic -- see module
# docstring points 2-4 of that file's history for the real bugs already
# fixed: title-pollution from a nested file-size span, two real comma/
# whitespace date bugs, and the 12-row href="#" placeholder-link defect.)
# ============================================================================

_TENDER_DATE_RANGE_RE = re.compile(
    r'^\w+,\s*(\w+\s+\d{1,2},\s*\d{4})\s*-\s*to\s*\w+,\s*(\w+\s+\d{1,2},\s*\d{4})\s*-\s*(\d{1,2}:\d{2})$'
)


def parse_tender_date_range(text: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    if not text:
        return None, None, None
    m = _TENDER_DATE_RANGE_RE.match(text.strip())
    if not m:
        return None, None, None
    return parse_date_from_text(m.group(1)), parse_date_from_text(m.group(2)), m.group(3)


def parse_isro_tenders(html: str) -> List[Dict]:
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    table = soup.select_one("table.table")
    if not table:
        return documents
    tbody = table.find("tbody")
    if not tbody:
        return documents

    for row in tbody.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue

        centre = cells[0].get_text(strip=True)
        advt_no_cell = row.find("td", class_="advtNo")
        date_cell = row.find("td", class_="date")
        tender_cell = row.find("td", class_="tender")

        link = tender_cell.find("a", href=True) if tender_cell else None
        if not link:
            continue
        url = urljoin(ISRO_BASE_URL, link["href"])

        title = advt_no_cell.get_text(strip=True) if advt_no_cell else link.get_text(strip=True)
        if not title:
            continue

        date_text = date_cell.get_text(strip=True) if date_cell else ""
        opening_date, closing_date, closing_time = parse_tender_date_range(date_text)

        size_span = tender_cell.select_one("span[style]") if tender_cell else None
        file_size = size_span.get_text(strip=True) if size_span else ""

        documents.append({
            "title": title,
            "url": url,
            "centre": centre,
            "published_date": opening_date,
            "opening_date": opening_date,
            "closing_date": closing_date,
            "closing_time": closing_time,
            "published_date_raw": date_text,
            "file_size": file_size,
            "status_hint": None,  # ISRO's own Tenders table has no status column, unlike NSIL's
            "is_pdf": url.lower().endswith(".pdf"),
        })

    return documents


def parse_isro_press_releases(html: str) -> List[Dict]:
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    for table in soup.select("table.table"):
        tbody = table.find("tbody")
        if not tbody:
            continue

        for row in tbody.find_all("tr"):
            link = row.find("a", href=True)
            if not link:
                continue

            href = link["href"].strip()
            url = None if href in ("#", "") else urljoin(ISRO_BASE_URL, href)

            title = link.get("title", "").strip()
            if not title:
                title = re.sub(r"\s+", " ", link.get_text(strip=True))
            if not title:
                continue

            date_cell = None
            for td in row.find_all("td"):
                if td.get("class") and any(c.startswith("date") for c in td["class"]):
                    date_cell = td
                    break
            date_text = date_cell.get_text(strip=True) if date_cell else ""
            published_date = parse_date_from_text(date_text)

            documents.append({
                "title": title,
                "url": url,
                "published_date": published_date,
                "published_date_raw": date_text,
                "is_pdf": bool(url) and url.lower().endswith(".pdf"),
            })

    return documents


def parse_isro_annual_reports(html: str) -> List[Dict]:
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    for card in soup.select("div.blog-entry"):
        link = card.find("a", href=True)
        if not link:
            continue
        url = urljoin(ISRO_BASE_URL, link["href"])

        date_el = card.select_one("p.text-center")
        date_text = date_el.get_text(strip=True) if date_el else ""
        published_date = parse_date_from_text(date_text)

        img = link.find("img")
        fiscal_year = (img.get("title") or img.get("alt") or "").strip() if img else ""
        language_el = link.select_one("p.innerContent + p.innerContent")
        language = language_el.get_text(strip=True).strip("()") if language_el else "English"

        title = f"Annual Report {fiscal_year} ({language})".strip() if fiscal_year else link.get_text(strip=True)

        documents.append({
            "title": title,
            "url": url,
            "published_date": published_date,
            "published_date_raw": date_text,
            "fiscal_year": fiscal_year,
            "is_pdf": url.lower().endswith(".pdf"),
        })

    return documents


# ============================================================================
# isro.gov.in -- Policy landing pages (single document each, NOT a listing
# -- see module docstring point 2). Known real pages, not discovered from
# a listing since none exists.
# ============================================================================

ISRO_POLICY_PAGES = {
    "IndiaSpacePolicy.html": "Indian Space Policy 2023",
}


def parse_isro_policy_page(html: str, page_title_hint: str) -> List[Dict]:
    """Parses a single-document isro.gov.in policy landing page. Returns at
    most one real document -- these pages are not listings (confirmed
    live, see module docstring point 2)."""
    soup = BeautifulSoup(html, "html.parser")
    link = soup.select_one('a[href$=".pdf"]')
    if not link:
        return []
    url = urljoin(ISRO_BASE_URL, link["href"])
    return [{
        "title": page_title_hint,
        "url": url,
        "published_date": None,   # no real per-document date on these landing
                                   # pages -- confirmed live, not fabricated
        "published_date_raw": "",
        "is_pdf": url.lower().endswith(".pdf"),
    }]


# ============================================================================
# nsilindia.co.in -- /tenders, /annual-report
# ============================================================================

_NSIL_REF_RE = re.compile(r"Tender Reference Number in CPPP\s*-\s*([^\r\n<]+)", re.IGNORECASE)
_NSIL_ID_RE = re.compile(r"Tender ID\s*:\s*([^\r\n<]+)", re.IGNORECASE)


def parse_nsil_tenders(html: str) -> List[Dict]:
    """Parses NSIL's real /tenders table -- see module docstring point 4.
    A bespoke custom table, not a generic Drupal Views block."""
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    table = soup.select_one("table.table")
    if not table:
        return documents
    tbody = table.find("tbody")
    if not tbody:
        return documents

    for row in tbody.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 6:
            continue

        tender_type = cells[0].get_text(strip=True)
        description_html = str(cells[1])
        description_text = cells[1].get_text(" ", strip=True)

        ref_match = _NSIL_REF_RE.search(description_html)
        id_match = _NSIL_ID_RE.search(description_html)
        ref_number = ref_match.group(1).strip() if ref_match else None
        tender_id = id_match.group(1).strip() if id_match else None

        # REAL, CONFIRMED: the tender-type cell alone ("Request for
        # Proposal (RFP)") repeats across many rows and is not a stable
        # title -- build a real, distinguishing title from the
        # description's own first line (usually a bold summary sentence)
        # plus the real reference number when present.
        first_line = description_text.split(".")[0].strip() if description_text else tender_type
        title_parts = [p for p in (first_line, ref_number) if p]
        title = " -- ".join(title_parts) if title_parts else tender_type
        if not title:
            continue

        # REAL, CONFIRMED: machine-readable ISO datetimes already present
        # in the date spans' own `content` attribute -- no text parsing
        # needed, unlike every other source in this file.
        start_span = cells[2].select_one("span[content]")
        end_span = cells[3].select_one("span[content]")
        opening_date = start_span["content"][:10] if start_span and start_span.get("content") else None
        closing_date = end_span["content"][:10] if end_span and end_span.get("content") else None

        attachment_link = cells[4].find("a", href=True)
        url = urljoin(NSIL_BASE_URL, attachment_link["href"]) if attachment_link else None

        # REAL, CONFIRMED: a genuine site-provided status signal
        # ("Open"/"Close" text), the first of these 4 sources to have one
        # -- pass through as status_hint per NormalizedDocument's own
        # documented convention (ground truth from the regulator itself).
        status_text = cells[5].get_text(strip=True) if len(cells) > 5 else ""

        documents.append({
            "title": title,
            "url": url,
            "tender_type": tender_type,
            "reference_number": ref_number,
            "tender_id": tender_id,
            "published_date": opening_date,
            "opening_date": opening_date,
            "closing_date": closing_date,
            "status_hint": status_text or None,
            "is_pdf": bool(url) and url.lower().endswith(".pdf"),
        })

    return documents


def parse_nsil_annual_reports(html: str) -> List[Dict]:
    """Parses NSIL's real /annual-report 2-column (Year | Documents) table
    -- see module docstring point 4. Each real PDF link in a year's
    Documents cell becomes its own document row."""
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    table = soup.select_one("table.table")
    if not table:
        return documents
    tbody = table.find("tbody")
    if not tbody:
        return documents

    for row in tbody.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        fiscal_year = cells[0].get_text(strip=True)
        for link in cells[1].find_all("a", href=True):
            title = link.get_text(strip=True)
            if not title:
                continue
            url = urljoin(NSIL_BASE_URL, link["href"])
            documents.append({
                "title": f"{title} {fiscal_year}".strip(),
                "url": url,
                "fiscal_year": fiscal_year,
                "published_date": None,  # no real per-document date on this
                                          # table -- only a fiscal-year label
                "published_date_raw": fiscal_year,
                "is_pdf": url.lower().endswith(".pdf"),
            })

    return documents


# ============================================================================
# inspace.gov.in -- ServiceNow Service Portal JSON (see module docstring
# point 3). These functions parse the ALREADY-FETCHED JSON response of
# GET /api/now/sp/page?id=<page_id>&... -- the HTTP/session/CSRF-token
# bootstrap lives in dos_isro_watcher.py, not here, matching this file's
# offline-testable convention (these functions take already-fetched
# HTML/JSON, never make network calls themselves).
# ============================================================================

def _walk_container_widgets(json_data: dict):
    """Yields each real page-content widget dict from
    result.containers[*].rows[*].columns[*].widgets[*].widget --
    DELIBERATELY excludes result.theme/result.page, which are shared site
    chrome (header/footer) common to every inspace.gov.in page. CONFIRMED
    live: result.theme contains an unrelated real sys_attachment.do link
    (a footer policy PDF) that would be a false positive for any
    page-specific document search if the whole JSON tree were walked
    indiscriminately."""
    result = (json_data or {}).get("result", {})
    for container in result.get("containers") or []:
        for row in container.get("rows") or []:
            for column in row.get("columns") or []:
                for w in column.get("widgets") or []:
                    yield w.get("widget", {})


def _find_data_list(json_data: dict, marker_key: str) -> Optional[List[Dict]]:
    """Generic: finds the first list-of-dicts within the real content
    widgets (see _walk_container_widgets) whose items contain marker_key.
    Robust to the exact widget/row/column index changing between fetches,
    unlike hardcoding a fixed path -- confirmed the real path for
    Authorizations is containers[0].rows[0].columns[0].widgets[0].widget.
    data.missions, but this does not hardcode that."""
    def _search(obj):
        if isinstance(obj, list):
            if obj and isinstance(obj[0], dict) and marker_key in obj[0]:
                return obj
            for item in obj:
                found = _search(item)
                if found is not None:
                    return found
        elif isinstance(obj, dict):
            for v in obj.values():
                found = _search(v)
                if found is not None:
                    return found
        return None

    for widget in _walk_container_widgets(json_data):
        found = _search(widget.get("data"))
        if found is not None:
            return found
    return None


def parse_inspace_authorizations(json_data: dict) -> List[Dict]:
    """Parses the real Authorizations page's JSON -- see module docstring
    point 3. 113 real individual records confirmed live, each identified
    by a real, stable Authorization Number (used as source_id material
    downstream instead of a URL, since these records have no individual
    detail-page URL of their own)."""
    records = _find_data_list(json_data, "u_authorization_number") or []
    documents = []

    for rec in records:
        auth_no = (rec.get("u_authorization_number") or "").strip()
        auth_type = (rec.get("u_authorization_type") or "").strip()
        entity = (rec.get("u_authorized_entity") or "").strip()
        if not auth_no:
            continue

        title_parts = [p for p in (auth_no, auth_type, entity) if p]
        title = ": ".join(title_parts[:1]) + (" -- " + " for ".join(title_parts[1:]) if len(title_parts) > 1 else "")

        auth_date_raw = rec.get("u_authorization_date") or ""
        documents.append({
            "title": title,
            "authorization_number": auth_no,
            "authorization_type": auth_type,
            "authorized_entity": entity,
            "authorization_for": (rec.get("u_authorization_for") or "").strip(),
            "validity": (rec.get("u_validity_of_authorization") or "").strip(),
            "execution_date_raw": (rec.get("u_execution_date") or "").strip(),
            "published_date": parse_date_from_text(auth_date_raw),
            "published_date_raw": auth_date_raw,
            "url": None,  # no per-record detail URL -- see docstring
        })

    return documents


def parse_inspace_ngp(json_data: dict) -> List[Dict]:
    """Parses the real NGP page's JSON -- see module docstring point 3.
    The content lives in a widget's own `template` HTML field (not
    `data`), a different real shape from Authorizations' structured
    array."""
    documents = []
    for widget in _walk_container_widgets(json_data):
        template = widget.get("template") or ""
        if "sys_attachment.do" not in template:
            continue
        soup = BeautifulSoup(template, "html.parser")
        title_el = soup.find(["h1", "h2"])
        title = title_el.get_text(strip=True) if title_el else "Norms, Guidelines and Procedures (NGP)"
        for a in soup.find_all("a", href=True):
            if "sys_attachment.do" not in a["href"]:
                continue
            url = a["href"] if a["href"].startswith("http") else urljoin(INSPACE_BASE_URL, a["href"])
            documents.append({
                "title": title,
                "url": url,
                "published_date": None,  # no real per-document date on this
                                          # page -- confirmed live, not fabricated
                "published_date_raw": "",
                "is_pdf": False,  # sys_attachment.do serves the file but isn't
                                  # itself a .pdf-suffixed URL -- checked via
                                  # Content-Type at download time downstream,
                                  # not assumed here
            })
    return documents


# ============================================================================
# inspace.gov.in -- Publications, Data Disseminators, Events, Opportunities
# (current + archive). Added 2026-08-19 in a second pass, after the
# Authorizations/NGP build above shipped. International Collaboration
# (?id=inspace_international_collaboration) was checked live and confirmed
# to be static prose with no document listing at all -- NOT a real source,
# deliberately not built here.
# ============================================================================

_PUBLICATIONS_DOC_RE = re.compile(
    r'\{\s*title:\s*"([^"]*)"\s*,\s*belowline:\s*"([^"]*)"\s*,\s*url:\s*"([^"]*)"\s*,'
    r'\s*category:\s*"([^"]*)"\s*,\s*isNew:\s*(\d)\s*\}'
)


def parse_inspace_publications(json_data: dict) -> List[Dict]:
    """Parses the real Publications page. REAL, CONFIRMED SHAPE, unlike
    every other inspace.gov.in page in this file: there is no server-side
    data table AND no separate API call -- the entire real document list
    (42 confirmed live) is hardcoded as a JS array literal
    (`c.docs = [{title:..., belowline:..., url:..., category:..., isNew:...}]`)
    inside the widget's own `client_script` field, read by the page's
    Angular controller at render time. Confirmed via a live Playwright
    network capture that NO additional API call happens -- the data
    genuinely never leaves the initial /api/now/sp/page response, just in
    a field (`client_script`, raw JS source) this file doesn't read for
    any other page. Extracted via regex rather than a JS parser since the
    object-literal shape is simple, fixed-field, and fully matched (42/42
    confirmed against the real live script's own raw `{ title:` count)."""
    documents = []
    for widget in _walk_container_widgets(json_data):
        script = widget.get("client_script") or ""
        for title, belowline, url, category, is_new in _PUBLICATIONS_DOC_RE.findall(script):
            title = title.strip()
            if not title:
                continue
            resolved_url = url if url.startswith("http") else urljoin(INSPACE_BASE_URL, url) if url.startswith("/") else None
            # A `url` starting with "?id=" is a link to ANOTHER real
            # inspace.gov.in sub-page (e.g. NGP itself, or a "Coffee Table
            # Book" viewer), not a direct file -- left as None here rather
            # than mis-resolved into a broken relative URL; the title/
            # category/belowline are still real signal even without a
            # direct file link for these few cases.
            documents.append({
                "title": title,
                "url": resolved_url,
                "doc_category": category.strip(),
                "belowline": belowline.strip(),
                "is_new": is_new == "1",
                "published_date": None,   # no real per-document date anywhere
                                           # in this real data shape
                "published_date_raw": "",
            })
    return documents


def parse_inspace_data_disseminators(json_data: dict) -> List[Dict]:
    """Parses the real Data Disseminators page -- a real, structured
    two-level dataset: 46 real disseminator organizations, each with 1+
    real satellite-owner REGISTRATIONS (regNo, e.g. "EO/DDR/2025/63").
    One document row per real registration (the actual regulatory unit),
    not one per organization -- an org with multiple registered satellite
    owners becomes multiple real rows, same granularity choice already
    made for IN-SPACe Authorizations (one row per real Authorization
    Number)."""
    documents = []
    disseminators = _find_data_list(json_data, "orgName") or []
    for org in disseminators:
        org_name = (org.get("orgName") or "").strip()
        for reg in org.get("satelliteOwner") or []:
            reg_no = (reg.get("regNo") or "").strip()
            owner_name = (reg.get("ownerName") or "").strip()
            if not reg_no and not owner_name:
                continue
            title_parts = [p for p in (reg_no, owner_name) if p]
            title = ": ".join(title_parts) if title_parts else org_name
            payload = reg.get("payload") or []
            constellations = reg.get("satelliteConstellations") or []
            reg_date_raw = reg.get("dateOfReg") or ""
            documents.append({
                "title": title,
                "url": None,
                "disseminator_org": org_name,
                "registration_number": reg_no,
                "satellite_owner": owner_name,
                "payload": "; ".join(p.strip() for p in payload if p and p.strip()),
                "satellite_constellations": "; ".join(c.strip() for c in constellations if c and c.strip()),
                "validity": (reg.get("validity") or "").strip(),
                "validity_expired": (reg.get("validityExpired") or "").strip(),
                "published_date": parse_date_from_text(reg_date_raw),
                "published_date_raw": reg_date_raw,
            })
    return documents


def parse_inspace_events(json_data: dict) -> List[Dict]:
    """Parses the real Events page -- a small real dataset (3 confirmed
    live). Each event's real date is a RANGE in an irregular, inconsistent
    format ("14 Sept - 17 Sept, 2026", "13 July - 23 August 2026", "12
    August -18 August, 2026" -- confirmed live, no two formatted the same
    way) -- the event's END date (the last day-month-year fragment found)
    is used as published_date, since that's the more defensible single
    reference point for a multi-day event and is reliably extractable
    across all 3 real formats, confirmed."""
    documents = []
    events = _find_data_list(json_data, "name") or []
    for ev in events:
        name = (ev.get("name") or "").strip()
        if not name:
            continue
        date_raw = ev.get("date") or ""
        candidates = re.findall(r"\d{1,2}\s*[A-Za-z]+\s*,?\s*\d{4}", date_raw)
        published_date = parse_date_from_text(candidates[-1]) if candidates else None
        link = ev.get("linky") or ev.get("link") or ""
        url = link if link.startswith("http") else (urljoin(INSPACE_BASE_URL, link) if link else None)
        documents.append({
            "title": name,
            "url": url,
            "published_date": published_date,
            "published_date_raw": date_raw,
        })
    return documents


def parse_inspace_opportunity_subpage(json_data: dict, title_hint: str) -> Optional[Dict]:
    """Parses ONE real IN-SPACe Opportunity sub-page (an individual EoI, AO,
    RFP, or scheme's own detail page) -- same real widget.template HTML
    shape as NGP, but genuinely bespoke markup per page (no two share a
    template structure -- confirmed live across 5 sampled pages: hero-
    banner layout, plain headernew layout, course-banner layout all seen).
    Returns None if the page has no real content widget. Real title is
    read from whichever heading element the page actually uses
    (.hero-title, .headernew, .course-title, or a bare h1/h2), falling back
    to title_hint (the title already captured from the Opportunities
    listing page) if none match -- confirmed live that real pages vary in
    which one they use, so all are tried rather than assuming one."""
    for widget in _walk_container_widgets(json_data):
        template = widget.get("template") or ""
        if not template:
            continue
        soup = BeautifulSoup(template, "html.parser")
        title_el = soup.select_one(".hero-title, .headernew, .course-title, h1, h2")
        title = title_el.get_text(strip=True) if title_el else title_hint

        attach_url = None
        for a in soup.find_all("a", href=True):
            if "sys_attachment.do" in a["href"]:
                attach_url = a["href"] if a["href"].startswith("http") else urljoin(INSPACE_BASE_URL, a["href"])
                break

        raw_text = soup.get_text("\n", strip=True)
        return {
            "title": title,
            "url": attach_url,
            "raw_text": raw_text if raw_text else None,
            "published_date": None,  # no consistent real per-page date field --
                                      # confirmed varies/absent across sampled pages
            "published_date_raw": "",
        }
    return None


def parse_inspace_opportunities(json_data: dict) -> List[Dict]:
    """Parses the real (current) Opportunities page -- a directory of
    `<article class="info-card">` blocks (grouped under a heading like
    "Expression of Interest / Announcements", "Course"), each containing
    one or more `<li><a href="?id=...">title</a></li>` links to a SEPARATE
    real inspace.gov.in sub-page (not a direct file) -- confirmed live,
    e.g. "EoI for Small-Satellite Launch Complex (SLC)" -> ?id=eoi_slc_2026.
    Each sub-page is its own bespoke real content page (not yet
    individually scraped -- flagged as a real follow-up, not silently
    claimed complete); this function captures the real title + sub-page
    link + card-heading category, which is real, useful signal on its own
    even before that follow-up."""
    documents = []
    for widget in _walk_container_widgets(json_data):
        template = widget.get("template") or ""
        soup = BeautifulSoup(template, "html.parser")
        for card in soup.select("article.info-card"):
            heading_el = card.select_one("h2.info-title") or card.select_one("h2")
            heading = heading_el.get_text(strip=True) if heading_el else ""
            for link in card.select("ul li a[href]"):
                title = link.get_text(strip=True)
                if not title:
                    continue
                href = link["href"]
                url = href if href.startswith("http") else urljoin(f"{INSPACE_BASE_URL}/inspace", href)
                documents.append({
                    "title": title,
                    "url": url,
                    "doc_category": heading,
                    "is_new": bool(link.find_next_sibling("span", class_="new-icon")),
                    "published_date": None,  # no real per-item date on this page
                    "published_date_raw": "",
                })
    return documents


def parse_inspace_opportunities_archive(json_data: dict) -> List[Dict]:
    """Parses the real Opportunities Archive page -- a plain real
    `<table><tr><td><a href="/inspace?id=...">title</a></td></tr>` list
    (confirmed live, ~15+ real closed opportunities), each linking to its
    own real sub-page, same real shape as the current Opportunities page's
    links but flattened into one column instead of grouped cards."""
    documents = []
    for widget in _walk_container_widgets(json_data):
        template = widget.get("template") or ""
        soup = BeautifulSoup(template, "html.parser")
        for link in soup.select("table td a[href]"):
            title = link.get_text(strip=True).lstrip("»").strip()
            if not title:
                continue
            href = link["href"]
            url = href if href.startswith("http") else urljoin(INSPACE_BASE_URL, href)
            documents.append({
                "title": title,
                "url": url,
                "published_date": None,  # no real per-item date on this page
                "published_date_raw": "",
            })
    return documents


# ============================================================================
# Unit Test (self-contained, runnable offline)
# ============================================================================

if __name__ == "__main__":
    SAMPLE_TENDERS_HTML = """
    <table class="table"><tbody class="list">
      <tr>
        <td class="centre text-center">PRL</td>
        <td class="advertiser">Physical Research Laboratory</td>
        <td class="advtNo">PRL/PURCHASE/PT-32/25-26 Dated:03-03-2026</td>
        <td class="date">Tuesday, March 03, 2026 - to Tuesday, March 24, 2026 - 13:00</td>
        <td class="tender">
          <span class="file"><a href="/media_isro/pdf/Tenders/2026/NIT-PT-32.pdf" target="_blank">
            PRL/PURCHASE/PT-32/25-26 Dated:03-03-2026&nbsp;
            <img src="/media_isro/image/icon/pdficons.gif">
            <span style="background:#dad8d4;">219.99 KB</span></a></span>
        </td>
      </tr>
    </tbody></table>
    """
    print("Testing ISRO Tenders parser with sample HTML...")
    docs = parse_isro_tenders(SAMPLE_TENDERS_HTML)
    assert docs[0]["title"] == "PRL/PURCHASE/PT-32/25-26 Dated:03-03-2026"
    assert docs[0]["opening_date"] == "2026-03-03"
    assert docs[0]["closing_date"] == "2026-03-24"
    print("OK")

    SAMPLE_NSIL_TENDERS_HTML = """
    <table class="table"><tbody>
      <tr>
        <td>Request for Proposal (RFP)</td>
        <td><p>Supply and Services of New Website of NSIL<br/>
        Tender Reference Number in CPPP - NSIL/26-27/IT Website/01<br/>
        Tender ID: 2026_NSIL_284597_1</p></td>
        <td><span property="dc:date" content="2026-08-12T16:00:00+05:30">12/08/2026 - 16:00</span></td>
        <td><span property="dc:date" content="2026-09-03T14:30:00+05:30">03/09/2026 - 14:30</span></td>
        <td><a href="/sites/default/files/NIT-1_0.pdf" target="_blank">NIT</a></td>
        <td><span style="color:green;">Open</span></td>
      </tr>
    </tbody></table>
    """
    print("Testing NSIL Tenders parser with sample HTML...")
    docs = parse_nsil_tenders(SAMPLE_NSIL_TENDERS_HTML)
    assert docs[0]["opening_date"] == "2026-08-12"
    assert docs[0]["closing_date"] == "2026-09-03"
    assert docs[0]["status_hint"] == "Open"
    assert docs[0]["reference_number"] == "NSIL/26-27/IT Website/01"
    print("OK")

    SAMPLE_INSPACE_JSON = {
        "result": {
            "theme": {"footer": "<a href='/sys_attachment.do?sys_id=UNRELATED'>Unrelated footer PDF</a>"},
            "containers": [{"rows": [{"columns": [{"widgets": [{"widget": {
                "data": {"missions": [{
                    "u_authorization_number": "PMA/IN-SPACe/AUTH/2026/139",
                    "u_authorization_type": "Undertaking Orbital/Sub-Orbital Launches",
                    "u_authorized_entity": "M/s Skyroot Aerospace Private Limited",
                    "u_authorization_for": "Launch of Vikram-1",
                    "u_authorization_date": "16 July, 2026",
                    "u_validity_of_authorization": "4 August, 2026",
                    "u_execution_date": "18 July, 2026",
                }]}
            }}]}]}]}]
        }
    }
    print("Testing IN-SPACe Authorizations parser with sample JSON...")
    docs = parse_inspace_authorizations(SAMPLE_INSPACE_JSON)
    assert len(docs) == 1
    assert docs[0]["published_date"] == "2026-07-16"
    assert docs[0]["authorization_number"] == "PMA/IN-SPACe/AUTH/2026/139"
    print("OK")
