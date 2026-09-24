"""
Usage:
    python -m cci_scraper.cli discover
        Runs API discovery against the two AJAX search pages and writes
        data/cci/api_discovery.json. Run this FIRST, before `scrape` or
        `test-sample`, and read the log -- see api_discovery.py docstring.

    python -m cci_scraper.cli scrape [--limit N]
        Full scrape + classify + save to the database. This is what the
        watcher calls on each cycle.

    python -m cci_scraper.cli watch
        Runs `scrape` on a loop every config.CHECK_INTERVAL_HOURS, and emails
        an alert (if SMTP is configured) whenever a tracked document's Status
        changes between runs.

    python -m cci_scraper.cli test-sample --n 350
        Scrapes every source, pools all raw items, takes a random sample of
        N (350 by default), runs the full pipeline, and writes both the full
        results and a summary (tag counts per facet, needs_review rate,
        classification_method breakdown) to ./output/ -- this is the taxonomy
        pressure-test run, same pattern as the DST and Saral Sanchar builds.

    python -m cci_scraper.cli test-sample-stratified \\
        --full-census combination_notifications,tenders,market_studies,homepage \\
        --antitrust-sample 600 --antitrust-prefer-pre-2015
        Second-pass taxonomy test: classifies every real item from the
        `--full-census` source_feeds in full (no sampling), plus a separate
        sample of `--antitrust-sample` Antitrust Orders. With
        `--antitrust-prefer-pre-2015`, the antitrust sample is drawn roughly
        half from documents dated before 2015 and half from 2015-onward
        (falling back to a uniform draw from whichever bucket has spare
        capacity if one bucket is smaller than half the target), instead of
        one flat uniform draw across the whole antitrust pool -- see
        run_test_sample_stratified's docstring. Output matches test-sample's
        format, plus a `sampling_strategy` field on the summary recording
        exactly what was full-censused vs. sampled and how.
"""

import argparse
import asyncio
import json
import logging
import random
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import aiohttp

from .alerts import AlertSystem
from .config import Config
from .database import Database
from .pipeline import filter_changed_items, process_batch
from .scraper import CCIFetcher, ScrapedItem, scrape_all_sources

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("cci_scraper.cli")


def _output_path(name: str) -> Path:
    out_dir = Path("output")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    return out_dir / f"{name}-{stamp}.json"


async def run_discover(config: Config) -> None:
    from .api_discovery import discover_api

    for url in (config.ANTITRUST_ORDERS_URL, config.COMBINATION_NOTIFICATIONS_URL):
        logger.info("Running API discovery against %s ...", url)
        report = await discover_api(config, url)
        status = "API found" if not report.fallback_required else "no API found, DOM fallback will be used"
        logger.info("  -> %s (%d candidate endpoint(s))", status, len(report.endpoints_found))
    logger.info("Discovery complete. Review %s before running `scrape`.", config.DISCOVERY_LOG_PATH)


async def run_scrape(config: Config, limit: int = None, exclude_ids: set = None) -> List[dict]:
    db = Database(config.DB_PATH)
    run_id = f"scrape-{datetime.now().strftime('%Y%m%dT%H%M%S')}"
    started = datetime.now()

    fetcher = CCIFetcher(config)
    async with aiohttp.ClientSession() as session:
        items = await scrape_all_sources(fetcher, session, config)

        # Every source returning nothing is never the site's real state: it
        # means blocked, unreachable, or changed layout. Fail loudly rather
        # than let the sync record "OK, 0 rows" (it did, 2026-09-23).
        if not items:
            raise RuntimeError("0 items scraped from every source -- blocked, unreachable, or the site layout changed")

        # exclude_ids: source_ids the caller already holds (the daily sync
        # passes every source_id already in Postgres for this regulator --
        # see ../run_cci_scrape.py). Those are dropped before any download,
        # OCR or classification. Without this, a run on a machine with no
        # local SQLite -- every CI run, since the database is gitignored --
        # reprocessed the whole corpus and re-paid DeepSeek for every
        # document, only for lib/sync.ts to discard all of them as already
        # stored.
        if exclude_ids:
            before = len(items)
            items = [item for item in items if item.source_id not in exclude_ids]
            logger.info("%d/%d items already known to the caller; skipped before any download", before - len(items), before)

        if limit:
            items = items[:limit]

        # Incremental pre-filter -- see filter_changed_items()'s own
        # docstring for why this exists and exactly what it does and does
        # not detect as "changed". Reuses this same session/fetcher (still
        # open) for its HEAD requests rather than opening a second one.
        logger.info("Scraped %d unique items; checking which need (re)processing...", len(items))
        to_process, skipped_unchanged = await filter_changed_items(fetcher, session, db, items)

    logger.info(
        "%d/%d unchanged since last check (skipped, no download/OCR/classification) -- "
        "%d will run through the full pipeline",
        skipped_unchanged, len(items), len(to_process),
    )
    records = await process_batch(config, to_process)

    new_count = updated_count = dropped_count = review_count = 0
    for rec in records:
        existing = db.get_document(rec["id"])
        db.save_document(rec)
        if existing is None:
            new_count += 1
        else:
            updated_count += 1
        if not rec.get("kept", True):
            dropped_count += 1
        if rec.get("needs_review"):
            review_count += 1

    db.record_scrape_run(
        run_id=run_id, started_at=started.isoformat(), completed_at=datetime.now().isoformat(),
        mode="scrape", status="success", items_found=len(items), items_new=new_count,
        items_updated=updated_count, items_dropped=dropped_count,
        items_needs_review=review_count, items_skipped_unchanged=skipped_unchanged,
        error_message=None,
    )
    logger.info(
        "Scrape run complete: %d found (%d skipped unchanged), %d new, %d updated, %d dropped, %d need review",
        len(items), skipped_unchanged, new_count, updated_count, dropped_count, review_count,
    )
    return records


