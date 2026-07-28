"""
DOT Adapter — Pattern A: metadata + link only.

dot_watcher.py scrapes 7 fixed DOT document sections (Orders and Notices,
Reports, Acts and Policies, Publications, Press Release, Guidelines,
Gazettes/Notifications) and never downloads or extracts PDF content —
same Pattern A as PFRDA, and in fact the same row shape (id, title,
publish_date, pdf_url, category, scraped_at), so this adapter mirrors
pfrda_adapter.py almost exactly.

INPUT: one row from dot_master.csv, e.g.:
    {
        "id": "a1b2c3...",              # sha1(pdf_url)[:16]
        "title": "Notice on XYZ",
        "publish_date": "07/15/2026",   # MM/DD/YYYY — same convention as
                                         # PFRDA's scraper (see normalize_date())
        "pdf_url": "https://www.dot.gov.in/...",
        "category": "ORDERS_AND_NOTICES",
        "scraped_at": "07/27/2026",     # MM/DD/YYYY date, NOT a full ISO
                                         # timestamp — DOT's scraper only
                                         # records the date it ran, same as
                                         # PFRDA's scraped_at convention
    }
"""

from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "DOT"


def _parse_date(raw: str) -> str | None:
    """DOT's scraper normalizes to MM/DD/YYYY — convert to ISO 8601."""
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
        source_url=row.get("pdf_url", ""),  # DOT's scraper has no separate
                                             # detail-page URL — the PDF
                                             # link IS the source reference,
                                             # same situation as PFRDA
        published_date=_parse_date(row.get("publish_date", "")),
        file_url=row.get("pdf_url") or None,
        file_extension_hint="pdf" if row.get("pdf_url") else None,  # only
                                                                      # "download-btn"
                                                                      # links are
                                                                      # captured, which
                                                                      # DOT always
                                                                      # serves as PDF
        category_hint=row.get("category"),
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(row.get("pdf_url")),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "dot_a1b2c3d4e5f6",
            "title": "Notice regarding Spectrum Allocation Guidelines",
            "publish_date": "07/15/2026",
            "pdf_url": "https://www.dot.gov.in/sites/default/files/sample_notice.pdf",
            "category": "ORDERS_AND_NOTICES",
            "scraped_at": "07/27/2026",
        },
        {
            "id": "dot_f6e5d4c3b2a1",
            "title": "Gazette Notification on Telecom Licensing Rules",
            "publish_date": "07/10/2026",
            "pdf_url": "https://www.dot.gov.in/sites/default/files/sample_gazette.pdf",
            "category": "GAZETTES_NOTIFICATIONS",
            "scraped_at": "07/27/2026",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
