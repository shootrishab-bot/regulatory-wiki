"""
Regression test for the status-aware merge gate in mtcte_adapter.py.

Guards against the exact bug class found during a real audit (2026-07-28):
the date gate alone doesn't stop two DIFFERENT real archive documents that
happen to share an exact listed_date (e.g. the 2022-08-24 bulk-backfill
placeholder date) from merging if their titles also clear
FUZZY_MATCH_THRESHOLD. No real conflict existed in the actual 195-row
dataset (checked directly, not assumed — closest real cross-status
same-date pair scored 0.795, just under the 0.85 threshold), but nothing
in the grouping logic prevented one. This test constructs a synthetic
pair that DOES clear the threshold, modeled on that real near-miss, to
prove the status gate blocks it and can never silently regress.

Run with: python test_mtcte_status_gate.py
"""

import mtcte_adapter

failures = 0


def check(label, actual, expected):
    global failures
    ok = actual == expected
    print(f"[{'PASS' if ok else 'FAIL'}] {label} -> {actual!r} (expected {expected!r})")
    if not ok:
        failures += 1


# Modeled on the real near-miss pair found during the audit:
#   "Exemption pertaining to parameters of LAN Switch under MTCTE-reg" [Active, 2022-08-24]
#   vs "...Radio Broadcast Receiver (RBR)..." [Expired, 2022-08-24] -- scored only 0.795,
#   so it never actually threatened a merge under FUZZY_MATCH_THRESHOLD (0.85).
# This pair keeps the real Active title verbatim but pairs it with a
# realistic near-duplicate variant (an "Addendum-" prefix, the same real
# convention seen elsewhere in the dataset) that DOES clear 0.85 (0.934),
# sharing the same date, with conflicting status -- exactly the
# configuration the status gate exists to block.
CONFLICTING_STATUS_SAME_DATE_ROWS = [
    {
        "title": "Exemption pertaining to parameters of LAN Switch under MTCTE-reg",
        "pdf_link": "https://www.mtcte.tec.gov.in/filedownload?name=downloadDocument_lan_switch.pdf",
        "source_page": "https://www.mtcte.tec.gov.in/",
        "source_section": "archive_circulars_instructions",
        "status": "Active",
        "listed_date": "2022-08-24",
        "scraped_at": "2026-07-27T10:00:00",
    },
    {
        "title": "Addendum- Exemption pertaining to parameters of LAN Switch under MTCTE-reg",
        "pdf_link": "https://www.mtcte.tec.gov.in/filedownload?name=downloadDocument_lan_switch_addendum.pdf",
        "source_page": "https://www.mtcte.tec.gov.in/",
        "source_section": "archive_circulars_instructions",
        "status": "Expired",
        "listed_date": "2022-08-24",
        "scraped_at": "2026-07-27T10:00:00",
    },
]

# Sanity-check the premise before testing the gate: confirm this synthetic
# pair really does clear FUZZY_MATCH_THRESHOLD on title alone and really
# does share an exact date -- otherwise the gate wouldn't even be
# exercised and the test would pass for the wrong reason.
from difflib import SequenceMatcher

na = mtcte_adapter._normalize_title_for_matching(CONFLICTING_STATUS_SAME_DATE_ROWS[0]["title"])
nb = mtcte_adapter._normalize_title_for_matching(CONFLICTING_STATUS_SAME_DATE_ROWS[1]["title"])
title_score = SequenceMatcher(None, na, nb).ratio()
check(
    f"premise: synthetic pair's title similarity ({title_score:.3f}) clears FUZZY_MATCH_THRESHOLD ({mtcte_adapter.FUZZY_MATCH_THRESHOLD})",
    title_score >= mtcte_adapter.FUZZY_MATCH_THRESHOLD,
    True,
)
check(
    "premise: synthetic pair shares an exact listed_date",
    CONFLICTING_STATUS_SAME_DATE_ROWS[0]["listed_date"] == CONFLICTING_STATUS_SAME_DATE_ROWS[1]["listed_date"],
    True,
)
check(
    "premise: synthetic pair has conflicting status",
    CONFLICTING_STATUS_SAME_DATE_ROWS[0]["status"] != CONFLICTING_STATUS_SAME_DATE_ROWS[1]["status"],
    True,
)

# The actual regression check: despite clearing title + date compatibility,
# the status gate must keep these two rows in SEPARATE groups.
groups = mtcte_adapter._group_rows_by_fuzzy_title(CONFLICTING_STATUS_SAME_DATE_ROWS)
check(
    "status gate blocks the merge: two separate groups, not one",
    len(groups),
    2,
)

# Compatible case: same setup, but one side has NO status_hint at all
# (mirrors a homepage row) -- must still merge, exactly like the existing
# "no date" allowance. Proves the gate doesn't over-block.
NO_STATUS_SIDE_ROWS = [
    dict(CONFLICTING_STATUS_SAME_DATE_ROWS[0]),
    {**CONFLICTING_STATUS_SAME_DATE_ROWS[1], "status": "", "source_section": "whats_new_marquee", "listed_date": ""},
]
groups_no_status_conflict = mtcte_adapter._group_rows_by_fuzzy_title(NO_STATUS_SIDE_ROWS)
check(
    "no over-blocking: a row with NO status_hint still merges with a dated/statused row",
    len(groups_no_status_conflict),
    1,
)

print()
print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
raise SystemExit(0 if failures == 0 else 1)
