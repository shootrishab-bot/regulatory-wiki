"""
IRDAI Adapter — Pattern A: metadata + link only.

irdai_watcher.py scrapes 4 fixed IRDAI listing pages (Acts, Rules,
Regulations, Circulars) and never downloads or extracts PDF content.
Same Pattern A as PFRDA; see pfrda_adapter.py for the template.

INPUT: one row from irdai_master.csv, e.g.:
    {
        "id": "12345",                     # from the row's own checkbox
                                            # value, or a SHA1 fallback of
                                            # the row's text if missing
        "category": "Circulars",
        "short_description": "Circular on XYZ",   # IRDAI has no separate
                                                    # "title" column — this
                                                    # IS the title
        "reference_no": "IRDAI/REG/CIR/123/2026",
        "last_updated": "15-07-2026",      # raw text from the table's date
                                            # column, format not normalized
                                            # by the scraper itself
        "detail_page": "https://irdai.gov.in/...",  # may be None
        "pdf_link": "https://irdai.gov.in/...?download=true",  # may be None
        "pdf_filename": "Circular_XYZ.pdf",
        "file_size": "245 KB",
        "source_page": "https://irdai.gov.in/circulars",
        "scraped_at": "2026-07-27T10:00:00+00:00",
    }

Note: the scraper only keeps rows where short_description AND (detail_link
OR pdf_link) are present, so title and at least one of the two links are
guaranteed — but either link individually can be missing.
"""

from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "IRDAI"

# VERIFIED against a real live run (2026-07-28) of irdai_watcher.py:
# actual captured last_updated values look like '05-02-2026', '21-12-2025',
# '26-03-2021' — confirming "%d-%m-%Y" (the first format tried below) is
# correct. The other formats are kept as a fallback net for any row that
# doesn't match, but are unconfirmed against real output.
_DATE_FORMATS = ("%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%B %d, %Y", "%d %B %Y")


def _parse_date(raw: str) -> str | None:
    if not raw:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return raw


def normalize(row: dict) -> NormalizedDocument:
    pdf_link = row.get("pdf_link")
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("short_description", ""),
        source_url=(
            row.get("detail_page") or pdf_link or row.get("source_page", "")
        ),  # prefer the document's own detail page; fall back to the
            # direct file link, then the category listing page — mirrors
            # the same detail-page-first preference used in mib_adapter.py
        published_date=_parse_date(row.get("last_updated", "")),
        file_url=pdf_link or None,
        file_extension_hint="pdf" if pdf_link else None,  # the scraper only
                                                            # matches links
                                                            # with a
                                                            # "download=true"
                                                            # query param,
                                                            # which on IRDAI's
                                                            # site always
                                                            # serve PDFs
        category_hint=row.get("category"),
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(pdf_link),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "12345",
            "category": "Circulars",
            "short_description": "Circular on Product Filing Guidelines for Health Insurance",
            "reference_no": "IRDAI/HLT/CIR/123/07/2026",
            "last_updated": "15-07-2026",
            "detail_page": "https://irdai.gov.in/document-detail?documentId=12345",
            "pdf_link": "https://irdai.gov.in/documents/download?download=true&id=12345",
            "pdf_filename": "Circular_Product_Filing_Guidelines.pdf",
            "file_size": "312 KB",
            "source_page": "https://irdai.gov.in/circulars",
            "scraped_at": "2026-07-27T10:00:00+00:00",
        },
        {
            "id": "67890",
            "category": "Regulations",
            "short_description": "IRDAI (Registration of Insurers) Regulations, 2026",
            "reference_no": "IRDAI/REG/2026/07",
            "last_updated": "10-07-2026",
            "detail_page": None,  # only a direct download link was present
            "pdf_link": "https://irdai.gov.in/documents/download?download=true&id=67890",
            "pdf_filename": "Registration_of_Insurers_Regulations_2026.pdf",
            "file_size": "540 KB",
            "source_page": "https://irdai.gov.in/consolidated-gazette-notified-regulations",
            "scraped_at": "2026-07-27T10:01:00+00:00",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
