#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
import logging
import re
import os
from datetime import datetime, timezone
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

# ================= CONFIG =================

BASE_URL = "https://www.mtcte.tec.gov.in/"

# PRIMARY source (confirmed 2026-07-28 via a real pressure-test pull):
# downloads?section=0 ("List of Circulars/Instructions", 151 real entries
# across 13 real categories) and section=1 ("Proforma/Formats for MTCTE",
# 4 entries) together cover ~93% of what the homepage sections show, and
# are far more complete on their own (155 vs 41 on the homepage).
ARCHIVE_SECTIONS = [
    (0, "archive_circulars_instructions"),
    (1, "archive_proforma_formats"),
]

DATA_DIR = "data"
MASTER_CSV = os.path.join(DATA_DIR, "mtcte_master.csv")
NEW_JSON = os.path.join(DATA_DIR, "mtcte_new_entries.json")

# Extra columns (site_category/status/listed_date) beyond the original
# schema capture real archive data the current mtcte_adapter.py doesn't
# read yet (it only reads title/pdf_link/source_page/source_section/
# scraped_at) — not touching the adapter, but not discarding real data
# either. Homepage-sourced rows simply leave these blank.
CSV_FIELDS = [
    "id",
    "title",
    "pdf_link",
    "pdf_filename",
    "source_page",
    "source_section",
    "site_category",
    "status",
    "listed_date",
    "scraped_at",
]

# ================= LOGGING =================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

# ================= UTIL =================

def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def slugify_title(title, max_words=8, max_chars=80):
    title = title.lower()
    title = re.sub(r"[^a-z0-9\s]", "", title)
    words = title.split()[:max_words]
    slug = "-".join(words)
    return slug[:max_chars].rstrip("-")

def generate_pdf_filename(title):
    slug = slugify_title(title)
    return f"{slug}.pdf"

def make_fragile_id(title):
    # UNCHANGED from the original scraper, deliberately: mtcte_adapter.py
    # already documents this title-slug id as fragile (two different
    # documents with similar openings can collide; a trivial title edit
    # changes the id) and independently recomputes a stable SHA1 hash
    # from title+pdf_link as the real dedup key. Fixing it here would be
    # scope creep into territory the adapter already owns and solves —
    # not touched, per instructions to leave the adapter alone.
    return re.sub(r"\W+", "_", title.lower())[:50]

# ================= LOAD EXISTING =================

def load_existing_links():
    if not os.path.exists(MASTER_CSV):
        return set()
    # encoding="utf-8" is required here. Confirmed via a real DoT run
    # (2026-07-28): Windows' default locale encoding (cp1252) can't
    # decode real scraped title text (em-dashes, curly quotes, etc.) and
    # raises UnicodeDecodeError — this exact function pattern (read
    # without explicit encoding) broke load_existing_ids() in
    # dot_watcher.py the first time it ran against a real populated CSV
    # with diverse titles, and every future incremental run would have
    # hit it. Every write path in this file already used encoding="utf-8"
    # explicitly; this read path was the one gap.
    with open(MASTER_CSV, newline="", encoding="utf-8") as f:
        return {row["pdf_link"] for row in csv.DictReader(f)}

# ================= SCRAPER: HOMEPAGE (SUPPLEMENTARY) =================

def fetch_homepage_sources(page):
    """whats_new_marquee and policy_vision_head — both SUPPLEMENTARY to
    the archive, per a real title-by-title cross-reference (2026-07-28):

    - whats_new_marquee: confirmed 100% redundant with the archive today
      (all 33 titles matched). Kept anyway as a cheap freshness/canary
      check — if this ever surfaces a pdf_link the archive scrape didn't
      also find, that's a signal something broke (a gap opened up, or a
      site change broke the archive scrape), not something to silently
      optimize away.
    - policy_vision_head: confirmed to carry real, distinct content (3 of
      8 items — including one external link to a different TEC scheme
      page — aren't in the archive at all). A genuine supplementary
      source, not just a canary.
    """
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    page.wait_for_selector("body", timeout=30000)
    html = page.content()
    soup = BeautifulSoup(html, "html.parser")

    results = []

    marquee_links = soup.select("#marquee1 ul#myNewsList li a")
    for a in marquee_links:
        href = a.get("href", "").strip()
        title = a.get_text(strip=True)
        if not href or not title:
            continue
        results.append({
            "title": title,
            "pdf_link": urljoin(BASE_URL, href),
            "source_section": "whats_new_marquee",
        })

    vision_links = soup.select("h2.visionHead a")
    for a in vision_links:
        href = a.get("href", "").strip()
        title = a.get_text(" ", strip=True)
        if not href or not title:
            continue
        # Skip dashboards / internal navigation
        if href.lower().startswith(("monitoring", "voluntary", "cab", "#")):
            continue
        results.append({
            "title": title,
            "pdf_link": urljoin(BASE_URL, href),
            "source_section": "policy_vision_head",
        })

    return results

# ================= SCRAPER: ARCHIVE (PRIMARY) =================

