"""
Daily-sync watcher entrypoint for CCI. Runs the real, live `scrape` command
from the cci_scraper package (cci_scraper/cli.py's run_scrape) -- full
scrape + extract + classify + save to that package's own SQLite database --
the same scrape_all_sources()/process_batch() machinery already proven live
via the two real test-sample runs (taxonomy-findings.md,
taxonomy-findings-v2.md), just exercised through the `scrape` code path
(persist to SQLite, dedup by id) for the first time rather than `test-sample`
(random-sample, write-to-JSON-only, never meant for repeated production use).

Why a wrapper instead of registering `cci_scraper/cli.py` directly: the
cci_scraper package's own relative paths (Config.DATA_DIR = "data/cci", so
SQLite db + downloads live under cci_scraper/data/cci/) assume it's run with
cwd=scrapers/cci_scraper/ and imported as the `cci_scraper` package --
neither is true when lib/sync.ts's runScript() spawns `python <script>` with
cwd=scrapers/ (the shared convention every regulator's watcher entrypoint
follows). This script bridges that gap: adjusts sys.path and cwd itself, in
this same process, before importing anything from the package.

Run with (matches every other regulator's watcher invocation):
    python run_cci_scrape.py
Writes/updates scrapers/cci_scraper/data/cci/cci_scraper.db --
run_cci_adapter.py reads that and produces the normalized JSON.
"""

import argparse
import asyncio
import os
import sys

PACKAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cci_scraper")


def main():
    # --limit is for manual smoke-testing only (e.g. `python run_cci_scrape.py
    # --limit 10`) -- lib/sync.ts's daily run never passes it, matching every
    # other regulator's unbounded full-rescrape-then-dedup pattern.
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    sys.path.insert(0, PACKAGE_DIR)
    os.chdir(PACKAGE_DIR)  # so Config.DATA_DIR ("data/cci") resolves under cci_scraper/, matching every prior real run

    from cci_scraper.cli import run_scrape
    from cci_scraper.config import Config

    config = Config()
    if not config.DEEPSEEK_API_KEY:
        print("DEEPSEEK_API_KEY not set -- cannot classify. Aborting.", file=sys.stderr)
        sys.exit(1)

    records = asyncio.run(run_scrape(config, limit=args.limit))
    print(f"CCI scrape complete: {len(records)} real items processed.")


if __name__ == "__main__":
    main()
