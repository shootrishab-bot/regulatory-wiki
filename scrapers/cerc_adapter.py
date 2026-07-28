"""
CERC Adapter — Pattern C: PDF already extracted, but as a DIGEST, not
full text.

CERC's scraper (cerc_scraper.py) downloads each PDF and extracts a
relevance-ranked excerpt (pdf_digest — capped at DIGEST_CHARS, 6000 by
default) rather than the complete document. This matters downstream:
classification quality depends on having enough real content, and a
digest built for a "skimmable notification" use case may not contain the
specific passage a taxonomy judgment call actually needs — the same
lesson learned repeatedly in the IFSCA project (see PIPELINE_OVERVIEW.md
§3.2's two-pass classification discussion). raw_text_source="pdf_excerpt"
flags this explicitly so the classification service can weight its own
confidence accordingly, or fall back to a full re-download if needed.

CERC actually has TWO sub-feeds with different field names (orders and
regulations), unlike most other scripts — this adapter handles both.

INPUT — orders (from cerc_orders_master.csv):
    {
        "id": "...", "petition_no": "...", "subject": "...",
        "date_order": "...", "date_posted": "...", "category": "...",
        "pdf_url": "...", "pdf_digest": "...", "scraped_at": "...",
    }

INPUT — regulations (from cerc_regs_master.csv):
    {
        "id": "...", "sl_no": "...", "reg_name": "...",
        "noti_pdf_url": "...", "pdf_digest": "...", "scraped_at": "...",
    }
"""

from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "CERC"


def _parse_date(raw: str) -> str | None:
    """CERC's scraper uses DD.MM.YYYY — convert to ISO 8601."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d.%m.%Y").date().isoformat()
    except ValueError:
        return raw  # fall back to the raw string rather than dropping it silently


def normalize_order(row: dict) -> NormalizedDocument:
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("subject") or row.get("petition_no", ""),
        source_url=row.get("pdf_url", ""),
        published_date=_parse_date(row.get("date_order") or row.get("date_posted") or ""),
        file_url=row.get("pdf_url") or None,
        file_extension_hint="pdf",
        category_hint=row.get("category"),  # CERC's own category column, e.g. tariff/petition type
        raw_text=row.get("pdf_digest") or None,
        raw_text_source="pdf_excerpt" if row.get("pdf_digest") else None,
        needs_download=not bool(row.get("pdf_digest")),  # if extraction failed
                                                           # upstream, still flag
                                                           # for a real download
        scraped_at=row.get("scraped_at"),
    )


def normalize_regulation(row: dict) -> NormalizedDocument:
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("reg_name", ""),
        source_url=row.get("noti_pdf_url", ""),
        published_date=None,  # CERC's regulations feed doesn't persist a date
                               # column in its master CSV — leave unset rather
                               # than guess; the downstream pipeline can fall
                               # back to file metadata or manual entry
        file_url=row.get("noti_pdf_url") or None,
        file_extension_hint="pdf",
        category_hint="Regulation",  # this whole sub-feed IS the regulations
                                      # category — no per-row field needed
        raw_text=row.get("pdf_digest") or None,
        raw_text_source="pdf_excerpt" if row.get("pdf_digest") else None,
        needs_download=not bool(row.get("pdf_digest")),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(order_rows: list[dict], regulation_rows: list[dict]) -> list[NormalizedDocument]:
    return (
        [normalize_order(r) for r in order_rows] +
        [normalize_regulation(r) for r in regulation_rows]
    )


if __name__ == "__main__":
    sample_orders = [{
        "id": "xyz789",
        "petition_no": "Petition No. 123/2026",
        "subject": "Tariff Order for XYZ Transmission Project",
        "date_order": "15.07.2026",
        "date_posted": "16.07.2026",
        "category": "Tariff",
        "pdf_url": "https://www.cercind.gov.in/sample.pdf",
        "pdf_digest": "This order determines the tariff for...",
        "scraped_at": "2026-07-27T10:00:00Z",
    }]
    sample_regs = [{
        "id": "reg456",
        "sl_no": "12",
        "reg_name": "CERC (Terms and Conditions of Tariff) Regulations, 2024",
        "noti_pdf_url": "https://www.cercind.gov.in/reg_sample.pdf",
        "pdf_digest": "These regulations specify the terms and conditions...",
        "scraped_at": "2026-07-27T10:00:00Z",
    }]
    for doc in normalize_all(sample_orders, sample_regs):
        print(doc)
