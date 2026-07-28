"""
MIB Adapter — Pattern A: metadata + link only, but NOT pdf-only.

mib_updates_scrapper.py scrapes 3 fixed MIB sections (notices,
acts-policy-guidelines, other-communication) and never downloads or
extracts file content — same Pattern A as PFRDA. The one real difference:
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
        "date": "15-07-2026",             # RAW site text — see note below
        "title": "Notice regarding XYZ",
        "pdf_link": "https://mib.gov.in/...sample.xlsx",  # may be any of
                                                            # the 6 allowed
                                                            # extensions
        "detail_page_link": "https://mib.gov.in/en/...",
        "pdf_filename": "2026-07-15_notice-regarding-xyz.xlsx",
        "wing_category": "Broadcasting Wing",   # finer-grained than
                                                 # "category" — see note
        "file_info": "245 KB",
        "category": "notices",            # one of the 3 CATEGORIES keys
        "created_at": "2026-07-27T10:00:00+00:00",
    }

Note on "date": parse_table_row() stores cols[2]'s raw text directly —
it does NOT run it through the file's own normalize_date() helper (that
helper is only ever used to build pdf_filename, never applied to the
"date" field itself; this looks like a gap in mib_updates_scrapper.py,
not a deliberate choice). This adapter applies the same DD/MM/YYYY-style
splitting logic normalize_date() uses, on the assumption that's still
the best available guess for the site's actual format, since the
scraper's own author encoded that assumption elsewhere in the same file.

Note on "wing_category" vs "category": both are real categorical signals,
but NormalizedDocument only has one category_hint slot. This adapter maps
the top-level "category" (notices / acts-policy-guidelines /
other-communication), matching the convention used by SEBI/IRDAI/DOT/CCI
(their broad top-level section, not a finer administrative sub-label).
wing_category is dropped — flagging this in case the finer label turns
out to matter for Instrument Type classification later.
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
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("title", ""),
        source_url=(
            row.get("detail_page_link") or link or ""
        ),  # prefer the document's own detail page; fall back to the
            # direct file link — same preference order as irdai_adapter.py
        published_date=_parse_date(row.get("date", "")),
        file_url=link or None,
        file_extension_hint=_extension_from_link(link),  # NOT hardcoded —
                                                           # see module docstring
        category_hint=row.get("category"),
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(link),
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
