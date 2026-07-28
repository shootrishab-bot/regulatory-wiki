"""
FIU Adapter — Pattern A: metadata + link only.

fiu_watcher.py scrapes a SINGLE static compliance-orders page (not
multiple sections like SEBI/IRDAI/DOT) and never downloads or extracts
PDF content — same Pattern A as PFRDA.

Genuinely different from every other Pattern A script: FIU's row has NO
category/section field at all — there's only one feed, so there was
never anything to label rows with. category_hint stays None here, not
because of a mapping gap, but because the concept doesn't exist upstream.

INPUT: one row from fiu_master.csv, e.g.:
    {
        "id": "a1b2c3...",              # sha1(title|pdf_link)
        "sr_no": "1",
        "date": "December 30th 2025",   # raw text from the table's date
                                         # column — see DATE FORMAT note
                                         # below
        "title": "Compliance Order in the matter of XYZ",
        "pdf_link": "https://fiuindia.gov.in/files/Compliance_Orders/sample.pdf",
        "pdf_filename": "sample.pdf",
        "file_size": "180 KB",
        "created_at": "2026-07-27T10:00:00.123456",
    }

DATE FORMAT — VERIFIED against a real live run (2026-07-28) of
fiu_watcher.py: actual captured values include 'December 30th 2025',
'December 22nd 2025', 'April 8th 2025', 'March 6th, 2024',
'January 31st, 2024' — ordinal English month-name dates ("Month Dth
YYYY"), with the comma before the year present on SOME rows and absent on
others (inconsistent even within the same page — not a parsing edge case,
just how the site renders it). This is a full-month-name ordinal format,
NOT DD.MM.YYYY as originally guessed from CERC's convention — that guess
was wrong and is corrected here after checking real output. The ordinal
suffix (st/nd/rd/th) isn't something strptime can parse directly, so it's
stripped via regex first.
"""

import re
from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "FIU"

_ORDINAL_SUFFIX = re.compile(r"(\d+)(st|nd|rd|th)\b", re.IGNORECASE)
_DATE_FORMATS = ("%B %d, %Y", "%B %d %Y")  # comma is inconsistent on the
                                            # site itself — try both


def _parse_date(raw: str) -> str | None:
    if not raw:
        return None
    cleaned = _ORDINAL_SUFFIX.sub(r"\1", raw)
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date().isoformat()
        except ValueError:
            continue
    return raw


def normalize(row: dict) -> NormalizedDocument:
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("title", ""),
        source_url=row.get("pdf_link", ""),  # FIU's scraper has no separate
                                              # detail-page URL — the PDF
                                              # link IS the source reference,
                                              # same situation as PFRDA
        published_date=_parse_date(row.get("date", "")),
        file_url=row.get("pdf_link") or None,
        file_extension_hint="pdf" if row.get("pdf_link") else None,  # every
                                                                       # link on
                                                                       # this page
                                                                       # is a PDF
        category_hint=None,  # genuinely absent upstream — see docstring
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(row.get("pdf_link")),
        scraped_at=row.get("created_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "fiu_a1b2c3d4e5f6",
            "sr_no": "1",
            "date": "December 30th 2025",  # real captured format, no comma
            "title": "Compliance Order in the matter of ABC Financial Services Pvt. Ltd.",
            "pdf_link": "https://fiuindia.gov.in/files/Compliance_Orders/abc_order.pdf",
            "pdf_filename": "abc_order.pdf",
            "file_size": "210 KB",
            "created_at": "2026-07-27T10:00:00.123456",
        },
        {
            "id": "fiu_f6e5d4c3b2a1",
            "sr_no": "2",
            "date": "March 6th, 2024",  # real captured format, WITH comma
            "title": "Compliance Order in the matter of XYZ Trading Co.",
            "pdf_link": "https://fiuindia.gov.in/files/Compliance_Orders/xyz_order.pdf",
            "pdf_filename": "xyz_order.pdf",
            "file_size": "195 KB",
            "created_at": "2026-07-27T10:01:00.123456",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
