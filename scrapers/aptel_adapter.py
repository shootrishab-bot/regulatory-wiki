"""
APTEL Adapter — Pattern C: PDF already extracted, but as a DIGEST, not
full text.

aptel_watcher.py downloads each judgement/order PDF and runs the exact
same semantic-digest technique CERC's scraper uses: split into
paragraph-sized chunks, embed both the chunks and a fixed set of
"what would matter about this document" queries with sentence-transformers
(all-MiniLM-L6-v2), keep every chunk scoring >= 35% of the top match
(falling back to the top 10 chunks by score if nothing clears that bar),
capped at HARD_CAP=80,000 chars. Same caution as CERC applies here:
raw_text_source="pdf_excerpt" flags this as a relevance-ranked digest, not
the complete document, so classification can weight its confidence
accordingly or fall back to a full re-download if a specific passage is
needed and missing from the digest.

Unlike CERC, APTEL has a single feed (judgements/orders only — no
separate regulations sub-feed with different field names), so one
normalize() function is enough; no normalize_order/normalize_regulation
split needed.

INPUT: one row from aptel_master.csv, e.g.:
    {
        "id": "a1b2c3...",                  # sha1(pdf_url)[:16]
        "petition_no": "Appeal No. 123 of 2026",
        "cause_title": "ABC Power Ltd. vs. XYZ State Electricity Regulatory Commission",
        "bench": "Hon'ble Justice ... and Hon'ble Technical Member ...",
        "date_of_decision": "15.07.2026",   # DD.MM.YYYY — same convention
                                             # as CERC's scraper
        "date_uploaded": "16.07.2026",      # DD.MM.YYYY, may equal
                                             # date_of_decision if only one
                                             # date was found in the cell
        "pdf_url": "https://aptel.gov.in/...pdf",
        "pdf_text": "This appeal challenges the order of the ...",  # the
                                             # semantic digest, or "" if
                                             # pdfplumber isn't installed
                                             # or extraction failed
        "scraped_at": "2026-07-27T10:00:00.123456",
    }

Note: APTEL's own scraper has no category/section field at all — it's a
single judgements/orders feed with no sub-categorization, unlike CERC
(which had a real per-row "category" for orders and a fixed "Regulation"
label for its regulations sub-feed). category_hint stays None here for
the same "genuinely doesn't exist upstream" reason as fiu_adapter.py and
ipindia_adapter.py, not a mapping gap.
"""

from datetime import datetime
from normalized_document import NormalizedDocument

REGULATOR_CODE = "APTEL"


def _parse_date(raw: str) -> str | None:
    """APTEL's scraper uses DD.MM.YYYY, same as CERC — convert to ISO 8601."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d.%m.%Y").date().isoformat()
    except ValueError:
        return raw  # fall back to the raw string rather than dropping it silently


def normalize(row: dict) -> NormalizedDocument:
    pdf_text = row.get("pdf_text") or None
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("cause_title") or row.get("petition_no", ""),  # the
                                                                        # case
                                                                        # name is
                                                                        # more
                                                                        # descriptive
                                                                        # than the
                                                                        # bare
                                                                        # petition
                                                                        # number —
                                                                        # same
                                                                        # subject-
                                                                        # over-id
                                                                        # preference
                                                                        # as CERC's
                                                                        # normalize_order()
        source_url=row.get("pdf_url", ""),  # no separate detail page —
                                             # the PDF link IS the source
                                             # reference, same situation as
                                             # PFRDA/CERC
        published_date=_parse_date(
            row.get("date_of_decision") or row.get("date_uploaded") or ""
        ),  # prefer the decision date; fall back to the upload date — same
            # fallback-chain convention as CERC's date_order/date_posted
        file_url=row.get("pdf_url") or None,
        file_extension_hint="pdf",  # scrape_orders() explicitly filters to
                                     # only hrefs ending in ".pdf"
        category_hint=None,  # genuinely absent upstream — see docstring
        raw_text=pdf_text,
        raw_text_source="pdf_excerpt" if pdf_text else None,
        needs_download=not bool(pdf_text),  # if extraction failed upstream
                                             # (no pdfplumber, download
                                             # error, etc.), still flag for
                                             # a real download — same
                                             # caution as CERC
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "aptel_a1b2c3d4e5f6",
            "petition_no": "Appeal No. 145 of 2026",
            "cause_title": "ABC Power Transmission Ltd. vs. Central Electricity Regulatory Commission",
            "bench": "Hon'ble Justice R. Kumar (Chairperson) and Hon'ble S. Iyer (Technical Member)",
            "date_of_decision": "15.07.2026",
            "date_uploaded": "16.07.2026",
            "pdf_url": "https://aptel.gov.in/sites/default/files/appeal_145_2026.pdf",
            "pdf_text": (
                "This appeal challenges the tariff order passed by the Central "
                "Electricity Regulatory Commission dated 12.03.2025 in Petition "
                "No. 88/2025. The Tribunal, having heard both parties, holds "
                "that the impugned order correctly applied the applicable "
                "tariff regulations and dismisses the appeal."
            ),
            "scraped_at": "2026-07-27T10:00:00.123456",
        },
        {  # extraction failed upstream (e.g. no pdfplumber, or a scanned
           # PDF with no extractable text layer) — needs_download must be True
            "id": "aptel_f6e5d4c3b2a1",
            "petition_no": "Appeal No. 150 of 2026",
            "cause_title": "",
            "bench": "",
            "date_of_decision": "18.07.2026",
            "date_uploaded": "19.07.2026",
            "pdf_url": "https://aptel.gov.in/sites/default/files/appeal_150_2026.pdf",
            "pdf_text": "",
            "scraped_at": "2026-07-27T10:05:00.123456",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