async def run_watch(config: Config) -> None:
    db = Database(config.DB_PATH)
    alerter = AlertSystem(config)
    logger.info("Starting watcher, checking every %.1f hours. Ctrl+C to stop.", config.CHECK_INTERVAL_HOURS)

    while True:
        check_start = datetime.now()
        try:
            await run_scrape(config)
            changes = db.get_documents_with_status_change(since=check_start)
            if changes:
                alerter.send_status_change_alert(changes)
        except Exception:
            logger.exception("Watcher cycle failed; will retry next interval")

        await asyncio.sleep(config.CHECK_INTERVAL_HOURS * 3600)


async def run_test_sample(config: Config, n: int) -> None:
    """The taxonomy pressure-test: scrape everything reachable, randomly sample
    N items, run the full pipeline, and write results + a summary for review."""
    fetcher = CCIFetcher(config)
    async with aiohttp.ClientSession() as session:
        all_items = await scrape_all_sources(fetcher, session, config)

    logger.info("Scraped %d unique items total across all sources", len(all_items))
    sample = random.sample(all_items, min(n, len(all_items)))
    logger.info("Sampled %d items for the taxonomy test run", len(sample))

    records = await process_batch(config, sample)

    results_path = _output_path("test-sample")
    results_path.write_text(json.dumps(records, indent=2, default=str))

    summary = _summarise(records)
    summary_path = _output_path("test-sample-summary")
    summary_path.write_text(json.dumps(summary, indent=2))

    logger.info("Wrote %d records to %s", len(records), results_path)
    logger.info("Wrote summary to %s", summary_path)
    logger.info(
        "\n%d/%d (%.1f%%) needs_review\nBy Subject: %s\nBy Instrument Type: %s\nBy Status: %s\nBy classification_method: %s",
        summary["needs_review"], summary["total"], summary["needs_review_pct"],
        summary["by_subject"], summary["by_instrument_type"], summary["by_status"], summary["by_classification_method"],
    )


# Real achieved counts from the first (flat random) test run, 2026-08-18 --
# used only to log a comparison, never as a hard assertion, since real site
# content legitimately grows over time (a new tender/notification appearing
# is not a scraper regression).
_FIRST_RUN_REFERENCE_COUNTS = {
    "combination_notifications": 23,
    "tenders": 16,
    "market_studies": 28,
    "homepage": 36,  # post-dedup count from scrape_all_sources; raw homepage feed was 40
}


def _year_of(date_str: Optional[str]) -> Optional[int]:
    """Extracts the 4-digit year from a real CCI date string. Antitrust Orders'
    `date` field is the raw order_date/main_order_date value straight from the
    JSON API (DD/MM/YYYY, e.g. "17/04/2012"), not run through extract_date --
    scanning from the end for a 4-digit token handles that format (and any
    other real variant, e.g. extract_date's dotted "15.05.2026") without
    assuming a fixed separator."""
    if not date_str:
        return None
    for part in reversed(re.split(r"[./\-\s]", date_str.strip())):
        if len(part) == 4 and part.isdigit():
            return int(part)
    return None