def fetch_archive_section(page, section_num, source_section_label):
    """downloads?section=N — a DataTables-rendered table with columns
    Category | Title | External Link/Filepath | Status | Date.

    Pagination mechanics were VERIFIED live (2026-07-28), not assumed:
      - Changing the page-length dropdown to 100 and clicking "Next" both
        trigger ZERO network requests — every row is already present from
        the single initial page load; DataTables paginates entirely
        client-side here. There is no per-page server request to
        throttle, unlike DoT's topic-aggregator expand_detail_page(),
        which really did issue a fresh navigation per topic page.
      - There is no DoT-style "out-of-range page silently wraps back to
        page 1" risk: force-clicking "Next" past the real last page was
        confirmed to produce zero content change and zero requests.
      - The "Next" button's CSS class does NOT reliably gain a
        "disabled" class at the real end on this site (confirmed: still
        just "page-link" after reaching the last page) — so real-end
        detection here is "clicking Next produced no content change",
        not a disabled-class check.
    """
    url = f"{BASE_URL}downloads?section={section_num}"
    page.goto(url, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(2000)

    try:
        page.select_option("select[name*='length'], select.form-select", "100")
        page.wait_for_timeout(1500)
    except Exception as e:
        logging.warning("could not switch %s to 100/page: %s", source_section_label, e)

    def read_current_rows():
        out = []
        for r in page.query_selector_all("table tbody tr"):
            cells = r.query_selector_all("td")
            if len(cells) < 5:
                continue
            category = cells[0].inner_text().strip()
            title = cells[1].inner_text().strip()
            link_el = cells[2].query_selector("a[href]")
            href = link_el.get_attribute("href").strip() if link_el else ""
            status = cells[3].inner_text().strip()
            listed_date = cells[4].inner_text().strip()
            out.append((category, title, href, status, listed_date))
        return out

    results = []
    seen_first_titles = set()

    while True:
        current_rows = read_current_rows()
        if not current_rows:
            break

        first_title = current_rows[0][1]
        if first_title in seen_first_titles:
            # Defense in depth — the live-verified mechanism below (compare
            # before/after a Next click) is the real guard against
            # looping, but this costs nothing extra.
            break
        seen_first_titles.add(first_title)

        for category, title, href, status, listed_date in current_rows:
            if not href or not title:
                continue
            results.append({
                "title": title,
                "pdf_link": urljoin(BASE_URL, href),
                "source_section": source_section_label,
                "site_category": category,
                "status": status,  # preserved verbatim ("Active"/"Expired") —
                                    # real signal for a future Status facet,
                                    # not stripped or normalized here
                "listed_date": listed_date,
            })

        next_btn = page.query_selector(
            "a.paginate_button.next, li.paginate_button.next a, a:has-text('Next')"
        )
        if not next_btn:
            break

        before_first_title = first_title
        try:
            next_btn.click(timeout=3000)
            page.wait_for_timeout(1000)
        except Exception:
            break

        after_rows = read_current_rows()
        after_first_title = after_rows[0][1] if after_rows else None

        if after_first_title == before_first_title:
            # Real end of pagination — confirmed live this is the actual
            # signal on this site (no disabled class appears).
            break

    return results

# ================= SAVE =================

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

# ================= MAIN =================

def main():
    ensure_dirs()

    existing_links = load_existing_links()
    logging.info("Loaded %d existing records", len(existing_links))

    logging.info("Launching browser (Playwright)")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Keyed by pdf_link, first-write-wins. Archive is scraped FIRST so
        # its richer per-row data (site_category/status/listed_date) takes
        # priority over a homepage occurrence of the exact same document —
        # scraping in the other order would let the poorer homepage
        # version silently win the dedup instead.
        collected = {}

        for section_num, label in ARCHIVE_SECTIONS:
            logging.info("Scraping archive section=%d (%s)", section_num, label)
            section_items = fetch_archive_section(page, section_num, label)
            logging.info("  -> %d rows found", len(section_items))
            for item in section_items:
                collected.setdefault(item["pdf_link"], item)

        logging.info("Opening MTCTE homepage for supplementary sources")
        for item in fetch_homepage_sources(page):
            collected.setdefault(item["pdf_link"], item)

        browser.close()

    logging.info("Total unique links collected across all sources: %d", len(collected))

    items = []
    for pdf_link, data in collected.items():
        items.append({
            "id": make_fragile_id(data["title"]),
            "title": data["title"],
            "pdf_link": pdf_link,
            "pdf_filename": generate_pdf_filename(data["title"]),
            "source_page": BASE_URL,
            "source_section": data["source_section"],
            "site_category": data.get("site_category", ""),
            "status": data.get("status", ""),
            "listed_date": data.get("listed_date", ""),
            "scraped_at": now_iso(),
        })

    new_items = [i for i in items if i["pdf_link"] not in existing_links]

    if not new_items:
        logging.info("No new MTCTE updates found")
        write_new_entries([])
        return

    logging.info("Detected %d NEW MTCTE updates", len(new_items))

    append_to_master(new_items)
    write_new_entries(new_items)

    logging.info("CSV and JSON updated successfully")

if __name__ == "__main__":
    main()
