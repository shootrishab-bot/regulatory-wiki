"""
CCI Adapter — Pattern A: metadata + link only.

cci_watcher.py scrapes two CCI feeds (public notices and press releases)
and never downloads or extracts PDF content — same Pattern A as PFRDA.
For press releases it does resolve the actual PDF link from the detail
page's onclick handler, but doesn't keep any extracted text.

Bonus, like RBI: CCI's own scraper already normalizes published dates to
ISO 8601 before writing them out (dtparser.parse(...).date().isoformat()
for both the has_date_col and title-regex branches) — pass through
directly, no reparsing needed here.

INPUT: one row from cci_master.csv, e.g.:
    {
        "id": "a1b2c3...",           # sha1(section|title|link)[:16]
        "section": "public_notices", # or "press_release"
        "no": "1",
        "title": "Public Notice regarding XYZ",
        "date": "2026-07-15",        # already ISO — see docstring above
        "pdf_link": "https://cci.gov.in/...pdf",
        "pdf_filename": "a1b2c3d4e5f6g7h8.pdf",
    }

Note: CCI's row has no created_at/scraped_at field of any kind — neither
parse_table() nor save_outputs() ever adds one. scraped_at stays None
here; this is a genuine gap in the upstream scraper, not something this
adapter can recover.
"""

from normalized_document import NormalizedDocument

REGULATOR_CODE = "CCI"


def normalize(row: dict) -> NormalizedDocument:
    pdf_link = row.get("pdf_link")
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("title", ""),
        source_url=pdf_link or "",  # no separate detail-page URL survives
                                    # into the row — for press_release the
                                    # scraper overwrites its own detail-page
                                    # link variable with the resolved PDF
                                    # link before it's ever stored (see
                                    # get_press_pdf_link() call site in
                                    # parse_table()), and public_notices
                                    # never had one to begin with
        published_date=row.get("date") or None,  # already ISO — pass through
        file_url=pdf_link or None,
        file_extension_hint="pdf" if pdf_link else None,  # pdf_filename is
                                                            # always built as
                                                            # f"{uid}.pdf" by
                                                            # the scraper itself
        category_hint=row.get("section"),  # "public_notices" or "press_release"
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(pdf_link),
        scraped_at=None,  # genuinely absent — see docstring
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "cci_a1b2c3d4e5f6",
            "section": "public_notices",
            "no": "1",
            "title": "Public Notice regarding Combination Registration No. C-2026/07/1234",
            "date": "2026-07-15",
            "pdf_link": "https://cci.gov.in/public-notices/sample.pdf",
            "pdf_filename": "a1b2c3d4e5f6.pdf",
        },
        {
            "id": "cci_f6e5d4c3b2a1",
            "section": "press_release",
            "no": "2",
            "title": "CCI approves acquisition of XYZ Ltd by ABC Holdings",
            "date": "2026-07-10",
            "pdf_link": "https://cci.gov.in/media-gallery/press-release/resolved-sample.pdf",
            "pdf_filename": "f6e5d4c3b2a1.pdf",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