async def run_test_sample_stratified(
    config: Config,
    full_census_feeds: List[str],
    antitrust_sample: int,
    antitrust_prefer_pre_2015: bool,
) -> None:
    """Second-pass taxonomy test. Unlike run_test_sample's flat random draw
    over the whole pool (which under-covers small sources -- Antitrust Orders
    alone is ~92% of the real pool), this classifies every real item from
    `full_census_feeds` in full and draws a separate, optionally-stratified
    sample of Antitrust Orders. Reuses process_batch unchanged -- this is a
    sampling-strategy change only, nothing about extraction or classification
    itself is touched here."""
    fetcher = CCIFetcher(config)
    async with aiohttp.ClientSession() as session:
        all_items = await scrape_all_sources(fetcher, session, config)
    logger.info("Scraped %d unique items total across all sources", len(all_items))

    by_feed: Dict[str, List[ScrapedItem]] = {}
    for item in all_items:
        by_feed.setdefault(item.source_feed, []).append(item)

    sample: List[ScrapedItem] = []
    strategy: dict = {"full_census": {}, "antitrust_sample": {}}

    for feed in full_census_feeds:
        items = by_feed.get(feed, [])
        sample.extend(items)
        reference = _FIRST_RUN_REFERENCE_COUNTS.get(feed)
        strategy["full_census"][feed] = {"achieved": len(items), "first_run_reference": reference}
        if reference is not None and len(items) < reference:
            logger.warning(
                "Full census of %s came back SHORT: %d real items now vs. %d in the first run -- "
                "this is a partial census, not a complete one. Investigate before trusting any "
                "finding that depends on this feed's full coverage.",
                feed, len(items), reference,
            )
        else:
            logger.info("Full census: %s -> %d real items (first run: %s)", feed, len(items), reference)

    antitrust_items = by_feed.get("antitrust_orders", [])
    if antitrust_prefer_pre_2015:
        pre_2015 = [i for i in antitrust_items if (_year_of(i.date) or 9999) < 2015]
        post_2015 = [i for i in antitrust_items if (_year_of(i.date) or 0) >= 2015]
        half = antitrust_sample // 2
        pre_take = min(half, len(pre_2015))
        post_take = min(antitrust_sample - pre_take, len(post_2015))
        remaining = antitrust_sample - pre_take - post_take
        if remaining > 0:
            extra_pre = min(remaining, len(pre_2015) - pre_take)
            pre_take += extra_pre
            remaining -= extra_pre
        if remaining > 0:
            extra_post = min(remaining, len(post_2015) - post_take)
            post_take += extra_post
            remaining -= extra_post

        antitrust_selected = random.sample(pre_2015, pre_take) + random.sample(post_2015, post_take)
        strategy["antitrust_sample"] = {
            "method": "stratified: ~half pre-2015, ~half 2015-onward (oversampling pre-2015 relative "
                      "to its true pool share, since that's where the first run's extraction failures "
                      "concentrated), falling back to the other bucket if one is smaller than half the target",
            "target": antitrust_sample,
            "achieved": len(antitrust_selected),
            "pre_2015_pool": len(pre_2015), "pre_2015_sampled": pre_take,
            "post_2015_pool": len(post_2015), "post_2015_sampled": post_take,
        }
        if remaining > 0:
            logger.warning(
                "Antitrust stratified sample came up %d short of the %d target -- "
                "pre-2015 pool (%d) + 2015-onward pool (%d) = %d total, smaller than requested.",
                remaining, antitrust_sample, len(pre_2015), len(post_2015), len(antitrust_items),
            )
    else:
        antitrust_selected = random.sample(antitrust_items, min(antitrust_sample, len(antitrust_items)))
        strategy["antitrust_sample"] = {
            "method": "uniform random", "target": antitrust_sample,
            "achieved": len(antitrust_selected), "pool": len(antitrust_items),
        }
    sample.extend(antitrust_selected)

    covered_feeds = set(full_census_feeds) | {"antitrust_orders"}
    uncovered = sorted(set(by_feed.keys()) - covered_feeds)
    strategy["uncovered_feeds"] = {f: len(by_feed[f]) for f in uncovered}
    if uncovered:
        logger.warning("Feeds present in the real pool but NOT included in this sample: %s", strategy["uncovered_feeds"])

    logger.info("Stratified sample assembled: %d total items (%s)", len(sample), json.dumps(strategy))

    # Two earlier attempts at 703 items (concurrency=4, then concurrency=2)
    # were both killed around the ~28-33 minute mark with no error in the log
    # and no matching crash/power/sleep event in Windows' System or
    # Application event logs -- ruled out as memory pressure (the lower-
    # concurrency retry made LESS progress by a similar wall-clock point, the
    # opposite of what a memory fix should do). Real cause undetermined, but
    # behaves like a wall-clock ceiling on this background task rather than a
    # resource limit -- so the fix is a smaller sample within default
    # concurrency, not less concurrency. Left at process_batch's default.
    records = await process_batch(config, sample)

    results_path = _output_path("test-sample-stratified")
    results_path.write_text(json.dumps(records, indent=2, default=str))

    summary = _summarise(records)
    summary["sampling_strategy"] = strategy
    summary_path = _output_path("test-sample-stratified-summary")
    summary_path.write_text(json.dumps(summary, indent=2))

    logger.info("Wrote %d records to %s", len(records), results_path)
    logger.info("Wrote summary to %s", summary_path)
    logger.info(
        "\n%d/%d (%.1f%%) needs_review\nBy Subject: %s\nBy Instrument Type: %s\nBy Status: %s\nBy classification_method: %s",
        summary["needs_review"], summary["total"], summary["needs_review_pct"],
        summary["by_subject"], summary["by_instrument_type"], summary["by_status"], summary["by_classification_method"],
    )


