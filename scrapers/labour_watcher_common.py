"""
Shared driver behind labour_watcher_epfo.py / labour_watcher_esic.py /
labour_watcher_clc.py: scrape a regulator's own real source(s) via
labour_scrape.py, parse each via labour_parser.py, and write a per-regulator
master CSV -- the "watcher" half of the watcher/adapter split every other
regulator in this project uses (see run_mib_adapter.py's module docstring
for the two-script convention this mirrors).

One shared driver rather than three duplicated scripts because the real
logic (fetch -> block-check -> parse -> write CSV) is identical across all
three regulators; only the source key list and pagination differ, and those
already live in labour_scrape.py's own SOURCES dict.

BLOCKED DETECTION: labour_scrape.py's is_blocked() (WAF signatures + status
codes) is real, generic detection -- not source-specific text-scraping the
way dot_watcher.py's "!!! BLOCKED" or mib_updates_scrapper.py's "[BLOCKED]"
markers are. This module prints the literal marker "[BLOCKED]" (reusing
MIB's exact marker text) whenever ANY page for this regulator's sources come
back blocked, so lib/sync.ts's existing blockedMarkers substring-match
mechanism picks it up with no changes needed there beyond registering the
marker per regulator -- see lib/sync.ts's REGULATORS entries for EPFO/ESIC/CLC.
"""

import asyncio
import csv
import sys

from playwright.async_api import async_playwright

import labour_scrape as ls
import labour_parser as lp

PAGINATED_SOURCES = {"esic", "clc", "clc_min_wages", "clc_acts_rules"}

CSV_FIELDS = [
    "title",
    "published_date",
    "source_url",
    "file_size",
    "regulator",
    "regulator_full",
    "domain",
    "document_type",
    "labour_codes",
    "state",
    "scraped_at",
]


async def scrape_sources_to_documents(source_keys: list[str]) -> list[dict]:
    """Fetch + parse every given source key, real live. Returns the combined
    list of document dicts (labour_parser.py's own shape). Prints a
    "[BLOCKED]" line (see module docstring) for any page that came back
    blocked, and continues to the next source/page regardless -- one source
    being blocked must not lose real documents already scraped from another,
    same principle as lib/sync.ts's own per-regulator BLOCKED handling."""
    documents: list[dict] = []
    any_blocked = False

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        for key in source_keys:
            try:
                if key in PAGINATED_SOURCES:
                    pages = await ls.fetch_all_pages(browser, key)
                else:
                    pages = [await ls.fetch_page(browser, key)]
            except Exception as e:
                print(f"[ERROR] {key}: {type(e).__name__}: {e}", file=sys.stderr)
                continue

            source_docs = 0
            for pg in pages:
                if pg.get("blocked"):
                    any_blocked = True
                    print(
                        f"[BLOCKED] {key}: {pg.get('block_reason', 'unknown reason')} "
                        f"(page_index={pg.get('page_index', 0)})",
                        file=sys.stderr,
                    )
                    continue
                if pg.get("error"):
                    print(f"[ERROR] {key}: {pg['error']}", file=sys.stderr)
                    continue

                html = pg.get("html") or ""
                base_url = ls.SOURCES[key]["base_url"]
                result = lp.parse_source(key, html, base_url)
                documents.extend(result["documents"])
                source_docs += len(result["documents"])

            print(f"[{key}] {source_docs} real documents parsed", file=sys.stderr)

        await browser.close()

    if any_blocked:
        print("[BLOCKED] at least one source for this regulator was blocked this run -- see detail above", file=sys.stderr)

    return documents


def write_master_csv(path: str, documents: list[dict]):
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for doc in documents:
            row = dict(doc)
            # labour_codes is a list; CSV needs a flat string.
            row["labour_codes"] = ",".join(doc.get("labour_codes") or [])
            writer.writerow(row)


async def run_regulator_watcher(regulator_label: str, source_keys: list[str], output_csv: str):
    print(f"Scraping {regulator_label} ({', '.join(source_keys)}) ...", file=sys.stderr)
    documents = await scrape_sources_to_documents(source_keys)

    # Real cross-source duplicate check, same discipline as run_mib_adapter.py's
    # id-uniqueness assertion -- source_url is the natural dedup key here since
    # labour_adapter.py's source_id is itself derived from it.
    urls = [d.get("source_url") for d in documents]
    dupes = len(urls) - len(set(urls))
    if dupes:
        print(f"WARNING: {dupes} documents share a source_url with another real document in this run", file=sys.stderr)

    write_master_csv(output_csv, documents)
    print(f"Wrote {len(documents)} real documents to {output_csv}", file=sys.stderr)
