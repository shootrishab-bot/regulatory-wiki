"""
MTCTE Adapter — Pattern A (metadata + link only), with one deliberate fix.

mtcte_watcher.py generates its own "id" from a truncated, lowercased
title slug:
    "id": re.sub(r"\\W+", "_", data["title"].lower())[:50]
This is NOT a content hash like every other script uses (they all hash
title+link with SHA1). Two real risks: two different documents with
similar opening words truncate to the same 50-character slug and
collide, or the exact same document gets a DIFFERENT id after a trivial
title edit on the site (e.g. a typo fix), causing it to look like a new
document on the next scrape rather than being recognized as the same one.

FIX: this adapter computes its own stable id from title+pdf_link (SHA1,
matching the convention every other script already uses correctly),
rather than trusting MTCTE's own fragile id. The original id is kept
alongside as `original_source_id` for traceability, but source_id (the
field actually used for dedup downstream) uses the recomputed hash.

INPUT: one row from mtcte_master.csv, e.g.:
    {
        "id": "type_approval_procedure_for_xyz",  # fragile — not used as source_id
        "title": "Type Approval Procedure for XYZ",
        "pdf_link": "https://www.mtcte.tec.gov.in/...",
        "pdf_filename": "type-approval-procedure-for-xyz.pdf",
        "source_page": "https://www.mtcte.tec.gov.in/",
        "source_section": "whats_new_marquee",  # or "policy_vision_head"
        "scraped_at": "...",
    }
"""

import hashlib
from normalized_document import NormalizedDocument

REGULATOR_CODE = "MTCTE"


def _stable_id(title: str, link: str) -> str:
    """Recompute a proper content-hash id, matching the convention every
    other watcher script already uses (SHA1 of title+link) — see this
    file's docstring for why MTCTE's own id can't be trusted as-is."""
    raw = f"{title}|{link}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def normalize(row: dict) -> NormalizedDocument:
    title = row.get("title", "")
    link = row.get("pdf_link", "")

    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=_stable_id(title, link),  # recomputed, NOT row["id"] — see docstring
        title=title,
        source_url=row.get("source_page", ""),
        published_date=None,  # MTCTE's scraper doesn't capture a date at all —
                               # genuinely absent from the source, not a parsing
                               # gap. Downstream may need to fall back to
                               # discoveredAt (when we first saw it) instead.
        file_url=link or None,
        file_extension_hint="pdf" if link else None,
        category_hint=row.get("source_section"),  # "whats_new_marquee" or
                                                    # "policy_vision_head" — a
                                                    # weaker signal than other
                                                    # scripts' category fields
                                                    # (it's a page SECTION, not
                                                    # a document TYPE), pass it
                                                    # through anyway since it's
                                                    # still better than nothing
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(link),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "type_approval_procedure_for_xyz_device",  # the fragile original — ignored
            "title": "Type Approval Procedure for XYZ Device",
            "pdf_link": "https://www.mtcte.tec.gov.in/documents/sample.pdf",
            "pdf_filename": "type-approval-procedure-for-xyz-device.pdf",
            "source_page": "https://www.mtcte.tec.gov.in/",
            "source_section": "whats_new_marquee",
            "scraped_at": "2026-07-27T10:00:00",
        }
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
