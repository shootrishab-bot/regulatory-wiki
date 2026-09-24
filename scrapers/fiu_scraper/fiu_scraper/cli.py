"""
Usage:
    python -m fiu_scraper.cli scrape [--limit N]
        Full scrape + classify + save to the database. This is what the
        watcher calls on each cycle.

    python -m fiu_scraper.cli watch
        Runs `scrape` on a loop every config.CHECK_INTERVAL_HOURS, and emails
        an alert (if SMTP is configured) for two independent signals:
        (1) a tracked document's Status changed since the last check (same
            pattern as cci_scraper), and
        (2) any brand-new Adjudication / Penalty Order appeared this run,
            regardless of whether it later changes -- FIU-IND's priority
            signal, see alerts.py's own docstring for why this needs its own
            query rather than riding on the Status-change one.

    python -m fiu_scraper.cli test-sample --n 600
        Scrapes every source, pools all raw items, takes a random sample of N
        (600 by default -- comfortably larger than the real pool found live,
        ~500 items across all 8 feeds, so this is effectively a full census by
        default), runs the full pipeline, and writes both the full results and
        a summary (tag counts per facet, needs_review rate,
        classification_method breakdown) to ./output/. No stratified variant
        was built for FIU-IND: unlike CCI's Antitrust Orders (~92% of that
        real pool), live inspection found no single FIU-IND feed dominates
        that badly -- What's New (~199) and Compliance Orders (126) are the
        two largest, at roughly 38% and 24% of the ~523-item real pool
        respectively -- so a flat random sample large enough to cover the
        whole pool was judged sufficient; see ../taxonomy-findings.md.
"""

import argparse
import asyncio
import json
import logging
import random
from datetime import datetime
from pathlib import Path
from typing import List

import aiohttp

from .alerts import AlertSystem
from .config import Config
from .database import Database
from .pipeline import process_batch
from .scraper import FIUFetcher, scrape_all_sources

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("fiu_scraper.cli")


def _output_path(name: str) -> Path:
    out_dir = Path("output")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    return out_dir / f"{name}-{stamp}.json"


async def run_scrape(config: Config, limit: int = None, exclude_ids: set = None) -> List[dict]:
    db = Database(config.DB_PATH)
    run_id = f"scrape-{datetime.now().strftime('%Y%m%dT%H%M%S')}"
    started = datetime.now()

    fetcher = FIUFetcher(config)
    async with aiohttp.ClientSession() as session:
        items = await scrape_all_sources(fetcher, session, config)

        # Every source returning nothing is never the site's real state: it
        # means blocked, unreachable, or changed layout. Fail loudly rather
        # than let the sync record "OK, 0 rows" (it did, 2026-09-23).
        if not items:
            raise RuntimeError("0 items scraped from every source -- blocked, unreachable, or the site layout changed")

        # exclude_ids: source_ids the caller already holds (the daily sync
        # passes every source_id already in Postgres for this regulator --
        # see ../run_fiu_scrape.py). Those are dropped before any download,
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

    logger.info("Scraped %d unique items; running extraction + classification pipeline...", len(items))
    records = await process_batch(config, items)

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
        mode="scrape", status="success", items_found=len(records), items_new=new_count,
        items_updated=updated_count, items_dropped=dropped_count,
        items_needs_review=review_count, error_message=None,
    )
    logger.info(
        "Scrape run complete: %d found, %d new, %d updated, %d dropped, %d need review",
        len(records), new_count, updated_count, dropped_count, review_count,
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

            status_changes = db.get_documents_with_status_change(since=check_start)
            if status_changes:
                alerter.send_status_change_alert(status_changes)

            new_penalty_orders = db.get_new_penalty_orders(since=check_start)
            if new_penalty_orders:
                alerter.send_new_penalty_order_alert(new_penalty_orders)
        except Exception:
            logger.exception("Watcher cycle failed; will retry next interval")

        await asyncio.sleep(config.CHECK_INTERVAL_HOURS * 3600)


async def run_test_sample(config: Config, n: int) -> None:
    """The taxonomy pressure-test: scrape everything reachable, randomly sample
    N items, run the full pipeline, and write results + a summary for review."""
    fetcher = FIUFetcher(config)
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

    by_feed = {}
    for r in records:
        f = r.get("source_feed") or "(none)"
        by_feed[f] = by_feed.get(f, 0) + 1

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
        "by_source_feed": dict(sorted(by_feed.items(), key=lambda kv: -kv[1])),
    }


def main():
    parser = argparse.ArgumentParser(description="FIU-IND regulatory scraper & watcher")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scrape = sub.add_parser("scrape", help="Scrape, classify, and save all sources")
    p_scrape.add_argument("--limit", type=int, default=None)

    sub.add_parser("watch", help="Run scrape on a loop with status-change and new-penalty-order email alerts")

    p_test = sub.add_parser("test-sample", help="Taxonomy pressure-test on a random sample")
    p_test.add_argument("--n", type=int, default=600)

    args = parser.parse_args()
    config = Config()

    if args.command == "scrape":
        asyncio.run(run_scrape(config, limit=args.limit))
    elif args.command == "watch":
        asyncio.run(run_watch(config))
    elif args.command == "test-sample":
        asyncio.run(run_test_sample(config, n=args.n))


if __name__ == "__main__":
    main()
