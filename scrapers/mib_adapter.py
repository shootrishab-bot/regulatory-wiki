"""
MIB Adapter — Pattern A: metadata + link only, but NOT pdf-only.

STATUS (2026-07-31): mib_updates_scrapper.py was rewritten against real
live site structure (mib.gov.in is a Drupal Views site, confirmed
reachable, not blocked) -- this adapter is updated to match. Real,
confirmed findings from that investigation relevant here:
  - Real pagination and real per-category page sizes (10 rows/page for
    notices, 20 for acts_policy_guidelines and other_communication) are
    now actually scraped -- the prior version only ever read page 0,
    capped at 10 rows, for all three categories.
  - Acts/Policies/Guidelines has a real 7th column ("Category", distinct
    from "wings category") that Notices/Other Communication don't have.
    The scraper now surfaces this as its own "notifications_category"
    field rather than mislabeling it via a fixed-position column index.
  - Title cells have NO link in any real row observed -- detail_page_link
    is genuinely None in practice, not a scraping gap.
  - No per-section "View Archive" button and no grouped/aggregator rows
    exist on MIB (confirmed absent, not merely unhandled).
  - 3/203 real rows have no direct downloadable file, confirmed by
    pulling their real raw HTML: each has a real <a href> pointing at an
    EXTERNAL site instead (indiacode.nic.in for two 1994/1995 Cable TV
    Act/Rules entries, skill.nfdcindia.com for a Skill Development
    notice) -- not genuinely fileless, just a different real link shape.
    The scraper now captures this as "external_link"/"link_type" rather
    than silently discarding it. NormalizedDocument has no dedicated slot
    for "external reference site, not a raw file" -- this adapter surfaces
    it via file_url with file_extension_hint=None and needs_download=False
    (see normalize() below) so the real link isn't lost, while remaining
    honest that it is not a downloadable document the same way pdf_link
    rows are.

STATUS (2026-07-31, second pass): the original 3 categories were only
18% of MIB's real document corpus -- confirmed via real site nav and a
real 18-row document-type index (see mib_updates_scrapper.py module
docstring items 9-14). The scraper now covers 18 real categories, real
total 1,024 documents. New real fields this adapter now handles:
  - "flipbook_link": E-Book/Handbook rows link to an internal viewer
    page (/en/flipbook/N), not a downloadable file. Folded into
    file_url alongside pdf_link/external_link, with
    file_extension_hint=None and needs_download=False, same treatment
    as external_link.
  - "financial_year" / "accounting_reports_category" / "date_secondary":
    real fields that only some of the 18 categories have (Budget
    Overview, Detailed Demand for Grant, Internal Audit, Accounting and
    Reports, Vacancies). Not surfaced in NormalizedDocument -- it has no
    dedicated slot for them -- dropped here the same way wing_category/
    notifications_category already were, not fabricated into a field
    that doesn't fit.
  - published_date: some categories have no real date field at all
    (Budget Overview, Accounting and Reports/Detailed Demand for
    Grant/Internal Audit's "date" column is genuinely empty for some
    rows) or a real non-DD/MM/YYYY format (E-Book/Handbook uses
    "Mon-YYYY", e.g. "Dec-2025") -- _parse_date() returns None for
    empty input and returns the raw text unchanged (not silently
    mis-normalized) when it doesn't match the 3-part DD/MM/YYYY shape.

MIB's site serves PDF, XLSX, XLS, CSV, DOC, and DOCX files (see
ALLOWED_FILE_EXTENSIONS), and the scraper picks whichever matching link
appears first in the row's file-link cell. The field is still called
"pdf_link" in the source CSV (a leftover/misleading name — it is NOT
always a PDF), so file_extension_hint here is derived from the actual
link's own extension, not hardcoded.

Also note: the scraper computes file_extension internally (used to build
pdf_filename) but does NOT persist it as its own CSV column — only the
composed pdf_filename string carries it forward. So this adapter
re-derives the extension straight from the file_url itself rather than
trying to parse it back out of pdf_filename.

INPUT: one row from mib_master.csv, e.g.:
    {
        "id": "a1b2c3...",                # sha1(title|date|category|link)
        "date": "15-07-2026",             # RAW site text, DD-MM-YYYY —
                                           # confirmed real format
        "title": "Notice regarding XYZ",
        "pdf_link": "https://mib.gov.in/...sample.xlsx",  # may be any of
                                                            # the 6 allowed
                                                            # extensions
        "detail_page_link": None,          # confirmed always None in
                                            # real data — title cells
                                            # never had a link
        "pdf_filename": "2026-07-15_notice-regarding-xyz.xlsx",
        "wing_category": "Broadcasting Wing",   # finer-grained than
                                                 # "category" — see note
        "notifications_category": None,    # real field, ONLY populated
                                            # for acts_policy_guidelines
                                            # rows — None elsewhere
        "file_info": "245 KB",
        "category": "notices",            # one of the 3 CATEGORIES keys
        "page_number": 0,
        "created_at": "2026-07-27T10:00:00+00:00",
    }

Note on "date": the scraper stores the real DD-MM-YYYY text directly —
it does NOT run it through the file's own normalize_date() helper (that
helper is only ever used to build pdf_filename, never applied to the
"date" field itself). This adapter applies the same DD/MM/YYYY-style
splitting logic normalize_date() uses, confirmed against real captured
rows (e.g. "15-07-2026" -> "2026-07-15") rather than assumed.

Note on "wing_category" vs "category" vs "notifications_category": three
real categorical signals exist, but NormalizedDocument only has one
category_hint slot. This adapter maps the top-level "category" (notices /
acts-policy-guidelines / other-communication), matching the convention
used by SEBI/IRDAI/DOT/CCI (their broad top-level section, not a finer
administrative sub-label). wing_category and notifications_category are
both dropped here — flagging both in case either finer label turns out to
matter for Instrument Type classification later.
"""

