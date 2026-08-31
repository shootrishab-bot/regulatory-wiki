"""
One-off taxonomy v1.3 stratified test run, per the 2026-08-28 request:

    1. Full census of every small CCI source_feed (all of them except
       antitrust_orders, which the scraper.py docstring and prior runs
       confirm is ~92% of the real pool -- pulled from the actual wired
       feeds in scrape_all_sources(), not guessed).
    2. A date-stratified oversample of Antitrust Orders: rather than the
       CLI's existing --antitrust-prefer-pre-2015 (a coarse binary split
       designed to chase a *different*, already-fixed extraction-failure
       problem), this takes the FULL population of Antitrust Orders dated
       in the last 3 calendar years (2024, 2025, 2026 as of today) --
       confirmed via the existing DB to be a modest ~158-item pool, small
       enough to census outright rather than merely sample, which
       trivially satisfies "sample across at least the last 3 years" with
       zero coverage gaps within that window.

Does NOT touch the taxonomy workbook or the live sqlite DB (no
db.save_document calls) -- output-only, same as the existing test-sample /
test-sample-stratified commands.
"""

import asyncio
import json
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List

import aiohttp

from .config import Config
from .pipeline import process_batch
from .scraper import CCIFetcher, ScrapedItem, scrape_all_sources

logger = logging.getLogger("cci_scraper.run_v13_test")

LOG_PATH = Path("output") / f"v13-test-run-{datetime.now().strftime('%Y%m%dT%H%M%S')}.log"
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

# Captures HTTP-status warnings and exceptions from anywhere in the package
# (scraper.py's fetch_html/download_pdf, pipeline.py's error_fallback path)
# so the final report can list WAF/error signals without re-parsing prose logs.
_captured_warnings: List[str] = []


class _CaptureHandler(logging.Handler):
    def emit(self, record):
        if record.levelno >= logging.WARNING:
            _captured_warnings.append(self.format(record))


def _setup_logging():
    root = logging.getLogger("cci_scraper")
    root.setLevel(logging.INFO)
    fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(fh)
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(ch)
    cap = _CaptureHandler()
    cap.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(cap)


def _year_of(date_str):
    if not date_str:
        return None
    for part in reversed(re.split(r"[./\-\s]", date_str.strip())):
        if len(part) == 4 and part.isdigit():
            return int(part)
    return None


