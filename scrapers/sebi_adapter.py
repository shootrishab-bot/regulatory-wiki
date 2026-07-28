"""
SEBI Adapter — Pattern A: metadata + link only.

sebi_multi_section_scraper.py scrapes 7 fixed SEBI listing sections (Act,
Rule, Regulation, General_Order, Guideline, Master_Circular, Circular),
then visits each entry's own detail page just to look for a PDF link —
it never downloads or extracts the PDF itself. Same Pattern A as PFRDA;
see pfrda_adapter.py for the template this follows.

INPUT: one row from sebi_master.csv, e.g.:
    {
        "id": "a1b2c3...",            # sha_id(date, title, link)
        "date": "15-07-2026",         # raw text from the listing table's
                                       # date column, or "01-01-YYYY" if
                                       # the site only showed a bare year
                                       # (see normalize_date() year-only case)
        "title": "Circular on XYZ",
        "link": "https://www.sebi.gov.in/...",       # the detail page
        "pdf_link": "https://www.sebi.gov.in/...pdf", # found ON the detail
                                                        # page, may be "" if
                                                        # the detail page
                                                        # timed out (see "error")
        "pdf_filename": "Circular_Circular_on_XYZ.pdf",
        "pdf_downloaded": "no",
        "created_at": "2026-07-27T10:00:00Z",
        "source_commit": "abc123",
        "category": "Circular",
        "error": "",                  # non-empty only when the detail-page
                                       # visit failed — see note below
    }

NOTE on "error": when the detail-page visit times out, pdf_link is "" and
error carries a short diagnostic string. NormalizedDocument has no slot
for scraper-internal error messages, so it's intentionally dropped here —
downstream just sees file_url=None and needs_download=False, the same as
any other row where no PDF was found. If SEBI's failure rate here turns
out to matter operationally, that's a case for re-scraping those specific
rows, not something this adapter needs to carry forward.

DATE FORMAT — VERIFIED against a real live run (2026-07-28) of
sebi_multi_section_scraper.py against the Circular section: actual
captured values look like 'Jul 23, 2026', 'Jul 21, 2026', 'Jul 07, 2026'
— i.e. "%b %d, %Y" (abbreviated month name), NOT the DD-MM-YYYY originally
guessed from reading normalize_date()'s year-only special case. That
guess was wrong; this was corrected after checking real output, not left
as an assumption. The DD-MM-YYYY format is still tried second, since
that's genuinely what normalize_date() itself produces for its bare-year
case ("2025" -> "01-01-2025").
"""

from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "SEBI"

_DATE_FORMATS = ("%b %d, %Y", "%d-%m-%Y")


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
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row["title"],
        source_url=row.get("link", ""),  # the detail page, distinct from
                                          # pdf_link — unlike PFRDA, SEBI's
                                          # scraper does capture a real
                                          # detail-page URL separately
        published_date=_parse_date(row.get("date", "")),
        file_url=row.get("pdf_link") or None,
        file_extension_hint="pdf" if row.get("pdf_link") else None,  # find_pdf()
                                                                       # only ever
                                                                       # matches .pdf
        category_hint=row.get("category"),
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
            "id": "sebi_abc123",
            "date": "Jul 23, 2026",  # real captured format
            "title": "Master Circular on Investment Advisers",
            "link": "https://www.sebi.gov.in/legal/master-circulars/sample.html",
            "pdf_link": "https://www.sebi.gov.in/sebi_data/attachdocs/sample.pdf",
            "pdf_filename": "Master_Circular_Master_Circular_on_Investment_Advisers.pdf",
            "pdf_downloaded": "no",
            "created_at": "2026-07-27T10:00:00Z",
            "source_commit": "abc123def",
            "category": "Master_Circular",
            "error": "",
        },
        {
            "id": "sebi_def456",
            "date": "01-01-2025",  # year-only source date, already normalized
                                    # to DD-MM-YYYY by the scraper itself
            "title": "General Order in the matter of XYZ Ltd.",
            "link": "https://www.sebi.gov.in/enforcement/orders/sample2.html",
            "pdf_link": "",  # detail page timed out
            "pdf_filename": "General_Order_General_Order_in_the_matter_of_XYZ_Ltd.pdf",
            "pdf_downloaded": "no",
            "created_at": "2026-07-27T10:05:00Z",
            "source_commit": "abc123def",
            "category": "General_Order",
            "error": "detail_timeout: Timeout 20000ms exceeded",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
