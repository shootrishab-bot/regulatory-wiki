"""
RBI FAQ Adapter — branches between Pattern B and Pattern A per row.

rbi_faq_scraper.py's own logic is mutually exclusive per row (see its
main(): `if pdf_link: full_text = ""` else `full_text =
extract_detail_page(...)`). So each row is EITHER:
  - Pattern A: a pdf_link exists, full_text is empty — needs download
  - Pattern B: no pdf_link, full_text was extracted from the FAQ's own
    detail page HTML — content already usable, no download needed

This is a genuinely different shape from PFRDA (always Pattern A) or CERC
(always Pattern C) — same source script, different content path per row,
so the branch has to be decided per-row, not hardcoded once.

Bonus: RBI's own scraper already normalizes published_date to ISO 8601
(see its parse_pub_date()) — pass it through directly, no reparsing
needed here, unlike PFRDA/CERC where the adapter had to do that work.

INPUT: one row from rbi_faq_master.csv, e.g. either:
    {  # Pattern A branch
        "faq_id": "123", "title_text": "...", "published_date": "2026-07-15",
        "category": "...", "url": "...", "pdf_link": "https://...pdf",
        "pdf_filename": "123_slug.pdf", "full_text": "", "scraped_at": "...",
    }
    {  # Pattern B branch
        "faq_id": "124", "title_text": "...", "published_date": "2026-07-16",
        "category": "...", "url": "...", "pdf_link": "",
        "pdf_filename": "", "full_text": "Q: ... A: ...", "scraped_at": "...",
    }
"""

from normalized_document import NormalizedDocument

REGULATOR_CODE = "RBI"


def normalize(row: dict) -> NormalizedDocument:
    has_pdf = bool(row.get("pdf_link"))
    has_text = bool(row.get("full_text"))

    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["faq_id"],
        title=row.get("title_text", ""),
        source_url=row.get("url", ""),
        published_date=row.get("published_date") or None,  # already ISO — pass through
        file_url=row.get("pdf_link") or None,
        file_extension_hint="pdf" if has_pdf else None,
        category_hint=row.get("category"),
        raw_text=row.get("full_text") or None,
        raw_text_source="html_page" if has_text else None,
        needs_download=has_pdf and not has_text,  # the two are mutually
                                                    # exclusive per the source
                                                    # scraper's own logic, but
                                                    # check both explicitly
                                                    # rather than assume it
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {  # Pattern A: has a PDF, no extracted text
            "faq_id": "123",
            "title_text": "FAQs on Foreign Exchange Management",
            "published_date": "2026-07-15",
            "category": "Foreign Exchange",
            "url": "https://rbi.org.in/Scripts/FAQDisplay.aspx?Id=123",
            "pdf_link": "https://rbi.org.in/some.pdf",
            "pdf_filename": "123_faqs_on_foreign_exchange.pdf",
            "full_text": "",
            "scraped_at": "2026-07-27T10:00:00",
        },
        {  # Pattern B: no PDF, HTML content already extracted
            "faq_id": "124",
            "title_text": "FAQs on Digital Payments",
            "published_date": "2026-07-16",
            "category": "Payments",
            "url": "https://rbi.org.in/Scripts/FAQDisplay.aspx?Id=124",
            "pdf_link": "",
            "pdf_filename": "",
            "full_text": "Q: What is UPI?\nA: Unified Payments Interface is...",
            "scraped_at": "2026-07-27T10:00:00",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
