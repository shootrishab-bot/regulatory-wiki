#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MeitY (Ministry of Electronics and Information Technology) scraper.

STATUS (2026-07-31): Built from real, live-confirmed site structure --
NOT yet run against the live site by automation. meity.gov.in blocks
Playwright/headless automation with the same Akamai 403 "Access Denied"
response as dot.gov.in (confirmed directly, same day, same block signature:
server=AkamaiGHost, title="Access Denied"). Everything below was verified by
having a human paste real, post-JS-render browser HTML directly -- not by
guessing from dot_watcher.py's shape, and not by running this file. Do not
treat this as proven until it has actually been executed against the live
site and produced real counts.

CONFIRMED REAL, from a human-pasted DOM dump of https://www.meity.gov.in/documents
(Reports section, page 1), 2026-07-31:

1. Card markup is IDENTICAL to dot_watcher.py's: div.announcementbox /
   p.mb-0 (title) / small.ptype (date) / a.download-btn (file link).
2. Grouped/counter cards use the exact same pattern as DoT's
   "Annual Report 2024-25" case: a "file_copy" icon (vs "draft" for single
   documents), a div.counter-box showing a count (e.g. "Integrated Finances"
   -> 19, "Outcome Budget (2015)" -> 9), and a.download-btn pointing at a
   /documents/{section-slug}/{item-slug}?pageTitle=... sub-page instead of
   a real file -- confirmed these need the same expand-and-do-not-silently-
   fallback treatment already built for DoT.
3. The "View Archive" button is byte-for-byte the same pattern as DoT's:
   class="...archivemr..." href="/archives?page={slug}". Confirmed real
   for Reports: href="/archives?page=reports".
4. STRIKING CONFIRMATION this is genuinely the same CMS template, not
   coincidence: MeitY's own "Reports" nav entry is href="/documents" (bare,
   no /reports path segment) -- the EXACT SAME anomaly DoT's Reports section
   has. Two independent government sites sharing this exact quirk is not a
   coincidence.
5. Reports' live pagination footer shows real page numbers 1, 2, 3 --
   confirmed 3 pages of non-archived listings for that section, well within
   the "10 per page" default shown in the page's own dropdown.
6. IMPORTANT STRUCTURAL DIFFERENCE FROM DOT, not papered over: the
   pagination control markup is <li class="page-item"><span
   class="page-link pointer hover">2</span></li> -- a <span>, not an
   <a href>. This is the SAME markup shape dot_watcher.py's own
   scrape_archive() already had to handle for DoT's *archive* pages
   (client-side, URL never changes) -- it is NOT necessarily the same as
   what dot_watcher.py's scrape_section() assumes for DoT's *regular*
   listings (plain ?page=N URL navigation, which happens to work for DoT
   but was never itself verified against this exact span-based markup).
   Given no live evidence either way for MeitY, this file uses the SAFER,
   already-proven click-based approach (reusing dot_watcher.py's own
   goto_and_check_blocked plus a click loop) for regular listings too,
   rather than assuming ?page=N works here.
7. Dates are YEAR-ONLY ("Published Year: 2024"), not DD.MM.YYYY like DoT.
   dot_watcher.py's normalize_date() expects day.month.year strings and
   will not parse a bare year -- deliberately NOT reused here. The raw
   year string is stored as-is.
8. NOT verified, flagged rather than assumed: whether MeitY's card ordering
   is genuinely reverse-chronological with no pinned items. The site's own
   "Sort by: Latest / Oldest" dropdown is a real signal that default order
   is not guaranteed the way it might be elsewhere. Per the explicit
   instruction this file was built under, NO year_stop-style early-stop
   optimization is implemented here until that is verified live. Every
   section below therefore paginates to genuine exhaustion (empty page /
   wrap-around detection) rather than stopping early on any date signal.
9. A footer link references href="/archives?page=tenders_post" -- a slug
   with no obvious corresponding entry in the 7 documents-section nav.
   Flagged, not chased: archive slugs may exist beyond the 7 handled here.

UPDATED from a second human-pasted DOM dump, Act and Policies section page 1,
2026-07-31 -- this CHANGED two things built from the Reports-only sample above:

