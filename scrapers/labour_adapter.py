"""
Labour Adapter -- converts labour_parser.py's per-document dicts (the
"regulator": "EPFO"/"ESIC"/"CLC" shape already used by parse_source()) into
the NormalizedDocument contract every other adapter in this project produces.

Shared across EPFO/ESIC/CLC since labour_parser.py's output shape is already
identical across all three (see its parse_* functions) -- unlike MIB, which
needed a dedicated adapter because its CSV columns were regulator-specific.

INPUT: one row from a labour_watcher_<regulator>.py master CSV, e.g.:
    {
        "title": "Declaration of Rate of Interest for the EPF Members Account",
        "published_date": "2026-07-01",
        "source_url": "https://epfindia.gov.in/site_en/...",
        "file_size": "",
        "regulator": "EPFO",
        "regulator_full": "Employees' Provident Fund Organisation",
        "domain": "employment_law",
        "document_type": "notification",
        "labour_codes": "social_security_code",   # comma-joined in the CSV;
                                                     # dropped here, see note
        "state": "central",
        "scraped_at": "2026-08-13T10:00:00",
    }

Note on "labour_codes": labour_parser.py's infer_labour_code() is a real,
useful weak signal (which of the 4 new labour codes a document likely
relates to), but NormalizedDocument has no dedicated slot for it and it is
not yet consumed anywhere downstream (EntryApplicability is seeded for
MTCTE only and is not wired into ingest.ts's classification pipeline at
all currently -- confirmed by reading ingest.ts directly, not assumed).
Dropped here the same way MIB's wing_category/notifications_category were
dropped in mib_adapter.py -- flagged in case Applicability classification
gets wired up later.

Note on source_url vs file_url: unlike DoT/MIB, the real labour-law parsers
(parse_epfo_updates, parse_esic, parse_clc, etc.) only ever populate ONE real
link per document -- there is no separate "listing/detail page" distinct
from the document's own link the way MIB's detail_page_link sometimes was.
That single real link is used for BOTH source_url and file_url here, with
needs_download=True so ingest.ts's existing pdf-parse extraction attempts
full-text download -- and degrades gracefully (extractionFailed ->
needsReview) on the real non-PDF links that exist in this corpus (e.g. CLC
Acts and Rules detail pages), the same handling already proven on DoT/MIB.
"""

import hashlib
from normalized_document import NormalizedDocument


def _source_id(regulator_code: str, source_url: str, title: str) -> str:
    """Stable fingerprint -- these sources have no scraper-native row id the
    way MIB's sha1(title|date|category|link) row hash does, so one is
    generated here the same way."""
    raw = f"{regulator_code}|{source_url}|{title}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def normalize(row: dict) -> NormalizedDocument:
    regulator_code = row.get("regulator", "")
    title = row.get("title", "")
    source_url = row.get("source_url", "")

    return NormalizedDocument(
        regulator_code=regulator_code,
        source_id=_source_id(regulator_code, source_url, title),
        title=title,
        source_url=source_url,
        published_date=row.get("published_date") or None,
        file_url=source_url or None,
        file_extension_hint=None,  # not derivable from these real links without
                                    # a network HEAD request; ingest.ts's PDF
                                    # extraction doesn't require it up front
        category_hint=row.get("document_type"),
        status_hint=None,  # none of EPFO/ESIC/CLC's real pages carry a site-native
                            # status column (unlike MTCTE's archive Active/Expired)
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(source_url),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "title": "Declaration of Rate of Interest for the Employees' Provident Fund Members Account for the year 2025-26",
            "published_date": "2026-07-01",
            "source_url": "https://epfindia.gov.in/site_en/circular_2026_interest.pdf",
            "regulator": "EPFO",
            "regulator_full": "Employees' Provident Fund Organisation",
            "domain": "employment_law",
            "document_type": "notification",
            "labour_codes": "social_security_code",
            "state": "central",
            "scraped_at": "2026-08-13T10:00:00",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
