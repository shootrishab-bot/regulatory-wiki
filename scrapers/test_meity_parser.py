"""
Offline unit tests for meity_parser.py, built against REAL captured HTML
(Orders and Notices, pages 1 and 2, human-relayed 2026-07-31 -- Playwright
access to meity.gov.in is still blocked, so this is real DOM evidence
obtained via a normal browser, not automation) -- the same discipline used
for dot_watcher.py's WAF-block-detection fix
(test_dot_blocked_detection.py): build and verify the parsing logic offline
against real fixtures now, so it's ready to run the moment live access is
available, rather than writing it blind against assumptions.

Real, human-confirmed facts these fixtures encode and these tests check:
- Page 1: 10 rows, all standard ("draft" icon) documents, dates in
  DD.MM.YYYY via aria-label, real PDF links under /static/uploads/.
- Page 2: 10 rows -- 9 standard + exactly ONE grouped/aggregator row
  ("Archive - Delegation of Powers", file_copy icon, counter-box "5",
  link to a detail page, not a PDF) -- must be identified as needing
  expansion, not treated as a normal document.
- Both pages' "View Archive" button real href is /archives?page=orders --
  confirms the archive slug does NOT match the section path
  (orders-and-notices), so it must be read, never inferred.

Run with: python test_meity_parser.py
"""

import os

import meity_parser

failures = 0


def check(label, actual, expected):
    global failures
    ok = actual == expected
    print(f"[{'PASS' if ok else 'FAIL'}] {label} -> {actual!r} (expected {expected!r})")
    if not ok:
        failures += 1


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name), encoding="utf-8") as f:
        return f.read()


page1_html = load_fixture("meity_orders_and_notices_page1.html")
page2_html = load_fixture("meity_orders_and_notices_page2.html")

page1_rows = meity_parser.parse_rows(page1_html)
page2_rows = meity_parser.parse_rows(page2_html)

# ---------------------------------------------------------------------------
# Row counts -- real, confirmed totals from the captured pages.
# ---------------------------------------------------------------------------

check("page 1 has exactly 10 rows", len(page1_rows), 10)
check("page 2 has exactly 10 rows", len(page2_rows), 10)

page1_standard = [r for r in page1_rows if not r["is_group"]]
page1_grouped = [r for r in page1_rows if r["is_group"]]
check("page 1 has 10 standard (draft) rows", len(page1_standard), 10)
check("page 1 has 0 grouped rows", len(page1_grouped), 0)

page2_standard = [r for r in page2_rows if not r["is_group"]]
page2_grouped = [r for r in page2_rows if r["is_group"]]
check("page 2 has 9 standard (draft) rows", len(page2_standard), 9)
check("page 2 has exactly 1 grouped row", len(page2_grouped), 1)

# ---------------------------------------------------------------------------
# The one real grouped row on page 2 -- must be correctly flagged as
# needing expansion, not treated as a directly downloadable document.
# ---------------------------------------------------------------------------

grouped = page2_grouped[0]
check("grouped row title", grouped["title"], "Archive - Delegation of Powers")
check("grouped row is_group flag", grouped["is_group"], True)
check("grouped row real sub-document count", grouped["group_count"], 5)
check("grouped row has no published_date (confirmed real: blank)", grouped["published_date"], None)
check(
    "grouped row link points at a detail page, not a PDF",
    grouped["link"],
    "https://www.meity.gov.in/documents/orders-and-notices/archive-delegation-of-powers-kjM2gjMtQWa?pageTitle=Archive---Delegation-of-Powers",
)
check(
    "grouped row's link is NOT classified as a real file (no .pdf extension)",
    grouped["link"].lower().endswith(".pdf"),
    False,
)

try:
    meity_parser.row_to_normalized_document(grouped, "MEITY", "ORDERS_AND_NOTICES", "https://www.meity.gov.in/documents/orders-and-notices")
    raised = False
except ValueError:
    raised = True
check("converting a grouped row directly to NormalizedDocument raises (must be expanded first)", raised, True)

