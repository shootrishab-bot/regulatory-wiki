"""
MERC (Maharashtra Electricity Regulatory Commission) watcher -- merc.gov.in.

STATUS (2026-09-10): every endpoint below was discovered and verified against
real, live-fetched HTML/JSON during this build, not assumed from
MERC_Regulatory_Taxonomy_v1_0.xlsx's research notes. Real findings:

1. merc.gov.in is WordPress (theme "merc", WPML multilingual). Its
   `/wp-json/` REST API is CONFIRMED BLOCKED (403 on
   `/wp-json/wp/v2/types`), so the usual WP shortcut is unavailable -- but
   three of its DataTables are backed by real, open, unauthenticated
   `admin-ajax.php` actions that return the ENTIRE table as one JSON
   payload with no pagination and no nonce. Found by reading the theme's own
   `asset/js/custom.js`, which names them literally:
       action=getpostsfororderdatatables        -> Orders        (4,056 rows)
       action=getpostsfordailyordersdatatables  -> Daily Orders  (2,448 rows)
       action=getpostsfordatatables             -> Hearings      (7,071 rows)
   This is the single most valuable thing about this source: ~13.5k real
   records in three HTTP requests, no Playwright, no pagination loop.

2. The Orders feed carries MERC's OWN subject-matter vocabulary in a
   `terms` field -- 25 real distinct values confirmed live (Renewable Energy
   RE 724, Tariff Related 486, Complaint or CGRF 477, Others 432, Open
   Access 401, Power Purchase Agreement 333, ... down to Advice to GOM 2).
   That is real ground truth about what MERC actually adjudicates, and it is
   passed through as `category_hint` rather than discarded. Two of those
   values are Instrument-Type signals rather than subject signals
   ("CORRIGENDUM ORDER" 20, "Interim order" 18, "Clarificatory Order" 10) --
   see merc_adapter.py, which routes those to `instrument_hint` instead.

3. Real historical depth CONFIRMED back to 2000 (6 orders), not 2002 as the
   taxonomy workbook's Schema Note estimated from research -- the workbook
   asked for exactly this check ("worth checking during scraper-build
   research how far back merc.gov.in's own online archive actually goes")
   and the answer is: two years deeper than assumed, continuous through
   2026.

4. The Hearings feed carries a real, site-provided `status` column
   (e.g. "Scheduled"). That is a genuine source-side status signal of the
   same kind as MTCTE's Active/Expired column -- but it describes a HEARING's
   lifecycle, not an INSTRUMENT's, so it is deliberately NOT mapped onto the
   taxonomy's Status facet. See merc_adapter.py's `_hearing_status_note`.

5. Several navigation entries are hub pages, not listings: `/existing-regulations/`,
   `/repealed-regulations/`, `/license-issued/`, `/rules-by-goi/`,
   `/electricity-policy/`, `/archive/`, `/electricity-tariff-and-fac/`,
   `/e-public-consultation/` and `/demand-flexibility-dsm-2/` render zero
   `<table>` rows and instead link out to per-category archives under
   `/regulation_type/`, `/policy_type/`, `/report-type/`, `/guideline_type/`
   and `/goi_rule_noti/`.

   REAL BUG FOUND AND FIXED during this build: the first version of this
   scraper scoped hub-link discovery to the page's `<article>` element on the
   assumption that MERC's site-wide nav sits outside it. It does not --
   `nav#cssmenu` is INSIDE `<article>` on every page, and its sub-menus
   contain 13 links matching exactly the per-category URL shapes above. The
   result was that all nine hub pages "discovered" the same 13 nav links and
   the run emitted the same Tariff Policies / Annual Reports / Guidelines
   rows nine times over under nine different feed names. Confirmed by walking
   a matched link's real ancestor chain: nav links resolve to
   `article > div.nav-bar > nav#cssmenu > ul > li.menu-item`, whereas genuine
   content links resolve to `div.container-fluid > div.container-box`. The
   fix is _content_root(): drop nav/header/footer outright, then prefer
   `div.container-box` as the root. Dedup alone would NOT have caught this --
   the rows carried different feed labels, so they were not identical.

6. Real multi-attachment rows exist and are meaningful, not duplicates: 184
   of 4,056 Orders carry 2-4 attachments, and the second one is typically a
   DIFFERENT instrument produced by the same order (e.g. Case No. 49 of 2026
   attaches both "MERC Order Case No. 49 of 2026" and the resulting
   "Transmission Licence 06 of 2026"). Each attachment is therefore emitted
   as its own row -- collapsing them would silently drop real licences.
   43 Orders rows carry NO attachment at all and are emitted with a null
   file_url rather than dropped.

Output: scrapers/data/merc_raw.json (one flat list of raw row dicts, each
tagged with the feed it came from). scrapers/merc_adapter.py converts that
into the NormalizedDocument contract.

Run:
    python scrapers/merc_watcher.py                 # full scrape
    python scrapers/merc_watcher.py --skip-tables   # JSON feeds only (fast)
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Iterable

import requests
from bs4 import BeautifulSoup

BASE = "https://merc.gov.in"
AJAX = f"{BASE}/wp-admin/admin-ajax.php"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
OUT_PATH = os.path.join(DATA_DIR, "merc_raw.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

REQUEST_TIMEOUT = 180
POLITE_DELAY = 0.4


# ---------------------------------------------------------------------------
# JSON (admin-ajax) feeds
# ---------------------------------------------------------------------------
# `action` -> (feed name, section label shown to a human). All three are
# unauthenticated GETs returning {"data": [...]} with the whole table.
JSON_FEEDS = [
    ("getpostsfororderdatatables", "orders", "Orders", f"{BASE}/orders-details/"),
    ("getpostsfordailyordersdatatables", "daily_orders", "Daily Orders", f"{BASE}/orders-details/"),
    ("getpostsfordatatables", "hearings", "Hearings / Cause List", f"{BASE}/hearing/"),
]


# ---------------------------------------------------------------------------
# HTML table feeds
# ---------------------------------------------------------------------------
# Each entry is (path, feed_name, human section label). Pages whose `<article>`
# contains no table but does contain per-category archive links are treated as
# hubs automatically -- see scrape_table_page().
TABLE_FEEDS: list[tuple[str, str, str]] = [
    ("/press-release/", "press_release", "Press Release"),
    ("/press_release/", "whats_new", "What's New"),
    ("/existing-regulations/", "regulations_existing", "Existing Regulations"),
    ("/repealed-regulations/", "regulations_repealed", "Repealed Regulations"),
    ("/regulation_type/draft-regulations/", "regulations_draft", "Draft Regulations"),
    ("/guideline_type/existing-guidelines/", "guidelines_existing", "Existing Guidelines"),
    ("/guideline_type/repealed-guidelines/", "guidelines_repealed", "Repealed Guidelines"),
    ("/electricity-policy/", "policy", "Electricity Policy"),
    ("/policy_type/tariff-policies/", "policy_tariff", "Tariff Policies"),
    ("/the-electricity-act-2003/", "act_electricity", "The Electricity Act, 2003"),
    ("/energy-conservation-act/", "act_energy_conservation", "Energy Conservation Act"),
    ("/rules-by-goi/", "rules", "Rules and Notifications"),
    ("/goi_rule_noti/rules-by-gom/", "rules_gom", "Rules by GoM"),
    ("/goi_rule_noti/rules-by-notification/", "rules_notification", "Notifications"),
    ("/report-type/annual-reports/", "report_annual", "Annual Reports"),
    ("/report-type/annual-account-reports/", "report_annual_accounts", "Annual Account Reports"),
    ("/report-type/distribution-related/", "report_distribution", "Reports - Distribution"),
    ("/report-type/transmission-related/", "report_transmission", "Reports - Transmission"),
    ("/report-type/generation-related/", "report_generation", "Reports - Generation"),
    ("/report-type/other-reports/", "report_other", "Other Reports"),
    ("/report-type/others/", "report_others", "Reports - Others"),
    ("/license-issued/", "licenses", "Licences Issued"),
    ("/tenders_/", "tenders", "Tenders"),
    ("/rti/", "rti", "RTI"),
    ("/rti-rules/", "rti_rules", "RTI Rules"),
    ("/rti-circulars/", "rti_circulars", "RTI Circulars"),
    ("/rti-replies/", "rti_replies", "RTI Replies"),
    ("/proactive-disclosures/", "rti_disclosures", "Proactive Disclosures"),
    ("/appeals-and-responses/", "rti_appeals", "RTI Appeals and Responses"),
    ("/sac-meetings/", "sac_meetings", "Minutes of SAC Meetings"),
    ("/advice-to-goms/", "advice_gom", "Advice to GoM"),
    ("/e-public-consultation/", "public_consultation", "e-Public Consultation"),
    ("/electricity-tariff-and-fac/", "tariff_fac", "Electricity Tariff / FAC"),
    ("/demand-flexibility-dsm-2/", "dsm", "Demand Flexibility / DSM"),
    ("/mumbai-distribution-network-assessment-committee-m-dnac/", "m_dnac", "Mumbai Parallel Operations (M-DNAC)"),
    ("/sop-data/", "sop_data", "Standards of Performance Data"),
    ("/vacancies/", "vacancies", "Vacancies"),
    ("/archive/", "archive", "Archive"),
]

# Hub pages link to their sub-archives with no single URL convention -- eight
# distinct shapes are confirmed live: /regulation_type/, /policy_type/,
# /report-type/, /guideline_type/, /goi_rule_noti/, /licences-issued-type/,
# /regulations_goi/, /demand_dsm_category/, /electric/, plus plain top-level
# slugs (/consumer-information/, /legal-opinion/, /instruction-manual/). Rather
# than enumerate a list that silently goes stale, follow ANY same-host,
# non-file link found in the content root -- which is safe only because
# _content_root() removes the nav (see finding 5). Depth is capped at 1.
_NON_HUB_RE = re.compile(r"\?|#|/(wp-content|wp-admin|wp-json|wp-includes)/", re.I)


class Blocked(Exception):
    """The site refused us (403/WAF) -- a first-class outcome, not an error."""


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def _get(session: requests.Session, url: str, **kwargs: Any) -> requests.Response:
    resp = session.get(url, timeout=REQUEST_TIMEOUT, **kwargs)
    if resp.status_code in (401, 403, 429):
        raise Blocked(f"HTTP {resp.status_code} for {url}")
    resp.raise_for_status()
    return resp


def _sha1(*parts: str) -> str:
    return hashlib.sha1("||".join(p or "" for p in parts).encode("utf-8")).hexdigest()[:20]


def _clean(text: str | None) -> str:
    """Collapse whitespace and decode HTML entities.

    Both are real, confirmed needs. MERC's WordPress output carries \xa0 and
    \r\n inside description cells, and the Hearings JSON feed ships
    entity-encoded text straight through the API without decoding -- real
    example: "Petition of TP Parivart Ltd. &amp; Tata Steel Ltd." Left alone,
    that "&amp;" is stored verbatim in the document title and shown to a
    reader.
    """
    if not text:
        return ""
    return re.sub(r"\s+", " ", html.unescape(text).replace("\xa0", " ")).strip()


def _iso_from_ddmmyyyy(raw: str | None) -> str | None:
    """MERC uses DD-MM-YYYY in every table and JSON feed; the JSON feeds also
    ship a parallel `timestamp` field (YYYYMMDD for orders, a unix epoch for
    hearings) which is preferred where present because it needs no parsing."""
    if not raw:
        return None
    raw = _clean(raw)
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d", "%d-%b-%Y", "%d %B %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _iso_from_timestamp(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = str(raw).strip()
    if re.fullmatch(r"\d{8}", raw):  # orders/daily orders: YYYYMMDD
        try:
            return datetime.strptime(raw, "%Y%m%d").date().isoformat()
        except ValueError:
            return None
    if re.fullmatch(r"\d{9,11}", raw):  # hearings: unix epoch seconds
        try:
            return datetime.fromtimestamp(int(raw), tz=timezone.utc).date().isoformat()
        except (ValueError, OSError):
            return None
    return None


# ---------------------------------------------------------------------------
# JSON feed scraping
# ---------------------------------------------------------------------------
def _title_from_filename(url: str) -> str:
    """A readable title from a merc.gov.in upload filename.

    MERC's own filenames are genuinely descriptive -- they are typed by the
    person uploading, not generated -- so this recovers real text rather than
    inventing any: "1.-Reserved-for-Order-Statement-01.09.2026.pdf" ->
    "Reserved for Order Statement".

    Only three things are stripped, each for a confirmed real reason:
      - a leading serial number ("1.-", "12_") the uploader used for ordering;
      - a trailing DD.MM.YYYY date, which duplicates the row's own date field;
      - a trailing WordPress dedup suffix ("-1", "-2"), added by the CMS when
        a filename collides, capped at 2 digits so a real trailing YEAR is
        never eaten. That cap matters: an earlier version stripped any
        trailing digits and turned "Order-Case-No.-72-of-2026" into
        "Order Case No. 72 of", losing the year from the title.
    """
    stem = urllib.parse.unquote(url.rsplit("/", 1)[-1])
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", stem)
    stem = stem.replace("_", " ").replace("-", " ")
    stem = re.sub(r"^[\d.\s]+", "", stem)
    stem = re.sub(r"\s+\d{1,2}[.\-/\s]\d{1,2}[.\-/\s]\d{2,4}\s*$", "", stem)
    stem = re.sub(r"(?<=[A-Za-z])\s+\d{1,2}$", "", stem)
    # ...and the same suffix after a year ("... 2021 2" -> "... 2021"), capped
    # at ONE digit here so a real fiscal-year pair ("Annual Report 2024 25")
    # keeps its second half.
    stem = re.sub(r"(?<=\d{4})\s+\d$", "", stem)
    return _clean(stem)


def _attachments_from_json(value: Any) -> list[dict[str, str]]:
    """The three feeds encode attachments three different ways, all confirmed
    live:
      orders        -> list[{"name","url_id","url"}], or the literal string
                       "file_not_found"
      daily_orders  -> a single "url^label" string
      hearings      -> list[{"url_id","url"}] under `pdfFileDet` (no name)
    """
    out: list[dict[str, str]] = []
    if not value or value == "file_not_found":
        return out
    if isinstance(value, str):
        url, _, name = value.partition("^")
        if url.startswith("http"):
            out.append({"url": url, "name": _clean(name)})
        return out
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict) and str(item.get("url", "")).startswith("http"):
                out.append({"url": item["url"], "name": _clean(item.get("name"))})
    return out


def scrape_json_feed(
    session: requests.Session, action: str, feed: str, section: str, source_url: str
) -> list[dict[str, Any]]:
    resp = _get(
        session,
        AJAX,
        params={"action": action},
        headers={"X-Requested-With": "XMLHttpRequest", "Referer": source_url},
    )
    payload = resp.json()
    rows = payload.get("data", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ValueError(f"{action}: expected a list of rows, got {type(rows).__name__}")

    out: list[dict[str, Any]] = []
    for row in rows:
        if feed == "hearings":
            # `desc` packs three fields separated by "^": medium, description,
            # case number -- the theme's own render function splits on exactly
            # this, see custom.js columnDefs targets:2.
            parts = str(row.get("desc", "")).split("^")
            medium = _clean(parts[0] if parts else "")
            description = _clean(parts[1] if len(parts) > 1 else "")
            case_no = _clean(parts[2] if len(parts) > 2 else row.get("case_num"))
            title = description or f"Hearing in Case No. {case_no}"
            attachments = _attachments_from_json(row.get("pdfFileDet"))
            published = _iso_from_timestamp(row.get("timestamp"))
            # hearing_date is "Thu 29/10/2026 11:00:00 AM" -- the epoch
            # timestamp beside it is authoritative and needs no parsing.
            status_label = _clean(row.get("status"))
            extra = {"medium": medium, "hearing_date": _clean(row.get("hearing_date"))}
        elif feed == "daily_orders":
            case_no = _clean(row.get("case_no"))
            attachments = _attachments_from_json(row.get("attachment"))
            # REAL DATA-QUALITY BUG FOUND AND FIXED: the Daily Orders feed's
            # attachment label is the CASE NUMBER, not a description -- 2,078
            # of 2,448 rows would otherwise be stored with a title like
            # "171 of 2025 and 201 of 2025", which is unclassifiable and
            # unreadable in a listing. The real descriptive text on these rows
            # lives in the PDF's own filename ("1.-Reserved-for-Order-
            # Statement-01.09.2026.pdf"), so the filename stem is the honest
            # title source and the case number stays in its own field.
            title = _title_from_filename(attachments[0]["url"]) if attachments else ""
            if not title:
                title = f"Daily Order in Case No. {case_no}" if case_no else "Daily Order"
            published = _iso_from_timestamp(row.get("timestamp")) or _iso_from_ddmmyyyy(row.get("order_date"))
            status_label = ""
            extra = {}
        else:  # orders
            case_no = _clean(row.get("case_no"))
            title = _clean(row.get("order_desc"))
            attachments = _attachments_from_json(row.get("attachment"))
            published = _iso_from_timestamp(row.get("timestamp")) or _iso_from_ddmmyyyy(row.get("order_date"))
            status_label = ""
            extra = {"terms": _clean(row.get("terms"))}

        base = {
            "feed": feed,
            "section": section,
            "source_url": source_url,
            "title": title,
            "case_no": case_no,
            "published_date": published,
            "status_label": status_label,
            **extra,
        }
        out.extend(_explode_attachments(base, attachments))
    return out


# An attachment label that identifies its document on its own, vs one that only
# makes sense next to the parent row. "Transmission Licence 06 of 2026" is the
# former; "Postponed Notice", "Q3", "Marathi", "Annexure" are the latter.
_SUBSTANTIVE_NAME_RE = re.compile(r"\d{4}|case\s*no|licence|license|regulation", re.I)


def _row_title(parent_title: str, attachment_name: str, index: int) -> str:
    """The honest title for one attachment's row.

    REAL BUG FOUND AND FIXED (2026-09-10, from reading a real 100-document
    classified sample): the first version used the attachment's own name for
    every attachment after the first, on the reasoning that a second
    attachment is usually a different instrument. That is true for Orders --
    Case No. 49 of 2026 attaches both the Order and the "Transmission Licence
    06 of 2026" it grants -- but false for Hearings, where the second
    attachment is a generic re-listing slip labelled "Postponed Notice". The
    result was 979 hearing rows whose title was the bare string "Postponed
    Notice", with the real petition description thrown away, plus 192 SOP rows
    titled "Q3"/"Q2"/"Q4". 1,445 rows (7% of the corpus) had titles too thin
    to classify or to read in a list; the classifier's own low-confidence
    output on them (0.40) is what surfaced it.

    So: an attachment name is used alone only when it identifies the document
    on its own. Otherwise it qualifies the parent title rather than replacing
    it, which keeps BOTH real facts -- what the matter is, and which document
    in that matter this row is.
    """
    attachment_name = attachment_name.strip()
    parent_title = parent_title.strip()
    if index == 0 or not attachment_name:
        return parent_title or attachment_name
    if len(attachment_name) >= 40 or _SUBSTANTIVE_NAME_RE.search(attachment_name):
        return attachment_name
    if not parent_title:
        return attachment_name
    return f"{attachment_name} — {parent_title}"


def _explode_attachments(base: dict[str, Any], attachments: list[dict[str, str]]) -> list[dict[str, Any]]:
    """One raw row per attachment (see module docstring finding 6). A row with
    no attachment is still emitted, with file_url=None -- 43 real Orders rows
    are in that state and dropping them would silently lose real decisions."""
    if not attachments:
        row = dict(base)
        row["file_url"] = None
        row["attachment_name"] = ""
        row["attachment_index"] = 0
        row["attachment_count"] = 0
        row["source_id"] = _sha1(
            base["feed"], base.get("case_no", ""), base.get("title", ""), base.get("published_date") or ""
        )
        return [row]

    rows = []
    for idx, att in enumerate(attachments):
        row = dict(base)
        row["file_url"] = att["url"]
        row["attachment_name"] = att.get("name", "")
        row["attachment_index"] = idx
        row["attachment_count"] = len(attachments)
        row["title"] = _row_title(base.get("title", ""), att.get("name", ""), idx)
        row["source_id"] = _sha1(base["feed"], att["url"])
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# HTML table scraping
# ---------------------------------------------------------------------------
# Header text -> logical column. Matched case-insensitively on a normalized
# header string. Confirmed against all 7 real header shapes MERC uses.
_COLUMN_ALIASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^s\.?\s*no\.?$|^sr\.?\s*no\.?$"), "serial"),
    (re.compile(r"^attachments?$|^download"), "attachments"),
    (re.compile(r"^type$"), "type"),
    (re.compile(r"^(description|title|subject|particulars)$"), "title"),
    (re.compile(r"^(name of applicant|applicant)$"), "applicant"),
    (re.compile(r"reply date"), "reply_date"),
    (re.compile(r"received date"), "received_date"),
    (re.compile(r"^date$|date$"), "date"),
]


def _map_columns(header_cells: list[str]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for idx, raw in enumerate(header_cells):
        label = _clean(raw).lower()
        for pattern, name in _COLUMN_ALIASES:
            if pattern.search(label):
                # Don't let a later generic "date" alias overwrite a more
                # specific reply/received date already assigned.
                mapping.setdefault(idx, name)
                break
    return mapping


def _content_root(soup: BeautifulSoup):
    """The page region holding real content, with the site-wide chrome removed.

    MERC's nav is inside <article> (see module docstring finding 5), so
    <article> alone is NOT a usable scope. Strip the chrome first, then prefer
    `div.container-box`, which is what genuine content links and tables sit
    inside on every real page checked."""
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    for selector in ("#cssmenu", ".nav-bar", ".footer", "#head-mobile", "#search-form"):
        for tag in soup.select(selector):
            tag.decompose()
    boxes = soup.select("div.container-box")
    if boxes:
        # A page can render several container-boxes (e.g. Rules by GoI splits
        # its own categories); wrap them so callers see one root.
        wrapper = soup.new_tag("div")
        for box in boxes:
            wrapper.append(box.extract())
        return wrapper
    return soup.find("article") or soup.body


def parse_table_page(html: str, feed: str, section: str, page_url: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Returns (rows, hub_links). hub_links is non-empty only for a hub page
    -- a page whose <article> holds no data table but does link to per-category
    archives."""
    soup = BeautifulSoup(html, "lxml")
    root = _content_root(soup)
    if root is None:
        return [], []

    rows: list[dict[str, Any]] = []
    for table in root.find_all("table"):
        all_tr = table.find_all("tr")
        if len(all_tr) < 2:
            continue
        header_cells = [c.get_text(" ", strip=True) for c in all_tr[0].find_all(["th", "td"])]
        columns = _map_columns(header_cells)
        body = table.find("tbody")
        data_rows = body.find_all("tr") if body else all_tr[1:]

        for tr in data_rows:
            cells = tr.find_all("td")
            if not cells or cells is all_tr[0]:
                continue
            values: dict[str, str] = {}
            for idx, cell in enumerate(cells):
                key = columns.get(idx)
                if key and key != "serial":
                    values[key] = _clean(cell.get_text(" ", strip=True))

            attachments = _links_from_row(tr)
            title = values.get("title") or values.get("applicant") or ""
            if values.get("applicant") and values.get("title"):
                # RTI replies/appeals: "<subject> (applicant: <name>)" keeps
                # both real fields without inventing a new schema field.
                title = f"{values['title']} — {values['applicant']}"
            if not title and attachments:
                title = attachments[0].get("name") or ""
            if not title:
                continue

            published = (
                _iso_from_ddmmyyyy(values.get("date"))
                or _iso_from_ddmmyyyy(values.get("reply_date"))
                or _iso_from_ddmmyyyy(values.get("received_date"))
            )
            base = {
                "feed": feed,
                "section": section,
                "source_url": page_url,
                "title": title,
                "case_no": "",
                "published_date": published,
                "status_label": "",
                "terms": values.get("type", ""),
            }
            rows.extend(_explode_attachments(base, attachments))

    hub_links: list[str] = []
    if not rows:
        # A hub page can ALSO carry loose file links directly in its content
        # area with no table at all (confirmed: /rules-by-goi/ links the
        # Electricity (Amendment) Rules, 2022 PDF inline). Those are real
        # documents and are emitted rather than lost to the hub branch.
        loose = _links_from_row(root)
        if loose:
            base = {
                "feed": feed,
                "section": section,
                "source_url": page_url,
                "title": "",
                "case_no": "",
                "published_date": None,
                "status_label": "",
                "terms": "",
            }
            for link in loose:
                if not link.get("name"):
                    continue
                rows.extend(_explode_attachments({**base, "title": link["name"]}, [link]))

        page_path = page_url.rstrip("/")
        for a in root.select("a[href]"):
            href = (a.get("href") or "").strip()
            if href.startswith("/"):
                href = BASE + href
            if not href.startswith(BASE) or _NON_HUB_RE.search(href[len(BASE):]):
                continue
            if _FILE_RE.search(href) or href.rstrip("/") in (page_path, BASE):
                continue
            if href not in hub_links:
                hub_links.append(href)
    return rows, hub_links


