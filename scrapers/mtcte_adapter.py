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
        "source_section": "whats_new_marquee",  # or "policy_vision_head",
                                                  # "archive_circulars_instructions",
                                                  # "archive_proforma_formats"
        "scraped_at": "...",
    }

CROSS-SOURCE DEDUP (2026-07-28): mtcte_watcher.py now scrapes 4 sources —
an archive (downloads?section=0/1, PRIMARY) plus the original homepage
sections (whats_new_marquee, policy_vision_head — SUPPLEMENTARY,
confirmed to carry a little real unique content and a canary-signal
value). Its own dedup is keyed on pdf_link, but a real, confirmed site
characteristic breaks that for cross-source duplicates: the SAME
real-world document gets a DIFFERENT download link depending on which
page serves it — e.g. "Notification of Telecommunication Equipment under
Phase-VI of MTCTE" is `.../downloadDocument_20250227172803.pdf` from the
archive but `.../downloadDocument_20250227174722_en.pdf` (an "_en"
variant) from the homepage marquee. Confirmed via a real title-by-title
cross-reference: 195 raw rows collapse to well under that once these
cross-source duplicates are merged.

dedup_cross_source() groups rows by fuzzy title similarity (not exact
match — confirmed real duplicates differ by minor punctuation/wording,
e.g. a trailing "-reg" or "New") and, within each group, prefers the
archive-sourced row (PRIMARY source, and the only one with a real
Active/Expired status field) over a homepage row. FUZZY_MATCH_THRESHOLD
= 0.85 is not an arbitrary guess: confirmed real cross-source duplicates
score 0.90-1.00 on this metric, while a real near-miss case — "Click
here for MTCTE User Instructions" (homepage) vs "MTCTE User Instructions
V 3.0" (archive) — scores only 0.69 AND was confirmed, by comparing
their actual pdf_links, to point to two genuinely different files
(.../downloadDocument_MTCTEinstructions.pdf vs
.../downloadDocument_20240403150023.pdf) — i.e. NOT the same document
despite similar wording. 0.85 sits cleanly between the two, erring
toward NOT merging when a group's evidence is ambiguous, since wrongly
merging two distinct real documents is worse than leaving a probably-
redundant title in the output for a human to notice later.

DATE-AWARE MATCHING (2026-07-28): title similarity alone is NOT enough
to gate a merge. MTCTE periodically REISSUES certain notices — same
topic, near-identical boilerplate title, but a genuinely different real
filing each time (different listed_date, sometimes different status).
Confirmed via a real audit of every multi-row group after the first
cross-source-only version of this function shipped: 18 of 44 multi-row
groups had wrongly merged rows with DIFFERENT archive listed_dates into
one representative, silently discarding 39 real, distinct, dated
filings. Concrete example: "Exemption pertaining to various parameters/
Interfaces of ERs under MTCTE" is refiled roughly every 2-3 months (15
distinct archive rows, 2022-08-24 through 2026-07-01, each Active or
Expired in its own right) — fuzzy title matching alone collapsed all 15
plus 3 real homepage duplicates into a single row.

Fix: two rows may only join the same group if, in addition to clearing
FUZZY_MATCH_THRESHOLD on title, their listed_date values are compatible
— either equal, or at least one side has no date at all. Archive rows
always carry a real listed_date, so two archive rows with DIFFERENT
dates can never merge, no matter how similar their titles (this is what
keeps the 15 distinct exemption filings separate). Homepage rows never
carry listed_date at all, so they remain free to merge into whichever
dated archive group they actually correspond to by title — and since
_pick_representative() always prefers the archive row regardless of
which specific dated group absorbs a given homepage duplicate, it does
not matter which one it lands in: the final output is unaffected either
way, and no real document is lost.