import os
import re
from urllib.parse import urlparse
from normalized_document import NormalizedDocument

REGULATOR_CODE = "MIB"


def _parse_date(raw: str) -> str | None:
    """Same DD/MM/YYYY-style split-and-reorder normalize_date() in
    mib_updates_scrapper.py uses (for pdf_filename) applied here to the
    date field itself — see the module docstring's note on why the
    source scraper never did this itself."""
    if not raw:
        return None
    parts = re.split(r"[./-]", raw)
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        day, month, year = parts
        try:
            return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
        except ValueError:
            return raw
    return raw


def _extension_from_link(url: str | None) -> str | None:
    """Derive the real file extension from the link itself — the source
    scraper only allows PDF/XLSX/XLS/CSV/DOC/DOCX links through
    (ALLOWED_FILE_EXTENSIONS), but never stores which one as its own
    column, so this can't be read off the row directly."""
    if not url:
        return None
    _, ext = os.path.splitext(urlparse(url).path)
    return ext.lstrip(".").lower() or None


def normalize(row: dict) -> NormalizedDocument:
    link = row.get("pdf_link")
    external = row.get("external_link")
    flipbook = row.get("flipbook_link")
    is_downloadable_file = bool(link)
    # Real, confirmed 2026-07-31 (18-category corpus): three real
    # non-file link shapes exist beyond a direct pdf_link -- an external
    # reference site (indiacode.nic.in, skill.nfdcindia.com,
    # wavesindia.org, pib.gov.in for most Press Releases), and an
    # internal flipbook viewer page (/en/flipbook/N, E-Book/Handbook
    # only). None of these are a downloadable document the same way a
    # real pdf_link is, so file_extension_hint stays None and
    # needs_download stays False for all three.
    file_url = link or flipbook or external or None

    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("title", ""),
        source_url=(
            row.get("detail_page_link") or file_url or ""
        ),  # prefer the document's own detail page; fall back to the
            # direct file link — same preference order as irdai_adapter.py
        published_date=_parse_date(row.get("date", "")),
        file_url=file_url,
        file_extension_hint=_extension_from_link(link) if is_downloadable_file else None,  # NOT
                                                           # hardcoded — see module docstring
        category_hint=row.get("category"),
        raw_text=None,
        raw_text_source=None,
        needs_download=is_downloadable_file,  # False for external/flipbook-only rows —
                                      # see note above
        scraped_at=row.get("created_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "mib_a1b2c3d4e5f6",
            "date": "15-07-2026",
            "title": "Notice regarding Uplinking and Downlinking Guidelines",
            "pdf_link": "https://mib.gov.in/sites/default/files/2026-07-15_uplinking-guidelines.pdf",
            "detail_page_link": "https://mib.gov.in/en/documents/notification/notices/12345",
            "pdf_filename": "2026-07-15_uplinking-guidelines.pdf",
            "wing_category": "Broadcasting Wing",
            "file_info": "412 KB",
            "category": "notices",
            "created_at": "2026-07-27T10:00:00+00:00",
        },
        {
            # the case the "don't hardcode pdf" instruction is actually for
            "id": "mib_f6e5d4c3b2a1",
            "date": "10-07-2026",
            "title": "List of Empanelled Advertising Agencies",
            "pdf_link": "https://mib.gov.in/sites/default/files/2026-07-10_empanelled-agencies.xlsx",
            "detail_page_link": "https://mib.gov.in/en/documents/notification/other-communication/67890",
            "pdf_filename": "2026-07-10_empanelled-agencies.xlsx",
            "wing_category": "Advertising and Visual Publicity",
            "file_info": "58 KB",
            "category": "other_communication",
            "created_at": "2026-07-27T10:02:00+00:00",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