_FILE_RE = re.compile(r"\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png)(\?|$)", re.I)


def _links_from_row(tr) -> list[dict[str, str]]:
    """Real MERC rows repeat the same href twice (a download icon and a view
    icon, see custom.js's render function), and draft-regulation rows carry
    several genuinely different files. Dedup by URL, preserve order."""
    seen: dict[str, dict[str, str]] = {}
    for a in tr.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith("/"):
            href = BASE + href
        if not href.startswith("http") or not _FILE_RE.search(href):
            continue
        if href in seen:
            continue
        name = _clean(a.get("title") or a.get_text(" ", strip=True))
        # The icon anchors carry title="Download X Report"/"View X Report".
        name = re.sub(r"^(download|view)\s+", "", name, flags=re.I)
        name = re.sub(r"\s+report$", "", name, flags=re.I)
        seen[href] = {"url": href, "name": name}
    return list(seen.values())


def scrape_table_page(
    session: requests.Session,
    path_or_url: str,
    feed: str,
    section: str,
    depth: int = 0,
    visited: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Fetch one listing page; if it is a hub, also fetch its sub-archives.

    `visited` is shared across the whole run so a sub-archive reachable from
    two different hubs (real: /report-type/others/ is linked from several) is
    fetched once, not once per hub.
    """
    visited = visited if visited is not None else set()
    url = path_or_url if path_or_url.startswith("http") else BASE + path_or_url
    key = url.rstrip("/")
    if key in visited:
        return []
    visited.add(key)

    resp = _get(session, url)
    rows, hub_links = parse_table_page(resp.text, feed, section, url)
    if depth >= 1:
        return rows

    # Loose file links and sub-archives can BOTH be present on one hub (real:
    # /rules-by-goi/ carries an inline Rules PDF *and* six sub-categories), so
    # a non-empty `rows` here must not short-circuit the descent.
    for link in hub_links:
        slug = link.rstrip("/").rsplit("/", 1)[-1]
        time.sleep(POLITE_DELAY)
        try:
            rows.extend(
                scrape_table_page(
                    session,
                    link,
                    f"{feed}:{slug}",
                    f"{section} — {slug.replace('-', ' ')}",
                    depth + 1,
                    visited,
                )
            )
        except (Blocked, requests.RequestException) as exc:
            print(f"    [warn] hub sub-page failed: {link} ({exc})", file=sys.stderr)
    return rows


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def scrape(skip_tables: bool = False) -> list[dict[str, Any]]:
    session = _session()
    scraped_at = datetime.now(timezone.utc).isoformat()
    all_rows: list[dict[str, Any]] = []

    for action, feed, section, source_url in JSON_FEEDS:
        print(f"[merc] JSON feed {feed} ({action}) ...")
        try:
            rows = scrape_json_feed(session, action, feed, section, source_url)
        except (Blocked, requests.RequestException, ValueError) as exc:
            print(f"  [error] {feed}: {exc}", file=sys.stderr)
            continue
        print(f"  -> {len(rows)} rows")
        all_rows.extend(rows)
        time.sleep(POLITE_DELAY)

    if not skip_tables:
        visited: set[str] = set()
        for path, feed, section in TABLE_FEEDS:
            print(f"[merc] table feed {feed} ({path}) ...")
            try:
                rows = scrape_table_page(session, path, feed, section, visited=visited)
            except (Blocked, requests.RequestException) as exc:
                print(f"  [error] {feed}: {exc}", file=sys.stderr)
                continue
            print(f"  -> {len(rows)} rows")
            all_rows.extend(rows)
            time.sleep(POLITE_DELAY)

    # Dedup on source_id: the same PDF genuinely appears in more than one
    # section on this site (e.g. a tariff order under both Orders and
    # Electricity Tariff/FAC). First occurrence wins, so the more specific
    # feed listed earlier in TABLE_FEEDS keeps the row.
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for row in all_rows:
        if row["source_id"] in seen:
            continue
        seen.add(row["source_id"])
        row["scraped_at"] = scraped_at
        deduped.append(row)

    dropped = len(all_rows) - len(deduped)
    if dropped:
        print(f"[merc] dropped {dropped} cross-section duplicate rows")
    return deduped


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape merc.gov.in")
    parser.add_argument("--skip-tables", action="store_true", help="JSON feeds only")
    parser.add_argument("--out", default=OUT_PATH)
    args = parser.parse_args()

    try:
        rows = scrape(skip_tables=args.skip_tables)
    except Blocked as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2, ensure_ascii=False)

    by_feed: dict[str, int] = {}
    for row in rows:
        by_feed[row["feed"]] = by_feed.get(row["feed"], 0) + 1
    print(f"\n[merc] wrote {len(rows)} rows to {args.out}")
    for feed, count in sorted(by_feed.items(), key=lambda kv: -kv[1]):
        print(f"   {count:6d}  {feed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