# ---------------------------------------------------------------------------
# A real standard row from page 1 -- exact field values, including the
# aria-label-based date parse (not the visible text) and file link.
# ---------------------------------------------------------------------------

first = page1_standard[0]
check("page 1 row 1 title", first["title"], "Delegation of Powers dtd. 16-07-2026")
check("page 1 row 1 published_date (ISO, parsed from aria-label)", first["published_date"], "2026-07-16")
check("page 1 row 1 raw aria-label preserved", first["published_date_raw"], "16.07.2026")
check("page 1 row 1 file size (PDF size prefix stripped)", first["file_size"], "209.02 KB")
check(
    "page 1 row 1 real PDF link",
    first["link"],
    "https://www.meity.gov.in/static/uploads/2026/07/c9b573f3d1ebc80cdec172a338416e7f.pdf",
)

last = page1_standard[-1]
check("page 1 row 10 title", last["title"], "Delegation of Powers")
check("page 1 row 10 published_date", last["published_date"], "2026-03-11")

# A real standard row from page 2, to cross-check against a second real
# page rather than trusting page 1 alone.
p2_first = page2_standard[0]
check(
    "page 2 row 1 title",
    p2_first["title"],
    "Revised work distribution amongst Group Coordinators/HAG level officers in MeitY & Link Officer arrangement - Amendment",
)
check("page 2 row 1 published_date", p2_first["published_date"], "2026-03-05")

# ---------------------------------------------------------------------------
# Converting a real standard row to the shared NormalizedDocument contract.
# ---------------------------------------------------------------------------

doc = meity_parser.row_to_normalized_document(
    first, regulator_code="MEITY", category_hint="ORDERS_AND_NOTICES",
    source_url="https://www.meity.gov.in/documents/orders-and-notices",
)
check("NormalizedDocument.regulator_code", doc.regulator_code, "MEITY")
check("NormalizedDocument.title", doc.title, "Delegation of Powers dtd. 16-07-2026")
check("NormalizedDocument.published_date (ISO)", doc.published_date, "2026-07-16")
check(
    "NormalizedDocument.file_url",
    doc.file_url,
    "https://www.meity.gov.in/static/uploads/2026/07/c9b573f3d1ebc80cdec172a338416e7f.pdf",
)
check("NormalizedDocument.file_extension_hint", doc.file_extension_hint, "pdf")
check("NormalizedDocument.category_hint", doc.category_hint, "ORDERS_AND_NOTICES")
check("NormalizedDocument.needs_download defaults True", doc.needs_download, True)

# ---------------------------------------------------------------------------
# date parsing edge cases -- confirms aria-label (not visible text) is what
# gets parsed, and that unparseable/absent input degrades safely rather
# than fabricating a guess.
# ---------------------------------------------------------------------------

check("parse_date_ddmmyyyy handles a real DD.MM.YYYY value", meity_parser.parse_date_ddmmyyyy("16.07.2026"), "2026-07-16")
check("parse_date_ddmmyyyy returns None for None input", meity_parser.parse_date_ddmmyyyy(None), None)
check("parse_date_ddmmyyyy leaves an unparseable string untouched, not fabricated", meity_parser.parse_date_ddmmyyyy("not-a-date"), "not-a-date")
check("parse_file_size strips the real 'PDF size ' prefix", meity_parser.parse_file_size("PDF size 1.02 MB"), "1.02 MB")
check("parse_file_size returns None for None input", meity_parser.parse_file_size(None), None)

# ---------------------------------------------------------------------------
# find_archive_url() -- confirms the real, non-obvious slug mismatch
# (orders-and-notices listing -> "orders" archive slug) is read directly
# from both real pages, never inferred from the section path.
# ---------------------------------------------------------------------------

check(
    "page 1 real archive URL (slug 'orders', NOT 'orders-and-notices')",
    meity_parser.find_archive_url(page1_html),
    "https://www.meity.gov.in/archives?page=orders",
)
check(
    "page 2 real archive URL matches page 1 (same section, same real slug)",
    meity_parser.find_archive_url(page2_html),
    "https://www.meity.gov.in/archives?page=orders",
)

