"""
CPPP Adapter -- a hybrid of Pattern A and a listing-only case that no previous
regulator in this project has had in this form.

INPUT: rows from scrapers/cppp_watcher.py (scrapers/data/cppp_raw.json).
OUTPUT: NormalizedDocument, consumed by lib/ingest.ts.

TWO GENUINELY DIFFERENT KINDS OF ROW
------------------------------------
1. Tender / corrigendum listing rows (`active_tenders`, `active_corrigendums`,
   `high_value_tenders`, `global_tenders`). These have NO downloadable file at
   all from the open portal -- the bid documents live behind the CAPTCHA-gated
   tender detail page (see cppp_watcher.py's docstring, item b). All the real
   content available is the tender title, the issuing organisation, the
   reference number and three dates.

   Rather than leave `raw_text` null and let lib/ingest.ts classify from a bare
   title, this adapter composes the listing's own real fields into a short
   `raw_text` block and marks it `html_page` -- because that is literally what
   it is: text extracted from the listing page's own HTML, exactly the Pattern
   B case normalized_document.py already defines (ipindia, rbi_faq). It is
   honest about being thin; it is not a fabricated summary.

   `needs_download=False` for these rows, and `extraction_failed` is NOT set:
   there is no file to download and no extraction that failed. Setting
   extraction_failed here would flag ~all of CPPP for review over a condition
   that is normal for this source, drowning the genuinely uncertain rows.

2. Institutional document rows (Office Memoranda, GFR/manuals, bidding
   documents, help guides, newsletters, the FAQ). These DO have real,
   directly-downloadable PDFs and behave like every other Pattern A regulator
   in this project.

STATUS HINTS ARE REAL HERE, NOT INFERRED
----------------------------------------
Unlike most regulators, CPPP's own feed structure IS a status assertion: a row
in `latestactivetendersnew` is a currently-live tender by the portal's own
definition, and a row in `latestactivecorrigendumsnew` is a tender against
which a corrigendum has been issued. Those map onto the taxonomy's `Live /
Open` and `Corrigendum Issued` values as ground truth. `Cancelled`,
`Retendered` and `Awarded / Closed` get no hint from any scrapable feed --
see cppp-taxonomy-findings.md.

Institutional rows deliberately carry NO status hint, per the taxonomy's own
Tagging Guide rule 3 (institutional content is always `Not Applicable`).
"""

from __future__ import annotations

from normalized_document import NormalizedDocument

REGULATOR_CODE = "CPPP"

_LISTING_FEEDS = {"active_tenders", "active_corrigendums", "high_value_tenders", "global_tenders"}


def _listing_raw_text(row: dict) -> str:
    """The listing row's own real fields, rendered as text.

    Deliberately a plain labelled block, not prose: every value here came
    verbatim from CPPP's own table cell, and nothing is inferred, summarized or
    padded. The organisation name is included because for the large share of
    CPPP tenders whose "title" is only a departmental reference number (real
    and common -- CPWD publishes NIT numbers as titles), the issuing
    organisation is the ONLY substantive signal available for classification.
    """
    lines = [f"Tender title: {row.get('title', '')}"]
    if row.get("organisation"):
        lines.append(f"Issuing organisation: {row['organisation']}")
    if row.get("ref_no"):
        lines.append(f"Reference number: {row['ref_no']}")
    if row.get("tender_id"):
        lines.append(f"Tender ID: {row['tender_id']}")
    if row.get("published_date"):
        lines.append(f"e-Published date: {row['published_date']}")
    if row.get("closing_date"):
        lines.append(f"Bid submission closing date: {row['closing_date']}")
    if row.get("opening_date"):
        lines.append(f"Tender opening date: {row['opening_date']}")
    lines.append(f"Portal section: {row.get('section', '')}")
    lines.append(
        "Note: the full bid document for this tender is not retrievable from the "
        "public portal; CPPP gates the tender detail page behind a CAPTCHA. The "
        "fields above are the complete set of information the public listing "
        "publishes."
    )
    return "\n".join(lines)