10. Date format is PER-CATEGORY, not a universal MeitY-wide year-only rule as
    finding #7 assumed. Reports' column header is literally "Published Year"
    (bare year values like "2025"); Act and Policies' column header is
    "Published Date" and its single-document cards show real DD.MM.YYYY
    values (e.g. "14.02.2025", "31.10.2023") in the exact same small.ptype
    element. This file never parsed the date (it stores small.ptype's raw
    text verbatim), so no code change was needed here -- but the module-level
    claim of "year-only dates" was wrong and is corrected by this note; do
    not assume a fixed format when reading published_year values downstream.
11. NO "View Archive" button is present anywhere on the Act and Policies
    listing page -- unlike Reports, which had one. This directly falsifies
    the earlier approach of inferring an archive slug for all 7 sections
    from Reports' single confirmed case. Archive presence is per-category,
    not guaranteed. This file now DETECTS the real "View Archive" href on
    each section's own listing page (see find_archive_url()) and only visits
    /archives?page=... when that link actually exists on the page, rather
    than assuming every section has one.
12. The pagination click logic was changed from finding a specific page
    number's span.page-link (which breaks once a section has more pages than
    fit in the visible window, e.g. "1 2 3 4 5 ... 12") to clicking the
    button.button-item.next control and checking its disabled state instead
    -- confirmed real markup: <button class="button-item next" aria-disabled
    ="false"> when more pages remain, and the previous button carries
    aria-disabled="true" disabled on page 1. This is more robust regardless
    of how many total pages a section turns out to have (Reports had 3, Act
    and Policies had 5 -- both directly confirmed, real, different from each
    other).