# ---------------------------------------------------------------------------
# Expanded grouped-row detail page ("Archive - Delegation of Powers", real
# captured 2026-07-31). Confirmed real differences from listing rows this
# section exercises:
#   - no icon span at all (neither "draft" nor "file_copy") on any row
#   - no small.ptype element at all -- these are dateless reference
#     amendments to a base document, not a parsing failure
#   - empty <nav aria-label="pagination"></nav>, consistent with only 5
#     total items and no further pages
# Reuses parse_rows() UNCHANGED -- is_group only ever checks for the
# "file_copy" icon text, so an absent icon correctly defaults to
# is_group=False rather than requiring an icon to exist at all, and
# published_date already tolerates a missing small.ptype (defaults to
# None) for every row type, not just these. No code change was needed;
# this section proves that via a real fixture rather than assuming it.
# ---------------------------------------------------------------------------

group_detail_html = load_fixture("meity_orders_and_notices_group_delegation_of_powers.html")
group_detail_rows = meity_parser.parse_rows(group_detail_html)

check("expanded detail page returns exactly 5 rows", len(group_detail_rows), 5)

# Cross-fixture consistency check: the real count parsed from the detail
# page must match the real counter="5" badge captured on the page 2
# LISTING fixture's grouped row -- this ties two independently-captured
# real pages together rather than checking either number in isolation.
check(
    "detail page row count matches the page 2 listing's real counter-box badge",
    len(group_detail_rows),
    grouped["group_count"],
)

check("no row in the detail page is misidentified as a grouped/aggregator row", any(r["is_group"] for r in group_detail_rows), False)
check("no row in the detail page has a non-null published_date (all 5 are genuinely dateless)", any(r["published_date"] is not None for r in group_detail_rows), False)
check("no row in the detail page has a non-null raw date either", any(r["published_date_raw"] is not None for r in group_detail_rows), False)

expected_titles = [
    "Delegation of Powers",
    "Amendment of DOP 15.01.2021",
    "Amendment of DOP 04.03.2021",
    "Amendment of DOP 14.07.2021",
    "Amendment of DOP 15.02.2022",
]
check("detail page titles match all 5 real titles, in order", [r["title"] for r in group_detail_rows], expected_titles)

expected_links = [
    "https://www.meity.gov.in/static/uploads/2024/10/840f63d4986e11a4f970d24db162d1d5.pdf",
    "https://www.meity.gov.in/static/uploads/2024/10/189d30cc5d047ef6f6c70f81a2695123.pdf",
    "https://www.meity.gov.in/static/uploads/2024/10/80be8a7f0da87cb469e5c622df8be1d3.pdf",
    "https://www.meity.gov.in/static/uploads/2024/10/222767bf9d6fa1714420cc899fe60057.pdf",
    "https://www.meity.gov.in/static/uploads/2024/10/b1c5635192cbb0f08217f066affcf403.pdf",
]
check("detail page real PDF links, in order", [r["link"] for r in group_detail_rows], expected_links)

# Every real row here must convert to NormalizedDocument cleanly with
# published_date=None -- must NOT raise, unlike the grouped row itself.
detail_docs = [
    meity_parser.row_to_normalized_document(
        r, regulator_code="MEITY", category_hint="ORDERS_AND_NOTICES",
        source_url=grouped["link"],
    )
    for r in group_detail_rows
]
check("all 5 expanded rows convert to NormalizedDocument without raising", len(detail_docs), 5)
check("expanded NormalizedDocument published_date is None (optional, not required)", all(d.published_date is None for d in detail_docs), True)
check("expanded NormalizedDocument titles match", [d.title for d in detail_docs], expected_titles)
check("expanded NormalizedDocument file_url values match", [d.file_url for d in detail_docs], expected_links)

print()
print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
raise SystemExit(0 if failures == 0 else 1)