def _category_hint(row: dict) -> str | None:
    """CPPP's own section plus the issuing organisation.

    The organisation is genuinely load-bearing for the taxonomy's Subject
    facet: with the tender's real Tender Category (Goods/Services/Works)
    unreachable, a tender from the Central Public Works Department or the
    Military Engineer Services is overwhelmingly Works, and one from a medical
    institute's purchase division is overwhelmingly Goods. That is a weak
    signal and is passed as a hint, not asserted as a fact.
    """
    parts = [p for p in (row.get("instrument_hint"), row.get("section"), row.get("organisation")) if p]
    return " | ".join(parts) or None


def _title(row: dict) -> str:
    """CPPP titles are frequently just a departmental reference number with no
    descriptive content (confirmed real, see cppp-taxonomy-findings.md). Where
    that happens the organisation name is appended, so the stored title is at
    least identifiable in a list -- the raw reference number alone is not.
    """
    title = (row.get("title") or "").strip()
    organisation = (row.get("organisation") or "").strip()
    if not title:
        return organisation or "(untitled CPPP record)"
    # A title with no lowercase word of 4+ letters is a reference number, not a
    # description -- e.g. "68/2026-27/DED-102/DELHI/1/Recall3".
    words = [w for w in title.replace("/", " ").replace("-", " ").split() if w.isalpha() and len(w) >= 4]
    if not words and organisation:
        return f"{title} ({organisation})"
    return title


def normalize(row: dict) -> NormalizedDocument:
    is_listing = row.get("feed") in _LISTING_FEEDS
    file_url = row.get("file_url")

    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["source_id"],
        title=_title(row),
        # For a listing row, the listing page IS the source page; the tender
        # detail URL is stored as file_url only when it is a real file, which
        # it never is for listing rows (it is a CAPTCHA-gated HTML view), so
        # file_url stays null rather than pointing at something undownloadable.
        source_url=row.get("source_url", ""),
        published_date=row.get("published_date"),
        file_url=file_url,
        file_extension_hint=row.get("file_extension_hint"),
        category_hint=_category_hint(row),
        status_hint=(row.get("status_hint") or None),
        raw_text=_listing_raw_text(row) if is_listing else None,
        raw_text_source="html_page" if is_listing else None,
        needs_download=bool(file_url) and not is_listing,
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample = [
        {
            "feed": "active_tenders",
            "section": "Latest Active Tenders",
            "source_url": "https://eprocure.gov.in/cppp/latestactivetendersnew/cpppdata?url=...",
            "title": "68/2026-27/DED-102/DELHI/1/Recall3",
            "ref_no": "68/2026-27/DED-102/DELHI/1/Recall3",
            "tender_id": "168648",
            "organisation": "Central Public Works Department (CPWD)",
            "published_date": "2026-09-10",
            "closing_date": "2026-09-17",
            "opening_date": "2026-09-17",
            "instrument_hint": "Tender Notice (NIT)",
            "status_hint": "Live",
            "source_id": "abc123",
            "scraped_at": "2026-09-10T10:00:00Z",
        },
        {
            "feed": "policy_central",
            "section": "Procurement Policy O.M.s (Central)",
            "source_url": "https://eprocure.gov.in/cppp/instruction_display",
            "title": "Mandatory Publishing of Tender Information on CPPP",
            "organisation": "Dept. of Expenditure",
            "published_date": "2012-03-14",
            "file_url": "https://eprocure.gov.in/cppp/instruction_display/kbadq...",
            "file_extension_hint": "pdf",
            "instrument_hint": "Circular / Office Memorandum",
            "status_hint": "",
            "source_id": "def456",
            "scraped_at": "2026-09-10T10:00:00Z",
        },
    ]
    for doc in normalize_all(sample):
        print(doc)