def _summarise(records: List[dict]) -> dict:
    kept = [r for r in records if r.get("kept", True)]
    dropped = [r for r in records if not r.get("kept", True)]
    needs_review = [r for r in records if r.get("needs_review")]

    def counts(key):
        out = {}
        for r in kept:
            v = r.get(key) or "(unclassified)"
            out[v] = out.get(v, 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    method_counts = {}
    for r in records:
        m = r.get("classification_method") or "(none)"
        method_counts[m] = method_counts.get(m, 0) + 1

    return {
        "total": len(records),
        "kept": len(kept),
        "dropped": len(dropped),
        "needs_review": len(needs_review),
        "needs_review_pct": round(100 * len(needs_review) / len(records), 1) if records else 0.0,
        "by_subject": counts("subject"),
        "by_instrument_type": counts("instrument_type"),
        "by_status": counts("status"),
        "by_classification_method": method_counts,
    }


def main():
    parser = argparse.ArgumentParser(description="CCI regulatory scraper & watcher")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("discover", help="Discover the AJAX search pages' underlying APIs")

    p_scrape = sub.add_parser("scrape", help="Scrape, classify, and save all sources")
    p_scrape.add_argument("--limit", type=int, default=None)

    sub.add_parser("watch", help="Run scrape on a loop with status-change email alerts")

    p_test = sub.add_parser("test-sample", help="Taxonomy pressure-test on a random sample")
    p_test.add_argument("--n", type=int, default=350)

    p_test_strat = sub.add_parser(
        "test-sample-stratified",
        help="Taxonomy pressure-test: full census of small sources + a (optionally stratified) antitrust sample",
    )
    p_test_strat.add_argument(
        "--full-census", type=str, default="",
        help="Comma-separated source_feed values to classify in full, e.g. combination_notifications,tenders,market_studies,homepage",
    )
    p_test_strat.add_argument("--antitrust-sample", type=int, default=600)
    p_test_strat.add_argument(
        "--antitrust-prefer-pre-2015", action="store_true",
        help="Oversample pre-2015 Antitrust Orders (roughly half the sample) instead of one uniform draw",
    )

    args = parser.parse_args()
    config = Config()

    if args.command == "discover":
        asyncio.run(run_discover(config))
    elif args.command == "scrape":
        asyncio.run(run_scrape(config, limit=args.limit))
    elif args.command == "watch":
        asyncio.run(run_watch(config))
    elif args.command == "test-sample":
        asyncio.run(run_test_sample(config, n=args.n))
    elif args.command == "test-sample-stratified":
        full_census_feeds = [f.strip() for f in args.full_census.split(",") if f.strip()]
        asyncio.run(run_test_sample_stratified(
            config,
            full_census_feeds=full_census_feeds,
            antitrust_sample=args.antitrust_sample,
            antitrust_prefer_pre_2015=args.antitrust_prefer_pre_2015,
        ))


if __name__ == "__main__":
    main()
