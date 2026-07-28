from playwright.sync_api import sync_playwright
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
import argparse
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
    for fmt in ("%d.%m.%Y", "%d-%m-%Y"):
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
    """
    page = context.new_page()
    try:
        page.goto(url, timeout=90000)
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


def scrape_section(page, category, base_url, year_stop, mode="backlog", existing_ids=None):

    rows = []
    page_no = 1
    first_card_titles_seen = set()

    print(f"\n========== {category} ==========")

    while True:

        if page_no > MAX_PAGES_PER_SECTION:
            print(f"⚠️ Hit MAX_PAGES_PER_SECTION ({MAX_PAGES_PER_SECTION}) — stopping defensively")
            break

        url = base_url + str(page_no)
        print("Opening:", url)

        page.goto(url, timeout=90000)
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
        RETRY_PAUSES_MS = [15000, 30000, 60000]
        for attempt, pause_ms in enumerate(RETRY_PAUSES_MS, start=1):
            if ctx:
                break
            print(f"No content context — pausing {pause_ms // 1000}s and retrying (attempt {attempt}/{len(RETRY_PAUSES_MS)})")
            page.wait_for_timeout(pause_ms)
            page.goto(url, timeout=90000)
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(3500)
            force_english(page)
            ctx = find_ctx(page)

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
                    return rows

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

    return rows


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
        default="backlog",
        help="backlog (default): expand every topic page in full. "
             "daily: stop expanding a topic page once its newest-first "
             "cards reach an already-known document.",
    )
    args = parser.parse_args()

    ensure_csv()
    existing_ids = load_existing_ids()

    scraped = []

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
            scraped.extend(
                scrape_section(
                    page, category, base, year_stop,
                    mode=args.mode, existing_ids=existing_ids,
                )
            )
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