STATUS-AWARE MATCHING (2026-07-28): the date gate alone does not rule out
merging two DIFFERENT real archive documents that happen to share an
exact listed_date (e.g. the 2022-08-24 bulk-backfill placeholder date,
which covers ~48 topically unrelated documents) if their titles also
happen to clear FUZZY_MATCH_THRESHOLD. Checked directly against the real
195-row dataset before assuming this couldn't happen: 0 of 39 real
multi-row groups mix Active and Expired rows today, and the closest any
real cross-status same-date pair came to merging was 0.795 similarity
("Exemption pertaining to parameters of LAN Switch under MTCTE-reg"
[Active] vs "...Radio Broadcast Receiver (RBR)..." [Expired], both
2022-08-24) — meaningfully under the 0.85 threshold, but not by a large
margin. Since nothing about the grouping logic actually prevents a
same-dated, similarly-titled, different-status pair from merging, this
is hardened explicitly rather than left as an unverified assumption: two
rows may only merge if, in addition to title and date compatibility,
their status_hint values are compatible — either equal, or at least one
side has no status_hint at all (homepage rows never carry one, so this
mirrors the existing "no date" allowance exactly). Two archive rows with
explicitly conflicting Active/Expired values can now never merge no
matter how similar their titles or how coincidentally aligned their
dates.
"""

import hashlib
import re
from difflib import SequenceMatcher

from normalized_document import NormalizedDocument

REGULATOR_CODE = "MTCTE"

FUZZY_MATCH_THRESHOLD = 0.85

# Archive sources are PRIMARY — preferred over homepage sources within a
# matched group, in this priority order.
ARCHIVE_SOURCE_PRIORITY = ["archive_circulars_instructions", "archive_proforma_formats"]


def _normalize_title_for_matching(title: str) -> str:
    t = title.lower()
    t = re.sub(r"\(expired\)|\(active\)", "", t)
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _group_rows_by_fuzzy_title(rows: list[dict]) -> list[list[dict]]:
    """Greedy single-linkage clustering: each row joins the first existing
    group whose representative (its first member) it matches above
    FUZZY_MATCH_THRESHOLD AND whose listed_date AND status are both
    compatible (equal, or either side has none), else starts a new group.
    Adequate here because real duplicates in this dataset match each
    OTHER at 0.90+, not just a shared group representative transitively —
    confirmed by inspecting the actual matches, not assumed. The date gate
    is required — see module docstring's DATE-AWARE MATCHING section for
    the real 39-document over-merge this caught. The status gate is
    required too — see STATUS-AWARE MATCHING for why the date gate alone
    doesn't rule out merging two different real documents that share a
    bulk placeholder date."""
    groups: list[list[dict]] = []
    group_norms: list[str] = []
    group_dates: list[str | None] = []
    group_statuses: list[str | None] = []

    for row in rows:
        norm = _normalize_title_for_matching(row.get("title", ""))
        row_date = (row.get("listed_date") or "").strip() or None
        row_status = (row.get("status") or "").strip() or None
        placed = False
        for i, rep_norm in enumerate(group_norms):
            if SequenceMatcher(None, norm, rep_norm).ratio() < FUZZY_MATCH_THRESHOLD:
                continue
            existing_date = group_dates[i]
            if row_date and existing_date and row_date != existing_date:
                continue  # same title family, different real filing — not a duplicate
            existing_status = group_statuses[i]
            if row_status and existing_status and row_status != existing_status:
                continue  # explicitly conflicting Active/Expired — never the same document
            groups[i].append(row)
            if existing_date is None and row_date:
                group_dates[i] = row_date
            if existing_status is None and row_status:
                group_statuses[i] = row_status
            placed = True
            break
        if not placed:
            groups.append([row])
            group_norms.append(norm)
            group_dates.append(row_date)
            group_statuses.append(row_status)

    return groups


def _pick_representative(group: list[dict]) -> dict:
    """Picks one row per group. Source priority (archive over homepage) is
    the primary rule. When MULTIPLE rows share the same top priority
    level — e.g. two archive_circulars_instructions rows that merged
    because they share a date/status and a similar-enough title (real
    case: "Notification for Acceptance of Test Reports..." merging with
    "Extension of Acceptance of Test Reports...", same 2022-08-24 date,
    both Expired) — break the tie deterministically by (title, pdf_link)
    rather than by "whichever happened to appear first in scrape order",
    which isn't a real rule and isn't guaranteed stable across re-scrapes.
    Given the date and status gates in _group_rows_by_fuzzy_title(), two
    archive rows in the same group are now guaranteed to share the same
    listed_date and the same status (archive rows always populate both,
    and the gates require equality when both sides have a value) — so
    this tie-break only ever needs to choose between real wording
    variants of the same filing, never between conflicting dates or
    conflicting statuses. Confirmed directly against the real dataset,
    not assumed — see test_mtcte_status_gate.py's audit of every
    multi-archive-row group."""
    for source in ARCHIVE_SOURCE_PRIORITY:
        candidates = [row for row in group if row.get("source_section") == source]
        if candidates:
            candidates.sort(key=lambda row: (row.get("title", ""), row.get("pdf_link", "")))
            return candidates[0]
    # No archive row in this group — per a real Part 1 cross-reference,
    # this should only happen for the 3 genuinely-unique policy_vision_head
    # items (SIM/IP Security standards notification, the products-list
    # .docx, the external voluntary-certification link). Keep as-is —
    # there's nothing to prefer it over.
    return group[0]


def dedup_cross_source(rows: list[dict]) -> list[dict]:
    """Run BEFORE normalize()/normalize_all()'s per-row mapping — collapses
    cross-source duplicates (same real document, different pdf_link
    depending on source) down to one representative row per real document,
    preferring the archive-sourced version. See module docstring for the
    real evidence behind the threshold and the priority order."""
    groups = _group_rows_by_fuzzy_title(rows)
    return [_pick_representative(g) for g in groups]


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
        status_hint=row.get("status") or None,  # archive rows carry a real
                                                  # Active/Expired value from
                                                  # mtcte_watcher.py; homepage-
                                                  # sourced rows (whats_new_marquee,
                                                  # policy_vision_head) leave this
                                                  # column blank — `or None`
                                                  # normalizes "" to None rather
                                                  # than passing through an empty
                                                  # string, matching this field's
                                                  # documented "None when the
                                                  # source doesn't track this"
                                                  # contract.
        raw_text=None,
        raw_text_source=None,
        needs_download=bool(link),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    deduped_rows = dedup_cross_source(rows)
    return [normalize(row) for row in deduped_rows]


if __name__ == "__main__":
    # A realistic cross-source duplicate pair (modeled on the real
    # "Notification of Telecommunication Equipment under Phase-VI of
    # MTCTE" case: same document, different pdf_link per source) plus one
    # genuinely-unique homepage-only item, to sanity-check that dedup
    # keeps exactly the archive row for the duplicate pair and keeps the
    # unique item as-is.
    sample_rows = [
        {
            "id": "type_approval_procedure_for_xyz_device",  # the fragile original — ignored
            "title": "Type Approval Procedure for XYZ Device",
            "pdf_link": "https://www.mtcte.tec.gov.in/filedownload?name=downloadDocument_20250227172803.pdf",
            "pdf_filename": "type-approval-procedure-for-xyz-device.pdf",
            "source_page": "https://www.mtcte.tec.gov.in/",
            "source_section": "archive_circulars_instructions",
            "scraped_at": "2026-07-27T10:00:00",
        },
        {
            "id": "type_approval_procedure_for_xyz_device",
            "title": "Type Approval Procedure for XYZ Device",  # same document, different link
            "pdf_link": "https://www.mtcte.tec.gov.in/filedownload?name=downloadDocument_20250227174722_en.pdf",
            "pdf_filename": "type-approval-procedure-for-xyz-device.pdf",
            "source_page": "https://www.mtcte.tec.gov.in/",
            "source_section": "whats_new_marquee",
            "scraped_at": "2026-07-27T10:00:00",
        },
        {
            "id": "voluntary_certification_procedure_and_other",
            "title": "Click here for Voluntary Certification procedure and other related documents New",
            "pdf_link": "https://www.tec.gov.in/voluntary-testing-certification",
            "pdf_filename": "voluntary-certification-procedure.pdf",
            "source_page": "https://www.mtcte.tec.gov.in/",
            "source_section": "policy_vision_head",  # no archive counterpart — genuinely unique
            "scraped_at": "2026-07-27T10:00:00",
        },
    ]
    print(f"input rows: {len(sample_rows)}")
    docs = normalize_all(sample_rows)
    print(f"output documents after cross-source dedup: {len(docs)}")
    for doc in docs:
        print(doc)
