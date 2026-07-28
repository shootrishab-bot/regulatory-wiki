"""
IP India Adapter — Pattern B: HTML content already extracted, ALWAYS
(not per-row branching like RBI).

ipindia.py visits every listing entry's own detail page and extracts
div.contentArea's text unconditionally — every row gets a "content"
value (possibly empty string if the selector didn't match, but the
scraper always tries). This is a genuinely different shape from RBI:
RBI's full_text/pdf_link are mutually exclusive per row by the source
scraper's own logic (if pdf_link: full_text stays empty). ipindia.py has
no such branch — it always attempts BOTH content extraction AND pdf_link
extraction from the same detail page, so a single row can legitimately
have both populated at once.

JUDGMENT CALL — needs_download when both content and pdf_link exist:
div.contentArea on IP India's site is a "News Detail" panel (the scraper
explicitly strips "Home"/"Media"/"Latest News"/"News Detail" breadcrumb
lines and keeps everything else), so it likely captures a real, complete
announcement body — not just a one-line teaser. But when a pdf_link is
ALSO present, that PDF is almost always the actual operative notification/
circular being announced, with the HTML content serving as a cover
announcement pointing at it (this is the same pattern every other
regulator in this project follows: PDF is the authoritative primary
source, HTML is a summary/pointer). Without a captured real example to
confirm the HTML content is ever a complete substitute for the PDF, the
safer default — consistent with the project's existing caution around
partial/uncertain content (see cerc_adapter.py, aptel_adapter.py) — is to
still flag needs_download=True whenever a pdf_link exists, even though
raw_text/raw_text_source are already populated from the HTML. This means
downstream may end up with BOTH the HTML announcement text immediately
available AND a flag to go fetch the PDF — that's intentional, not a bug.
needs_download is only False when there is no pdf_link at all (pure
Pattern B, nothing else to fetch). If you've actually read a sample of
IP India's contentArea text and know it's consistently the complete
notification (not just an announcement), that's a case to flip this to
False whenever raw_text is non-empty, regardless of pdf_link.

INPUT: one row from ipindia_master.csv, e.g.:
    {
        "id": "a1b2c3...",              # sha1(title|detail_link)[:16]
        "title": "Public Notice regarding XYZ",
        "date": "15 July, 2026",        # raw text, format not confirmed —
                                         # see _parse_date() below
        "detail_link": "https://ipindia.gov.in/Home/...",
        "pdf_link": "https://ipindia.gov.in/writereaddata/....pdf",  # may be ""
        "pdf_filename": "Public_Notice_regarding_XYZ.pdf",
        "content": "Public Notice\n\nIt is hereby notified that...",
    }
"""

from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "IPINDIA"  # NEEDS CONFIRMATION: this must match whatever
                             # Regulator.code is actually seeded in Postgres
                             # for this office (Controller General of
                             # Patents, Designs & Trade Marks) — "IPINDIA"
                             # matches the ipindia.gov.in domain, but
                             # "CGPDTM" is the office's own formal
                             # abbreviation and may be the intended code
                             # instead. Confirm before first real run.

# STILL UNVERIFIED as of 2026-07-28: attempted a real live run of
# ipindia.py to confirm this against actual output, but its listing URL
# (https://ipindia.gov.in/Home/Latestnews/1?CatID=1) now 404s — the site
# has been restructured since ipindia.py was written, independent of
# anything in this adapter. TOTAL SCRAPED: 0 on a real run confirms the
# scraper itself is broken against the current live site, not just slow
# or blocked. These formats remain best-effort guesses (see original
# reasoning below) — do not trust this parsing against real data until
# either ipindia.py is fixed to match the site's current structure and
# re-run, or a real sample of "date" text is obtained some other way.
#
# Original reasoning: ipindia.py has no normalize_date() of its own, and
# the only structural hint available is that the raw string always ends
# in a 4-digit year (see run_scraper()'s `date.endswith("2026")` filter),
# consistent with a "DD Month, YYYY" or "DD Month YYYY" style.
_DATE_FORMATS = ("%d %B, %Y", "%d %B %Y", "%d-%m-%Y", "%d/%m/%Y")


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
    content = row.get("content") or None
    pdf_link = row.get("pdf_link") or None

    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("title", ""),
        source_url=row.get("detail_link", ""),
        published_date=_parse_date(row.get("date", "")),
        file_url=pdf_link,
        file_extension_hint="pdf" if pdf_link else None,  # the scraper only
                                                            # ever matches
                                                            # explicit .pdf
                                                            # links
        category_hint=None,  # ipindia.py scrapes a single fixed listing
                              # (CatID=1) with no per-row section/category
                              # field — genuinely absent, same as fiu_adapter.py
        raw_text=content,
        raw_text_source="html_page" if content else None,
        needs_download=bool(pdf_link),  # True whenever a PDF exists, even
                                         # alongside HTML content — see the
                                         # JUDGMENT CALL note above
        scraped_at=None,  # ipindia.py's row dict has no timestamp field at
                           # all — genuinely absent, same as cci_adapter.py
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {  # HTML content only, no PDF — the unambiguous Pattern B case
            "id": "ipindia_a1b2c3d4e5f6",
            "title": "Notice regarding Filing of Trademark Applications",
            "date": "15 July, 2026",
            "detail_link": "https://ipindia.gov.in/Home/Latestnews/newsdetail?id=101",
            "pdf_link": "",
            "pdf_filename": "",
            "content": (
                "Notice\n\nIt is hereby notified for information of all "
                "concerned that the online filing facility for trademark "
                "applications will undergo scheduled maintenance on the "
                "night of 20th July 2026 from 11 PM to 5 AM."
            ),
        },
        {  # HTML content AND a PDF present — the ambiguous case this
           # adapter's judgment call is actually about
            "id": "ipindia_f6e5d4c3b2a1",
            "title": "Public Notice regarding Revised Fee Structure",
            "date": "10 July, 2026",
            "detail_link": "https://ipindia.gov.in/Home/Latestnews/newsdetail?id=102",
            "pdf_link": "https://ipindia.gov.in/writereaddata/Portal/News/102_1_revised_fees.pdf",
            "pdf_filename": "Public_Notice_Revised_Fee.pdf",
            "content": (
                "Public Notice\n\nApplicants are informed that a revised "
                "fee structure will come into effect from 1st August 2026. "
                "Please refer to the attached notification for details."
            ),
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