async def main():
    _setup_logging()
    config = Config()
    fetcher = CCIFetcher(config)

    logger.info("=== Live scrape: discovering current item pool across all wired source_feeds ===")
    async with aiohttp.ClientSession() as session:
        all_items = await scrape_all_sources(fetcher, session, config)
    logger.info("Scraped %d unique items total across all sources", len(all_items))

    by_feed: Dict[str, List[ScrapedItem]] = defaultdict(list)
    for item in all_items:
        by_feed[item.source_feed].append(item)

    live_counts = {feed: len(items) for feed, items in by_feed.items()}
    logger.info("Live per-feed counts: %s", live_counts)

    # "Small sources" = every wired feed other than antitrust_orders -- not a
    # guess: these are literally the only feeds scrape_all_sources() wires up
    # (see scraper.py), and antitrust_orders is confirmed (both by this
    # live count and prior runs) to dwarf every other feed by an order of
    # magnitude or more.
    full_census_feeds = sorted(f for f in by_feed if f != "antitrust_orders")
    antitrust_items = by_feed.get("antitrust_orders", [])

    current_year = datetime.now().year
    target_years = {current_year, current_year - 1, current_year - 2}  # last 3 calendar years
    antitrust_by_year = defaultdict(list)
    for item in antitrust_items:
        antitrust_by_year[_year_of(item.date)].append(item)

    antitrust_selected = [
        item for item in antitrust_items if _year_of(item.date) in target_years
    ]

    sample: List[ScrapedItem] = []
    for feed in full_census_feeds:
        sample.extend(by_feed[feed])
    sample.extend(antitrust_selected)

    strategy = {
        "full_census_feeds": {f: len(by_feed[f]) for f in full_census_feeds},
        "antitrust_date_stratified_sample": {
            "target_years": sorted(target_years),
            "pool_by_year": {str(y): len(v) for y, v in sorted(antitrust_by_year.items(), key=lambda kv: (kv[0] is None, kv[0]))},
            "selected_count": len(antitrust_selected),
            "selected_by_year": {
                str(y): sum(1 for i in antitrust_selected if _year_of(i.date) == y) for y in sorted(target_years)
            },
            "method": "full census (not sampled) of every Antitrust Order dated in the last 3 calendar years "
                      f"({sorted(target_years)}) -- pool small enough (158 as of the last DB check) to take in full",
        },
        "antitrust_total_pool": len(antitrust_items),
        "antitrust_excluded_older_years": len(antitrust_items) - len(antitrust_selected),
    }
    logger.info("Sample assembled: %d total items. Strategy: %s", len(sample), json.dumps(strategy, default=str))

    logger.info("=== Running full pipeline (download/extract/classify) over %d items ===", len(sample))
    records = await process_batch(config, sample)

    out_dir = Path("output")
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    results_path = out_dir / f"v13-test-run-{stamp}.json"
    results_path.write_text(json.dumps(records, indent=2, default=str))

    kept = [r for r in records if r.get("kept", True)]
    needs_review = [r for r in records if r.get("needs_review")]

    def counts_per_source(records_subset):
        c = Counter(r.get("source_feed") or "(unknown)" for r in records_subset)
        return dict(sorted(c.items(), key=lambda kv: -kv[1]))

    def counts(key):
        c = Counter((r.get(key) or "(unclassified/null)") for r in kept)
        return dict(sorted(c.items(), key=lambda kv: -kv[1]))

    method_counts = Counter(r.get("classification_method") or "(none)" for r in records)

    summary = {
        "run_timestamp": stamp,
        "taxonomy_version_in_code": "CCI_Regulatory_Taxonomy_v1_3 (see cci_scraper/__init__.py)",
        "sampling_strategy": strategy,
        "processed_per_source_all": counts_per_source(records),
        "processed_per_source_kept": counts_per_source(kept),
        "total": len(records),
        "kept": len(kept),
        "dropped": len(records) - len(kept),
        "needs_review": len(needs_review),
        "needs_review_pct": round(100 * len(needs_review) / len(records), 1) if records else 0.0,
        "by_instrument_type": counts("instrument_type"),
        "by_status": counts("status"),
        "by_subject": counts("subject"),
        "by_classification_method": dict(method_counts),
        "needs_review_items": [
            {
                "id": r.get("id"),
                "source_feed": r.get("source_feed"),
                "title": r.get("title"),
                "date": r.get("date"),
                "url": r.get("url"),
                "instrument_type": r.get("instrument_type"),
                "status": r.get("status"),
                "review_reasons": json.loads(r["review_reasons"]) if r.get("review_reasons") else [],
                "rationale": r.get("rationale"),
            }
            for r in needs_review
        ],
        "warnings_and_errors_captured": _captured_warnings,
    }
    summary_path = out_dir / f"v13-test-run-summary-{stamp}.json"
    summary_path.write_text(json.dumps(summary, indent=2, default=str))

    logger.info("Wrote %d records to %s", len(records), results_path)
    logger.info("Wrote summary to %s", summary_path)
    logger.info("Full log at %s", LOG_PATH)
    logger.info(
        "\n%d/%d (%.1f%%) needs_review\nPer-source (all): %s\nBy Instrument Type: %s\nBy Status: %s\nBy classification_method: %s",
        summary["needs_review"], summary["total"], summary["needs_review_pct"],
        summary["processed_per_source_all"], summary["by_instrument_type"], summary["by_status"], summary["by_classification_method"],
    )


if __name__ == "__main__":
    asyncio.run(main())