SECTIONS below list only the 7 confirmed real category paths from MeitY's
own "Documents" nav menu (human-confirmed 2026-07-31), mapped 1:1 to their
real hrefs -- not assumed to mirror DoT's slugs. Archive slugs are NO LONGER
hardcoded/inferred (see finding #11) -- they are detected live per section.
"""

from playwright.sync_api import sync_playwright
from pathlib import Path
from datetime import datetime, timezone
import argparse
import csv
import json
import os

# Reuses dot_watcher.py's own, already-proven block-detection and content-
# detection machinery directly rather than duplicating it -- these are
# generic to this CMS template (confirmed: same Akamai block signature,
# same bhashini-dropdown-btn translate widget, same announcementbox cards).
import dot_watcher as dw

# The row-parsing logic itself (extract_cards/find_archive_url below) is
# delegated to meity_parser.py, which is offline-testable (BeautifulSoup
# against captured HTML, no Playwright/network dependency) and covered by
# test_meity_parser.py against real captured Orders and Notices HTML.
import meity_parser as mp

BASE_URL = "https://www.meity.gov.in"

# (category, listing_url)
# NOTE: per finding #6, this file does NOT navigate by appending a page
# number to this URL the way dot_watcher.py's scrape_section() does for
# DoT; it loads page 1 once and then clicks the pagination "next" button.
# No archive slug is listed here -- per finding #11, archive presence and
# slug are detected live from each listing page's own "View Archive"
# button rather than assumed.
SECTIONS = [
    ("REPORTS", f"{BASE_URL}/documents"),
    ("ACT_AND_POLICIES", f"{BASE_URL}/documents/act-and-policies"),
    ("ORDERS_AND_NOTICES", f"{BASE_URL}/documents/orders-and-notices"),
    ("PUBLICATIONS", f"{BASE_URL}/documents/publications"),
    ("PRESS_RELEASE", f"{BASE_URL}/documents/press-release"),
    ("GAZETTES_NOTIFICATIONS", f"{BASE_URL}/documents/gazettes-notifications"),
    ("GUIDELINES", f"{BASE_URL}/documents/guidelines"),
]

DATA_DIR = "data"
MASTER_CSV = os.path.join(DATA_DIR, "meity_master.csv")
NEW_JSON = os.path.join(DATA_DIR, "meity_new_entries.json")

CSV_FIELDS = [
    "id",
    "title",
    "pdf_link",
    "source_page",
    "category",
    "is_archived",
    "published_year",  # raw small.ptype text -- format varies per category, see finding #10
    "scraped_at",
]

MAX_PAGES_PER_SECTION = 200  # same defensive cap as dot_watcher.py, same rationale


def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_existing_ids():
    if not os.path.exists(MASTER_CSV):
        return set()
    # encoding="utf-8" required -- same real lesson from dot_watcher.py's
    # load_existing_ids()/mtcte_watcher.py's load_existing_links(): Windows'
    # default cp1252 locale cannot decode real scraped title text.
    with open(MASTER_CSV, newline="", encoding="utf-8") as f:
        return {row["id"] for row in csv.DictReader(f)}


def extract_cards(ctx):
    """Extracts cards from the current page/frame by reading its rendered
    HTML (ctx.content()) and parsing it with meity_parser.parse_rows() --
    the SAME function exercised offline in test_meity_parser.py against
    real captured HTML (Orders and Notices pages 1-2, 2026-07-31). This is
    deliberate: rather than maintaining a second, Playwright-native
    selector dialect here that the offline tests can't reach, the live
    scraper reuses the exact tested code path. See meity_parser.py's module
    docstring for why."""
    html = ctx.content()
    parsed = mp.parse_rows(html)
    results = []
    for row in parsed:
        if not row["link"] or not row["title"]:
            continue
        results.append({
            "title": row["title"],
            "pdf_link": row["link"],
            "published_year": row["published_date_raw"] or "",
            "is_group": row["is_group"],
        })
    return results


def find_archive_url(page):
    """Looks for the real "View Archive" button on the current listing
    page and returns its href, or None if absent, via meity_parser's own
    tested find_archive_url() -- confirmed real from both Orders and
    Notices pages that its slug ("orders") does not match the section path
    ("orders-and-notices"), so this must always be read live, never
    inferred. Per finding #11, this button is NOT guaranteed to exist on
    every section (confirmed absent on Act and Policies)."""
    href = mp.find_archive_url(page.content())
    return href


def click_next_page(page):
    """Clicks the pagination "next" button if enabled. Returns True if a
    click happened, False if there is no next page. Per finding #12, this
    replaces looking up a specific page number's span.page-link, which
    breaks once a section has more pages than fit in the visible number
    window -- confirmed real markup: button.button-item.next carries
    aria-disabled="false" when more pages remain, aria-disabled="true"
    (and the disabled attribute) when there are none."""
    next_btn = page.query_selector("button.button-item.next")
    if not next_btn:
        return False
    aria_disabled = next_btn.get_attribute("aria-disabled")
    if aria_disabled == "true" or next_btn.get_attribute("disabled") is not None:
        return False
    try:
        next_btn.click(timeout=5000)
    except Exception:
        return False
    return True


def is_real_file(url):
    # Reuses dot_watcher.py's own real-file check -- confirmed applicable
    # here too: MeitY's real PDFs also live under /static/uploads/... (see
    # e.g. the confirmed real link
    # https://www.meity.gov.in/static/uploads/2024/10/b7cc14868215134748edbaecbf98630e.pdf).
    return dw.is_real_file_url(url)


def expand_group_page(context, url, category, label):
    """Visits a grouped/counter-card's own sub-page (e.g. "Integrated
    Finances", counter=19) and extracts every real sub-document found
    there. Mirrors dot_watcher.py's expand_detail_page(), including its
    BlockedError contract -- a blocked expansion must NEVER be silently
    treated as "nothing to expand", per the confirmed real PHP-TACs lesson
    from the DoT investigation."""
    page = context.new_page()
    try:
        dw.goto_and_check_blocked(page, url, label=f"{category} group page [{label}]")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(3000)
        dw.force_english(page)

        ctx = dw.find_ctx(page, timeout=20000)
        if not ctx:
            return []

        rows = []
        for card in extract_cards(ctx):
            if card["is_group"]:
                # Not observed in the confirmed sample, but a group-inside-
                # a-group would need its own recursive expansion -- skip
                # rather than silently flatten incorrectly, matching
                # dot_watcher.py's own conservative choice for unobserved
                # shapes.
                continue
            if not is_real_file(card["pdf_link"]):
                continue
            rows.append(card)
        return rows
    finally:
        page.close()


def scrape_listing(page, category, listing_url, existing_ids):
    """Scrapes a section's regular (non-archived) listing to genuine
    exhaustion via click-based pagination -- see module docstring finding
    #6 for why this does NOT use dot_watcher.py's ?page=N URL approach.
    Returns (rows, blocked, archive_url) -- archive_url is the real,
    detected "View Archive" href if one exists on this section's page 1,
    else None (see finding #11)."""
    rows = []
    blocked = []
    archive_url = None

    try:
        dw.goto_and_check_blocked(page, listing_url, label=f"{category} listing page 1")
    except dw.BlockedError as e:
        print(f"!!! {category}: {e}")
        blocked.append({"category": category, "page": 1, "url": listing_url})
        return rows, blocked, archive_url

    page.wait_for_load_state("domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3500)
    dw.force_english(page)

    archive_url = find_archive_url(page)
    if archive_url:
        print(f"{category}: found real archive link -> {archive_url}")
    else:
        print(f"{category}: no 'View Archive' button on this listing -- skipping archive for this section")

    current_page_num = 1
    while True:
        if current_page_num > MAX_PAGES_PER_SECTION:
            print(f"!!! Hit MAX_PAGES_PER_SECTION on {category} -- stopping defensively")
            break

        ctx = dw.find_ctx(page)
        if not ctx:
            print(f"No content context on {category} page {current_page_num} -- stopping")
            break

        cards = extract_cards(ctx)
        print(f"{category} listing page {current_page_num}: {len(cards)} cards found")
        if not cards:
            break

        first_title_before = cards[0]["title"] if cards else None

        for card in cards:
            if card["is_group"]:
                print(f"  expanding grouped card: {card['title'][:60]} -> {card['pdf_link']}")
                try:
                    sub_rows = expand_group_page(page.context, card["pdf_link"], category, card["title"])
                except dw.BlockedError as e:
                    print(f"    !!! BLOCKED expanding grouped card: {card['title'][:60]} -- {e}")
                    blocked.append({"category": category, "topic_title": card["title"], "url": card["pdf_link"]})
                    continue
                print(f"    -> {len(sub_rows)} real sub-document(s) found")
                for sub in sub_rows:
                    row_id = dw.make_id(sub["pdf_link"])
                    if row_id in existing_ids:
                        continue
                    rows.append({
                        "id": row_id,
                        "title": sub["title"],
                        "pdf_link": sub["pdf_link"],
                        "source_page": card["pdf_link"],
                        "category": category,
                        "is_archived": False,
                        "published_year": sub["published_year"],
                        "scraped_at": now_iso(),
                    })
            else:
                if not is_real_file(card["pdf_link"]):
                    # Not a real file and not a group -- an external link or
                    # unrecognized shape. Not observed in the confirmed
                    # sample; keep as a single row rather than silently drop,
                    # matching dot_watcher.py's own external-link fallback.
                    pass
                row_id = dw.make_id(card["pdf_link"])
                if row_id in existing_ids:
                    continue
                rows.append({
                    "id": row_id,
                    "title": card["title"],
                    "pdf_link": card["pdf_link"],
                    "source_page": listing_url,
                    "category": category,
                    "is_archived": False,
                    "published_year": card["published_year"],
                    "scraped_at": now_iso(),
                })

        # Advance via the "next" pagination button -- see finding #12.
        if not click_next_page(page):
            print(f"No enabled 'next' button -- assuming end of {category} listing ({current_page_num} page(s) total)")
            break

        page.wait_for_timeout(2500)

        ctx_after = dw.find_ctx(page)
        after_cards = extract_cards(ctx_after) if ctx_after else []
        first_title_after = after_cards[0]["title"] if after_cards else None

        if first_title_after == first_title_before:
            print(f"Clicking 'next' didn't change content -- stopping {category} listing")
            break

        current_page_num += 1

    return rows, blocked, archive_url


def scrape_archive(page, category, archive_url, existing_ids):
    """Scrapes a section's separate archive endpoint at the real,
    per-section archive_url detected by find_archive_url() (see finding
    #11 -- never a guessed/inferred slug). Mirrors dot_watcher.py's
    scrape_archive() (built for DoT) closely, since finding #3 confirms
    this is the same real URL pattern and finding #1 confirms the same
    card markup -- but reimplemented against this file's own
    extract_cards() rather than reusing dot_watcher.py's function
    directly (which assumes DD.MM.YYYY dates -- see finding #10)."""
    rows = []
    blocked = []
    url = archive_url

    try:
        dw.goto_and_check_blocked(page, url, label=f"{category} archive")
    except dw.BlockedError as e:
        print(f"!!! {category} archive: {e}")
        blocked.append({"category": category, "archive_page": 1, "url": url})
        return rows, blocked

    page.wait_for_load_state("domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3500)
    dw.force_english(page)

    current_page_num = 1
    while True:
        if current_page_num > MAX_PAGES_PER_SECTION:
            print(f"!!! Hit MAX_PAGES_PER_SECTION on {category} archive -- stopping defensively")
            break

        ctx = dw.find_ctx(page)
        if not ctx:
            print(f"No content context on {category} archive page {current_page_num} -- stopping")
            break

        cards = extract_cards(ctx)
        print(f"{category} archive page {current_page_num}: {len(cards)} cards found")
        if not cards:
            break

        first_title_before = cards[0]["title"] if cards else None

        for card in cards:
            if card["is_group"]:
                print(f"  expanding grouped archive card: {card['title'][:60]}")
                try:
                    sub_rows = expand_group_page(page.context, card["pdf_link"], category, card["title"])
                except dw.BlockedError as e:
                    print(f"    !!! BLOCKED expanding grouped archive card: {card['title'][:60]} -- {e}")
                    blocked.append({"category": category, "topic_title": card["title"], "url": card["pdf_link"]})
                    continue
                for sub in sub_rows:
                    row_id = dw.make_id(sub["pdf_link"])
                    if row_id in existing_ids:
                        continue
                    rows.append({
                        "id": row_id,
                        "title": sub["title"],
                        "pdf_link": sub["pdf_link"],
                        "source_page": card["pdf_link"],
                        "category": category,
                        "is_archived": True,
                        "published_year": sub["published_year"],
                        "scraped_at": now_iso(),
                    })
                continue

            if not is_real_file(card["pdf_link"]):
                continue
            row_id = dw.make_id(card["pdf_link"])
            if row_id in existing_ids:
                continue
            rows.append({
                "id": row_id,
                "title": card["title"],
                "pdf_link": card["pdf_link"],
                "source_page": url,
                "category": category,
                "is_archived": True,
                "published_year": card["published_year"],
                "scraped_at": now_iso(),
            })

        if not click_next_page(page):
            print(f"No enabled 'next' button -- assuming end of {category} archive ({current_page_num} page(s) total)")
            break

        page.wait_for_timeout(2500)

        ctx_after = dw.find_ctx(page)
        after_cards = extract_cards(ctx_after) if ctx_after else []
        first_title_after = after_cards[0]["title"] if after_cards else None

        if first_title_after == first_title_before:
            print(f"Clicking 'next' didn't change content -- stopping {category} archive")
            break

        current_page_num += 1

    return rows, blocked


def append_to_master(rows):
    exists = os.path.exists(MASTER_CSV)
    with open(MASTER_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


def write_new_entries(rows):
    with open(NEW_JSON, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sections",
        nargs="*",
        default=None,
        help="Optional: limit to specific section names (e.g. --sections REPORTS) for a small test run.",
    )
    parser.add_argument(
        "--skip-archives",
        action="store_true",
        help="Skip the separate /archives?page= endpoint -- for a minimal first test of the live listing only.",
    )
    args = parser.parse_args()

    ensure_dirs()
    existing_ids = load_existing_ids()
    print(f"Loaded {len(existing_ids)} existing records")

    sections_to_run = SECTIONS
    if args.sections:
        sections_to_run = [s for s in SECTIONS if s[0] in args.sections]

    all_new_rows = []
    all_blocked = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--window-position=-2000,-2000", "--window-size=1400,900"],
        )
        context = browser.new_context(
            viewport=dw.VIEWPORT,
            extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
        )
        page = context.new_page()

        for category, listing_url in sections_to_run:
            print(f"\n========== {category} (listing) ==========")
            rows, blocked, archive_url = scrape_listing(page, category, listing_url, existing_ids)
            print(f"-> {len(rows)} new rows from listing")
            all_new_rows.extend(rows)
            all_blocked.extend(blocked)
            page.wait_for_timeout(5000)  # same inter-section cooldown as dot_watcher.py

            if not args.skip_archives and archive_url:
                print(f"\n========== {category} (archive) ==========")
                arows, ablocked = scrape_archive(page, category, archive_url, existing_ids)
                print(f"-> {len(arows)} new rows from archive")
                all_new_rows.extend(arows)
                all_blocked.extend(ablocked)
                page.wait_for_timeout(5000)

        browser.close()

    print("\n====================")
    print("New entries:", len(all_new_rows))

    if all_blocked:
        print("\n" + "=" * 60)
        print(f"!!! {len(all_blocked)} section(s)/page(s) were BLOCKED (403 Access Denied)")
        print("!!! These were NOT scraped as genuinely empty -- do NOT assume 0 real documents.")
        for b in all_blocked:
            print(f"  - {b}")
        print("=" * 60)

    if all_new_rows:
        append_to_master(all_new_rows)
    write_new_entries(all_new_rows)
    print("CSV + JSON updated")


if __name__ == "__main__":
    main()
