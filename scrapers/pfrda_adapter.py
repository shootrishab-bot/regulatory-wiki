"""
PFRDA Adapter — Pattern A: metadata + link only.

PFRDA's scraper (pfrda_scraper.py) never downloads or extracts PDF
content — it only captures title/date/link/category. This is the
simplest, most common pattern (8 of the 13 scripts work this way: SEBI,
MIB, IRDAI, CCI, DOT, FIU, MTCTE, PFRDA). Use this file as the template
for adapting any of the other seven.

INPUT: one row from pfrda_master.csv, e.g.:
    {
        "id": "a1b2c3...",
        "title": "Circular on XYZ",
        "publish_date": "07/15/2026",   # MM/DD/YYYY — PFRDA's scraper's own format
        "pdf_url": "https://www.pfrda.org.in/...",
        "category": "CIRCULAR",
        "scraped_at": "07/27/2026",
    }

OUTPUT: a NormalizedDocument, needs_download=True (no content yet — the
downstream TypeScript ingestion pipeline handles the actual download and
extraction).
"""

from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "PFRDA"


def _parse_date(raw: str) -> str | None:
    """PFRDA's scraper normalizes to MM/DD/YYYY — convert to ISO 8601."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return raw  # fall back to the raw string rather than dropping it silently


def normalize(row: dict) -> NormalizedDocument:
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row["title"],
        source_url=row.get("pdf_url", ""),  # PFRDA's scraper has no separate
                                             # detail-page URL — the PDF link
                                             # IS the source reference
        published_date=_parse_date(row.get("publish_date", "")),
        file_url=row.get("pdf_url") or None,
        file_extension_hint="pdf" if row.get("pdf_url") else None,
        category_hint=row.get("category"),
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(row.get("pdf_url")),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    # Quick manual check against a couple of representative rows.
    sample_rows = [
        {
            "id": "abc123",
            "title": "Master Circular on Investment Guidelines",
            "publish_date": "07/15/2026",
            "pdf_url": "https://www.pfrda.org.in/documents/sample.pdf",
            "category": "MASTER_CIRCULAR",
            "scraped_at": "07/27/2026",
        }
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
