from playwright.sync_api import sync_playwright
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
import argparse
import os
import hashlib
import csv
import json
import re
import time


# ================= CONFIG =================

DATA_DIR = Path("dot")
CSV_FILE = DATA_DIR / "dot_master.csv"
JSON_FILE = DATA_DIR / "dot_new.json"

SECTIONS = [
    ("ORDERS_AND_NOTICES", "https://www.dot.gov.in/documents/orders-and-notices?page=", True),
    ("REPORTS", "https://www.dot.gov.in/documents?page=", True),
    ("ACTS_AND_POLICIES", "https://www.dot.gov.in/documents/acts-and-policies?page=", True),
    ("PUBLICATIONS", "https://www.dot.gov.in/documents/publications?page=", True),
    ("PRESS_RELEASE", "https://www.dot.gov.in/documents/press-release?page=", True),
    ("GUIDELINES", "https://www.dot.gov.in/documents/guidelines?page=", True),
    ("GAZETTES_NOTIFICATIONS", "https://www.dot.gov.in/documents/gazettes-notifications?page=", False),
]

VIEWPORT = {"width": 1400, "height": 900}


# ================= HELPERS =================

def normalize_date(s):
    # Confirmed via a real ingestion run (2026-07-28): expand_detail_page()'s
    # topic-page sub-documents render dates as DD/MM/YYYY (slash-separated),
    # which neither of the original two formats matched — 228 of 581
    # documents (39%) fell through to the raw, unconverted string as a
    # result. Added as a third fallback, tried last (after the two
    # unambiguous dot/dash formats) since slash dates are ambiguous with
    # MM/DD/YYYY for day<=12 — dot_adapter.py's _parse_date tries MM/DD/YYYY
    # first for the same reason, to stay consistent with this function's
    # established output convention.
    for fmt in ("%d.%m.%Y", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%m/%d/%Y")
        except:
            pass
    return s or ""


def extract_year(s):
    m = re.search(r"(20\d{2})", s or "")
    return int(m.group(1)) if m else None


def make_id(pdf_url):
    return hashlib.sha1(pdf_url.encode()).hexdigest()[:16]


REAL_FILE_EXTENSIONS = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv")


def is_real_file_url(url):
    """Confirmed via live investigation (2026-07-28): every real DoT-hosted
    file lives under /static/uploads/... with a real extension. Anything
    else under /documents/... that LOOKS like a document link is actually
    a topic-aggregator or single-item detail page (JS-rendered, no file at
    all) — see is_dot_detail_page() and expand_detail_page()."""
    if not url:
        return False
    path = urlparse(url).path.lower()
    return "/static/uploads/" in path and path.endswith(REAL_FILE_EXTENSIONS)


def is_dot_detail_page(url):
    """A dot.gov.in /documents/... page that isn't a real file — needs
    expansion (see expand_detail_page()). Deliberately excludes links to
    OTHER government sites (e.g. egazette.gov.in, pib.gov.in) — those
    don't share this site's markup, so they're left as a single row with
    the external link as pdf_url rather than attempting to scrape a
    different site's structure."""
    return url.startswith("https://www.dot.gov.in/documents/") and not is_real_file_url(url)


# Confirmed LIVE (2026-07-29): dot.gov.in's Akamai edge WAF returns HTTP 403
# with page title "Access Denied" and body text starting "Access Denied /
# You don't have permission to access ..." when it decides to block a
# request. This page has ZERO div.announcementbox elements, exactly like a
# page that's still loading or a genuinely empty section — so without an
# explicit check, scrape_section()/expand_detail_page()'s existing
# find_ctx()-based "no content" detection cannot tell a WAF block apart
# from real empty content. Suspected (not yet confirmed — the site was
# still actively blocking requests as of this investigation) to be why the
# GUIDELINES section recorded 0 of 581 documents with no distinctive log.
#
# Also confirmed live: this block can outlast RETRY_PAUSES_MS's longest
# interval (60s) — a real retry after a full 65s wait still returned 403.
# BLOCKED_RETRY_PAUSES_MS is deliberately longer, but still bounded (not
# indefinite), so one blocked section/topic page can't stall an entire
# multi-hour backlog run.
BLOCKED_RETRY_PAUSES_MS = [60000, 180000]  # 1 min, then 3 min


class BlockedError(Exception):
    """Raised when a page load hit dot.gov.in's WAF/edge block (403 Access
    Denied) after exhausting BLOCKED_RETRY_PAUSES_MS. Callers MUST NOT
    treat this the same as "no content found" (a genuinely empty section
    or topic page) — see is_blocked_response() and the module notes above
    on the GUIDELINES section investigation (2026-07-29)."""

    pass


def is_blocked_response(resp, page):
    """True if this navigation hit dot.gov.in's WAF/edge block page rather
    than genuine site content (whether that content turns out to have
    real documents on it or be a genuinely empty section). Checked BEFORE
    the div.announcementbox check in scrape_section()/expand_detail_page()
    — an Access-Denied page has zero announcementbox divs too, so without
    this check a block is silently indistinguishable from a real empty
    result. Checks HTTP status first (cheapest, most reliable), then falls
    back to title/body text in case a caching layer preserves a 200 status
    on the block page itself."""
    try:
        if resp is not None and resp.status == 403:
            return True
    except Exception:
        pass
    try:
        if "access denied" in (page.title() or "").lower():
            return True
    except Exception:
        pass
    try:
        if "access denied" in (page.inner_text("body") or "")[:200].lower():
            return True
    except Exception:
        pass
    return False


def goto_and_check_blocked(page, url, label):
    """Navigate to url, retrying with BLOCKED_RETRY_PAUSES_MS if
    dot.gov.in's WAF blocks the request (see is_blocked_response()).
    Raises BlockedError if still blocked after exhausting the backoff
    sequence — callers must catch this SEPARATELY from a generic
    Exception and must NOT fall back to "no content"/single-row behavior
    for it. Returns normally (page left loaded on url) otherwise; callers
    still do their own wait_for_load_state/force_english/find_ctx calls
    after this, exactly as before this function existed — this only
    isolates the block-detection + backoff, not the full load sequence."""
    resp = page.goto(url, timeout=90000)
    page.wait_for_timeout(1500)
    if not is_blocked_response(resp, page):
        return

    print(f"  !!! BLOCKED (403 Access Denied) loading {label} -- {url}")
    for attempt, pause_ms in enumerate(BLOCKED_RETRY_PAUSES_MS, start=1):
        print(
            f"  !!! backing off {pause_ms // 1000}s before retry "
            f"{attempt}/{len(BLOCKED_RETRY_PAUSES_MS)} (blocked, NOT treating as empty)"
        )
        page.wait_for_timeout(pause_ms)
        resp = page.goto(url, timeout=90000)
        page.wait_for_timeout(1500)
        if not is_blocked_response(resp, page):
            print(f"  !!! block cleared for {label} after retry {attempt}")
            return

    raise BlockedError(
        f"Still blocked (403 Access Denied) after {len(BLOCKED_RETRY_PAUSES_MS)} retries: {url}"
    )


def find_ctx(page, timeout=70000):
    """Find frame/page where announcement cards render"""
    start = time.time()

    while (time.time() - start) * 1000 < timeout:
        for ctx in [page] + page.frames:
            try:
                if ctx.query_selector("div.announcementbox"):
                    return ctx
            except:
                pass
        page.wait_for_timeout(1000)

    return None

def force_english(page):
    try:
        # click translate dropdown button
        page.locator("button.bhashini-dropdown-btn").click(timeout=5000)

        # wait for dropdown
        page.wait_for_selector("li.language-option[data-value='en']", timeout=5000)

        # click English
        page.locator("li.language-option[data-value='en']").click()

        # wait for translation to apply
        page.wait_for_timeout(2000)

        print("🌐 Language set to English")

    except Exception as e:
        print("Language switch skipped:", e)
        
# ================= SCRAPER =================

def expand_detail_page(context, url, category, mode="backlog", existing_ids=None):
    """Visit a dot.gov.in topic/detail page and extract every real
    sub-document found there, e.g. "3G & BWA Spectrum Auction" (one
    listing row) actually hides 29 separate historical PDFs going back to
    2010; "Blocking Notifications..." hides 13.

    Confirmed via live investigation (2026-07-28): these pages reuse the
    EXACT same announcementbox card markup as the main listing pages (same
    p.mb-0/small.ptype/a.download-btn selectors), and do NOT paginate —
    ?page=N has no effect, every sub-document renders on the one page
    load, even for 29 items. Also confirmed: cards render newest-first
    (matches the page's own default "Sort by: Latest").

    mode="backlog" (the default, used for the current one-time full
    scrape) processes every card — these are historical archives by
    nature, and the whole point of a backlog run is to capture the full
    archive, not truncate it.

    mode="daily" is for once this goes on a recurring schedule: re-visiting
    e.g. the 3G & BWA Spectrum Auction page (29 items, mostly from 2010-2014)
    in full every single day would be pointless — nothing there changes.
    In this mode, existing_ids (the same set load_existing_ids() already
    produces) is checked per-card, and expansion stops at the FIRST card
    whose id is already known. This relies on the newest-first ordering
    confirmed above: once we hit a document we've already captured,
    everything after it is also already known. This is a more reliable
    signal than a year cutoff would be — a topic page could get a new
    document backfilled with an OLD date (the "Blocking Notifications...
    (older than 2025)" entries are a real example of exactly that pattern
    elsewhere in this same site), which a pure "year >= current year"
    check would wrongly skip. Checking actual known ids has no such
    blind spot. Still visits the page once per day per topic — closing
    that cost entirely would need a persisted cache of already-expanded
    topic URLs plus some reliable "has this changed" signal, which hasn't
    been investigated yet (see the docstring note in main()).

    If zero real sub-documents are found (e.g. "National Telecom Policy,
    1994", which has no PDF at all — its full text is just rendered as
    page HTML), returns an empty list. That specific case (capturing the
    page's own HTML text as content) is a real gap this doesn't close —
    the caller falls back to the old single-row behavior so the document
    isn't silently dropped, but its content still won't be a downloadable
    file. Flagged as a follow-up, not solved here.

    Raises BlockedError if the page load hit dot.gov.in's WAF block (see
    goto_and_check_blocked()) — this is NOT the same as the "zero real
    sub-documents" case above and callers must not treat it that way:
    confirmed live (2026-07-29) that "Phones Priority (PHP) Telephone
    Advisory Committee (TACs)" actually hides 21 real documents, so a
    blocked load here must never be silently recorded as "nothing to
    expand."
    """
    page = context.new_page()
    try:
        goto_and_check_blocked(page, url, label=f"topic page [{category}] {url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(3000)
        force_english(page)

        ctx = find_ctx(page, timeout=20000)
        if not ctx:
            return []

        cards = ctx.query_selector_all("div.announcementbox")
        rows = []

        for c in cards:
            try:
                title = c.query_selector("p.mb-0").inner_text().strip()
                date_el = c.query_selector("small.ptype")
                date_raw = date_el.inner_text().strip() if date_el else ""
                pdf_el = c.query_selector("a.download-btn")
                pdf = pdf_el.get_attribute("href") if pdf_el else ""
            except:
                continue

            if not pdf:
                continue
            if pdf.startswith("/"):
                pdf = "https://www.dot.gov.in" + pdf
            if not is_real_file_url(pdf):
                # a sub-item that ITSELF isn't a real file — not observed
                # in practice, but skip rather than recurse indefinitely
                continue

            row_id = make_id(pdf)

            if mode == "daily" and existing_ids is not None and row_id in existing_ids:
                # newest-first ordering means everything from here on is
                # also already known — stop expanding this topic page
                break

            rows.append({
                "id": row_id,
                "title": title,
                "publish_date": normalize_date(date_raw),
                "pdf_url": pdf,
                "category": category,
                "scraped_at": datetime.utcnow().strftime("%m/%d/%Y"),
            })

        return rows
    finally:
        page.close()


# Hard safety cap on pagination, independent of any particular failure
# mode. Confirmed via a real crash (2026-07-28): requesting an
# out-of-range page number for a section doesn't return empty results —
# it silently wraps back around to page 1's content. Since year_stop only
# triggers on an actually-old-dated card, and page 1 is never old, this
# caused an infinite loop (repeatedly re-expanding the same topic pages)
# until a random Playwright timeout eventually crashed the whole
# multi-hour scrape with zero progress saved. The first-card-repeat check
# below is the real fix for that specific quirk; this cap is a backstop
# against any other cause of the same symptom.
MAX_PAGES_PER_SECTION = 200


# ================= ARCHIVE (separate endpoint, per section) =================
#
# Discovered live (2026-07-29) via manual "View Archive" button inspection --
# the same category of gap MTCTE had (a separate archive endpoint distinct
# from the live listing), except here nobody knew the button existed until
# it was found by hand, since dot.gov.in was actively blocking automated
# requests throughout this investigation. Confirmed present on every section
# EXCEPT PRESS_RELEASE and GUIDELINES (2026-07-29 live check).
#
# URL pattern: https://www.dot.gov.in/archives?page={slug} -- one real
# anchor confirmed live: <a class="...archivemr..."
# href="/archives?page=orders-and-notices">, so `page` here is a SECTION
# SLUG, not a page number (a different use of that query key than the
# landing pages' own ?page=N convention -- do not confuse the two).
#
# Card markup: confirmed live to reuse the EXACT same structure as the
# landing pages (div.announcementbox / p.mb-0 / small.ptype /
# a.download-btn) -- same extraction logic as scrape_section() applies.
#
# Pagination: CONFIRMED CLIENT-SIDE, not URL-based (2026-07-29, manual
# inspection) -- page 2 of the REPORTS archive sits at the exact same URL
# as page 1 (https://www.dot.gov.in/archives?page=reports). Advancing
# pages means clicking a <span class="page-link pointer">N</span> inside
# <li class="page-item">, not navigating to a new address. This mirrors
# MTCTE's DataTables-style client-side archive pagination (see
# mtcte_watcher.py's fetch_archive_section()), NOT scrape_section()'s own
# page_no-in-URL loop -- a URL-based approach here would have silently
# re-read page 1 forever. Real scope confirmed for REPORTS specifically:
# 10 docs/page, 8 pages, last page has 7 -> 77 total documents.
ARCHIVE_SLUGS = {
    "ORDERS_AND_NOTICES": "orders-and-notices",  # confirmed live via the real "View Archive" href
    "REPORTS": "reports",  # confirmed live via the real "View Archive" href (2026-07-29) --
                            # REPORTS' own landing URL has no path segment to infer this from
    "ACTS_AND_POLICIES": "acts-and-policies",  # inferred from its landing URL's own path segment,
                                                 # matching the confirmed ORDERS_AND_NOTICES/REPORTS
                                                 # pattern exactly -- NOT independently live-checked
    "PUBLICATIONS": "publications",  # inferred, not live-checked -- see ACTS_AND_POLICIES note
    "GAZETTES_NOTIFICATIONS": "gazettes-notifications",  # inferred, not live-checked
    # PRESS_RELEASE and GUIDELINES deliberately absent: confirmed live
    # (2026-07-29) to have NO "View Archive" link at all.
}

ARCHIVE_BASE_URL = "https://www.dot.gov.in/archives?page="


def scrape_archive(page, category, mode="backlog", existing_ids=None, max_pages=None):
    """Scrapes a section's separate /archives?page={slug} endpoint. See the
    module notes above for the real, live-confirmed URL/pagination/markup
    facts this is built from -- nothing here is guessed.

    max_pages: caps how many archive pages are visited, for a small sample
    run before committing to a full pull (e.g. max_pages=1 for a first-page
    sanity check). None (default) means no cap beyond MAX_PAGES_PER_SECTION.
    """
    slug = ARCHIVE_SLUGS.get(category)
    if not slug:
        raise ValueError(f"No known archive slug for category {category!r}")

    url = f"{ARCHIVE_BASE_URL}{slug}"
    rows = []
    blocked = []

    try:
        goto_and_check_blocked(page, url, label=f"{category} archive")
    except BlockedError as e:
        print(f"!!! {category} archive: {e}")
        print(f"!!! Archive for {category} ABORTED as BLOCKED (403 Access Denied), NOT genuinely empty")
        blocked.append({"category": category, "archive_page": 1, "url": url})
        return rows, blocked

    page.wait_for_load_state("domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3500)
    force_english(page)

    current_page_num = 1
    while True:
        if current_page_num > MAX_PAGES_PER_SECTION:
            print(f"!!! Hit MAX_PAGES_PER_SECTION on {category} archive -- stopping defensively")
            break

        ctx = find_ctx(page)
        if not ctx:
            print(f"No content context on {category} archive page {current_page_num} -- stopping")
            break

        cards = ctx.query_selector_all("div.announcementbox")
        print(f"{category} archive page {current_page_num}: {len(cards)} cards found")
        if not cards:
            break

        try:
            first_title_before = cards[0].query_selector("p.mb-0").inner_text().strip()
        except Exception:
            first_title_before = None

        for c in cards:
            try:
                title = c.query_selector("p.mb-0").inner_text().strip()
                date_el = c.query_selector("small.ptype")
                date_raw = date_el.inner_text().strip() if date_el else ""
                pdf_el = c.query_selector("a.download-btn")
                pdf = pdf_el.get_attribute("href") if pdf_el else ""
            except Exception:
                continue

            if not pdf:
                continue
            if pdf.startswith("/"):
                pdf = "https://www.dot.gov.in" + pdf

            if is_real_file_url(pdf):
                row_id = make_id(pdf)
                if mode == "daily" and existing_ids is not None and row_id in existing_ids:
                    continue
                rows.append({
                    "id": row_id,
                    "title": title,
                    "publish_date": normalize_date(date_raw),
                    "pdf_url": pdf,
                    "category": category,
                    "scraped_at": datetime.utcnow().strftime("%m/%d/%Y"),
                })

            elif is_dot_detail_page(pdf):
                # Grouped/aggregated archive card -- confirmed live
                # (2026-07-29): e.g. "Annual Report 2024-25" with a
                # counter-box showing "3", linking to
                # /documents/reports/annual-report-2024-25-...?archives=true
                # instead of a real file. In the one observed case its 3
                # sub-documents were ALSO already present as separate
                # real-file cards elsewhere on the same archive page, but
                # nothing guarantees that holds for every grouped card on
                # every page -- the same "one listing row hides many real
                # documents" pattern already confirmed on the main listing
                # pages (PHP TACs). Expanding here too, via the SAME
                # expand_detail_page() scrape_section() already uses,
                # rather than assuming redundancy. Exact-URL dedup
                # downstream (main()'s seen_this_run/existing_ids) harmlessly
                # collapses the case where this WAS already redundant.
                print(f"  expanding grouped archive card: {title[:60]}")
                try:
                    sub_rows = expand_detail_page(
                        page.context, pdf, category, mode=mode, existing_ids=existing_ids
                    )
                except BlockedError as e:
                    print(f"    !!! BLOCKED expanding grouped archive card: {title[:60]} -- {e}")
                    blocked.append({"category": category, "topic_title": title, "url": pdf})
                    sub_rows = []
                except Exception as e:
                    print(f"    !! expansion failed ({e}) -- skipping (its items may already be listed individually on this page)")
                    sub_rows = []
                if sub_rows:
                    print(f"    -> {len(sub_rows)} sub-document(s) found")
                    rows.extend(sub_rows)

            # else: external link -- not observed on archive pages so far,
            # skip silently like before.

        if max_pages is not None and current_page_num >= max_pages:
            print(f"Hit max_pages={max_pages} cap for {category} archive -- stopping (sample run)")
            break

        # Advance via the CLIENT-SIDE pagination control -- confirmed live
        # (2026-07-29): the URL never changes, so there is no "goto the
        # next URL" step here, unlike scrape_section().
        next_page_num = current_page_num + 1
        next_link = page.query_selector(f"li.page-item span.page-link:text-is('{next_page_num}')")
        if not next_link:
            print(f"No page-link for page {next_page_num} -- assuming end of {category} archive ({current_page_num} page(s) total)")
            break

        try:
            next_link.click(timeout=5000)
        except Exception as e:
            print(f"Could not click page {next_page_num} link ({e}) -- stopping {category} archive")
            break

        page.wait_for_timeout(2500)

        # Defensive check against a click that silently didn't change
        # content -- same failure class already guarded against elsewhere
        # in this file (the out-of-range-page-wraps-to-page-1 quirk).
        ctx_after = find_ctx(page)
        after_cards = ctx_after.query_selector_all("div.announcementbox") if ctx_after else []
        try:
            first_title_after = after_cards[0].query_selector("p.mb-0").inner_text().strip() if after_cards else None
        except Exception:
            first_title_after = None

        if first_title_after == first_title_before:
            print(f"Clicking page {next_page_num} didn't change content -- stopping {category} archive")
            break

        current_page_num = next_page_num

    return rows, blocked


def scrape_section(page, category, base_url, year_stop, mode="backlog", existing_ids=None):

    rows = []
    blocked = []  # entries: {"category", "page"/"topic_title", "url"} — see
                  # BlockedError. Distinct from "genuinely empty" — a
                  # blocked page/section must NEVER be silently recorded as
                  # 0 real documents (see GUIDELINES section investigation,
                  # 2026-07-29).
    page_no = 1
    first_card_titles_seen = set()

    print(f"\n========== {category} ==========")

    while True:

        if page_no > MAX_PAGES_PER_SECTION:
            print(f"⚠️ Hit MAX_PAGES_PER_SECTION ({MAX_PAGES_PER_SECTION}) — stopping defensively")
            break

        url = base_url + str(page_no)
        print("Opening:", url)

        try:
            goto_and_check_blocked(page, url, label=f"{category} page {page_no}")
        except BlockedError as e:
            print(f"!!! {category} page {page_no}: {e}")
            print(
                f"!!! Section {category} ABORTED as BLOCKED (403 Access Denied), "
                f"NOT genuinely empty — needs a manual retry later, not silently 0 rows"
            )
            blocked.append({"category": category, "page": page_no, "url": url})
            break

        page.wait_for_load_state("domcontentloaded")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(3500)
        force_english(page)

        ctx = find_ctx(page)

        # Confirmed via real runs (2026-07-28): after a burst of extra
        # page loads from expand_detail_page(), the site can stop
        # rendering content entirely for a while — not just for one page.
        # One retry after 15s wasn't always enough (REPORTS and
        # ACTS_AND_POLICIES both still failed on the first retry in one
        # run, while PUBLICATIONS recovered) — so this backs off further
        # across up to 3 attempts before concluding "no more content".
        # Treating a transient block as genuine end-of-listing would
        # silently drop real, entire sections' worth of content.
        #
        # NOTE: this loop handles the "still loading, no cards yet" case
        # ONLY. A confirmed 403/Access-Denied block (see
        # goto_and_check_blocked()) is handled separately below with its
        # own, longer backoff — conflating the two here would mean a WAF
        # block only ever gets RETRY_PAUSES_MS's 60s max before being
        # silently written off as "no more content" (suspected root cause
        # of the GUIDELINES section's 0-of-581 result).
        RETRY_PAUSES_MS = [15000, 30000, 60000]
        section_blocked = False
        for attempt, pause_ms in enumerate(RETRY_PAUSES_MS, start=1):
            if ctx:
                break
            print(f"No content context — pausing {pause_ms // 1000}s and retrying (attempt {attempt}/{len(RETRY_PAUSES_MS)})")
            page.wait_for_timeout(pause_ms)
            try:
                goto_and_check_blocked(page, url, label=f"{category} page {page_no} (retry {attempt})")
            except BlockedError as e:
                print(f"!!! {category} page {page_no}: {e}")
                print(
                    f"!!! Section {category} ABORTED as BLOCKED (403 Access Denied), "
                    f"NOT genuinely empty — needs a manual retry later, not silently 0 rows"
                )
                blocked.append({"category": category, "page": page_no, "url": url})
                section_blocked = True
                break
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(3500)
            force_english(page)
            ctx = find_ctx(page)

        if section_blocked:
            break

        if not ctx:
            print("No content context after all retries — stop section")
            break

        cards = ctx.query_selector_all("div.announcementbox")
        print("Cards found:", len(cards))

        if not cards:
            break

        # Detect the "out-of-range page wraps back to page 1" quirk: if
        # this page's first card title matches one we've already seen on
        # an earlier page_no in this same section, we've looped — stop
        # rather than re-processing (and re-expanding) the same cards
        # forever.
        try:
            first_title = cards[0].query_selector("p.mb-0").inner_text().strip()
        except:
            first_title = None
        if first_title and first_title in first_card_titles_seen:
            print(f"⚠️ Page {page_no} repeats an earlier page's content ('{first_title[:60]}') — stopping section")
            break
        if first_title:
            first_card_titles_seen.add(first_title)

        for c in cards:

            try:
                title = c.query_selector("p.mb-0").inner_text().strip()

                date_el = c.query_selector("small.ptype")
                date_raw = date_el.inner_text().strip() if date_el else ""

                pdf_el = c.query_selector("a.download-btn")
                pdf = pdf_el.get_attribute("href") if pdf_el else ""

            except:
                continue

            if not pdf:
                continue

            # ensure absolute URL
            if pdf.startswith("/"):
                pdf = "https://www.dot.gov.in" + pdf

            if year_stop and date_raw:
                y = extract_year(date_raw)
                if y and y < 2026:
                    print("🛑 Hit 2025 — stop section")
                    return rows, blocked

            if is_real_file_url(pdf):
                row = {
                    "id": make_id(pdf),
                    "title": title,
                    "publish_date": normalize_date(date_raw),
                    "pdf_url": pdf,
                    "category": category,
                    "scraped_at": datetime.utcnow().strftime("%m/%d/%Y"),
                }
                rows.append(row)
                print("✓", title[:80])

            elif is_dot_detail_page(pdf):
                print("  expanding topic/detail page:", title[:60])
                try:
                    sub_rows = expand_detail_page(
                        page.context, pdf, category, mode=mode, existing_ids=existing_ids
                    )
                except BlockedError as e:
                    # Confirmed live (2026-07-29): "Phones Priority (PHP)
                    # Telephone Advisory Committee (TACs)" hides 21 real
                    # documents. A blocked expansion is NOT "nothing to
                    # expand" and must not fall back to a single row that
                    # would misrepresent it as such — record it as
                    # blocked/needs-retry and skip emitting any row for
                    # this card for now, rather than writing a wrong
                    # placeholder that looks identical to a correctly-
                    # resolved single-item topic page.
                    print(f"    !!! BLOCKED (403 Access Denied) expanding topic page: {title[:60]} -- {e}")
                    print(f"    !!! NOT falling back to a single row -- marking as blocked, needs retry")
                    blocked.append({"category": category, "topic_title": title, "url": pdf})
                    page.wait_for_timeout(2000)
                    continue
                except Exception as e:
                    # A single flaky topic page (e.g. a Playwright timeout
                    # on a slow load) must not kill an entire multi-hour
                    # scrape — confirmed via a real crash (2026-07-28).
                    # Fall back to the single-row behavior for this one
                    # topic and keep going; it can be re-expanded on a
                    # future run.
                    print(f"    !! expansion failed ({e}) — falling back to single row")
                    sub_rows = []
                print(f"    -> {len(sub_rows)} real sub-document(s) found")
                # Throttle: a burst of extra page loads from expansion is
                # the likely trigger for the site-wide content-stopped-
                # rendering issue seen in a real run (2026-07-28). This
                # won't eliminate that risk, but reduces the request rate
                # that plausibly caused it.
                page.wait_for_timeout(2000)
                if sub_rows:
                    rows.extend(sub_rows)
                else:
                    # no real files behind it (e.g. HTML-only content like
                    # "National Telecom Policy, 1994") — fall back to the
                    # old single-row behavior rather than silently
                    # dropping the document entirely
                    rows.append({
                        "id": make_id(pdf),
                        "title": title,
                        "publish_date": normalize_date(date_raw),
                        "pdf_url": pdf,
                        "category": category,
                        "scraped_at": datetime.utcnow().strftime("%m/%d/%Y"),
                    })

            else:
                # external-site link (e.g. egazette.gov.in, pib.gov.in) —
                # can't reliably expand a different government site's
                # markup, so keep the old single-row fallback rather than
                # dropping it
                row = {
                    "id": make_id(pdf),
                    "title": title,
                    "publish_date": normalize_date(date_raw),
                    "pdf_url": pdf,
                    "category": category,
                    "scraped_at": datetime.utcnow().strftime("%m/%d/%Y"),
                }
                rows.append(row)
                print("✓ (external link, not expandable)", title[:60])

        page_no += 1

    return rows, blocked


# ================= CSV / JSON =================

def ensure_csv():
    DATA_DIR.mkdir(exist_ok=True)

    if not CSV_FILE.exists():
        with CSV_FILE.open("w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow([
                "id",
                "title",
                "publish_date",
                "pdf_url",
                "category",
                "scraped_at",
            ])


def load_existing_ids():
    if not CSV_FILE.exists():
        return set()

    # encoding="utf-8" is required here — ensure_csv()/append_csv() both
    # write utf-8 explicitly, but without specifying it on read too,
    # Windows' default locale encoding (cp1252) is used instead, which
    # can't decode real title text (em-dashes, curly quotes, etc.) and
    # raises UnicodeDecodeError. Confirmed via a real run (2026-07-28):
    # every prior full re-scrape wiped dot_master.csv first, so this
    # never got exercised against a real populated file until an
    # incremental (non-wipe) run hit it — which is exactly the situation
    # every future "daily" mode run will be in.
    with CSV_FILE.open(encoding="utf-8") as f:
        return {r["id"] for r in csv.DictReader(f)}


def append_csv(rows):
    with CSV_FILE.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        for r in rows:
            w.writerow([
                r["id"],
                r["title"],
                r["publish_date"],
                r["pdf_url"],
                r["category"],
                r["scraped_at"],
            ])


# ================= MAIN =================

def main():
    # NOTE (2026-07-28): --mode only controls expand_detail_page()'s
    # per-topic-page behavior (see its docstring). It does NOT yet avoid
    # the page visit itself for topics that haven't changed — that would
    # need a persisted cache of already-expanded topic URLs plus a
    # reliable "has this changed" signal (e.g. a Last-Modified header, if
    # this JS-rendered site even exposes one accurately — not
    # investigated). Worth doing before this runs daily against a site
    # with 40-50+ topic pages, but --mode daily is still a real
    # improvement on its own: it stops processing each topic page's cards
    # at the first already-known id instead of parsing all of them (e.g.
    # all 29 for 3G & BWA Spectrum Auction) every single day.
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=["backlog", "daily"],
        default=None,
        help="backlog (default when run by hand): expand every topic page in "
             "full. daily (default under the sync): stop expanding a topic "
             "page once its newest-first cards reach an already-known document.",
    )
    args = parser.parse_args()

    ensure_csv()
    existing_ids = load_existing_ids()

    # Under lib/sync.ts, SYNC_KNOWN_SOURCE_IDS_FILE names every DoT
    # source_id already in Postgres -- the same sha1(pdf_url)[:16] as
    # make_id(), so they are directly comparable. They count as known, and
    # the run defaults to daily mode. On CI the master CSV is gitignored and
    # never exists, so without this every scheduled run was a full backlog
    # crawl: over an hour from a clean state on 2026-09-24, against the
    # sync's 45-minute scrape timeout.
    known_file = os.environ.get("SYNC_KNOWN_SOURCE_IDS_FILE")
    if known_file:
        with open(known_file, encoding="utf-8") as f:
            existing_ids |= set(json.load(f))
        print(f"{len(existing_ids)} ids known (master CSV + wiki database)")
    if args.mode is None:
        args.mode = "daily" if known_file else "backlog"
    print(f"Mode: {args.mode}")

    scraped = []
    blocked = []

    with sync_playwright() as p:

        # headful but hidden off-screen
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--window-position=-2000,-2000",
                "--window-size=1400,900",
            ]
        )

        # ONLY ADDITION: English Accept-Language header
        context = browser.new_context(
            viewport=VIEWPORT,
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9"
            }
        )

        page = context.new_page()

        for category, base, year_stop in SECTIONS:
            section_rows, section_blocked = scrape_section(
                page, category, base, year_stop,
                mode=args.mode, existing_ids=existing_ids,
            )
            scraped.extend(section_rows)
            blocked.extend(section_blocked)
            # Cheap insurance against carrying a throttled/degraded state
            # from a heavy section (e.g. ORDERS_AND_NOTICES, with many
            # topic-page expansions) into the next section's first page
            # load — confirmed necessary via a real run (2026-07-28) where
            # REPORTS and ACTS_AND_POLICIES both came back empty
            # immediately after it.
            page.wait_for_timeout(5000)

        browser.close()

    # ---------- dedupe vs master ----------

    # Dedupe within THIS run's own results too, not just against ids that
    # existed before it started. Confirmed via a real run (2026-07-28):
    # the same real document can get captured more than once within a
    # single run (a topic page's out-of-range pages wrapping back to page
    # 1, or the same listing rendering once in Hindi and once in English
    # after a failed language-switch) — existing_ids alone doesn't catch
    # that, since it's a fixed snapshot from before the run started, so
    # every occurrence within the run would otherwise pass the check and
    # get written as if new, leaving literal duplicate rows in the CSV.
    seen_this_run = set()
    new_rows = []
    for r in scraped:
        if r["id"] in existing_ids or r["id"] in seen_this_run:
            continue
        seen_this_run.add(r["id"])
        new_rows.append(r)

    print("\n====================")
    print("New entries:", len(new_rows))

    if blocked:
        # Deliberately a distinct, loud block from "New entries" above —
        # a blocked section/topic page must never read like a normal,
        # successful run. See GUIDELINES section investigation
        # (2026-07-29): a WAF block silently recorded as 0 documents is
        # indistinguishable from a genuinely empty section unless this is
        # surfaced explicitly, every run.
        print("\n" + "=" * 60)
        print(f"!!! {len(blocked)} section(s)/topic page(s) were BLOCKED (403 Access Denied)")
        print("!!! These were NOT scraped as genuinely empty — do NOT assume 0 real documents.")
        for b in blocked:
            print(f"  - {b}")
        print("!!! Re-run once dot.gov.in stops blocking requests to get real content for these.")
        print("=" * 60)

    if new_rows:
        append_csv(new_rows)

    JSON_FILE.write_text(
        json.dumps({
            "generated_at": datetime.utcnow().isoformat(),
            "count": len(new_rows),
            "items": new_rows
        }, indent=2),
        encoding="utf-8"
    )

    print("CSV + JSON updated")


if __name__ == "__main__":
    main()

