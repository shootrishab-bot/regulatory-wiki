"""
Daily-sync watcher entrypoint for FIU-IND. Runs the real, live `scrape`
command from the fiu_scraper package (fiu_scraper/cli.py's run_scrape) --
full scrape + extract + classify + save to that package's own SQLite
database -- the same scrape_all_sources()/process_batch() machinery already
proven live via a real test-sample run (see ../taxonomy-findings.md),
exercised here through the `scrape` code path (persist to SQLite, dedup by
id) for daily production use, same relationship run_cci_scrape.py has to
cci_scraper's own `scrape` command.

Why a wrapper instead of registering `fiu_scraper/cli.py` directly: the
fiu_scraper package's own relative paths (Config.DATA_DIR = "data/fiu", so
SQLite db + downloads live under fiu_scraper/data/fiu/) assume it's run with
cwd=scrapers/fiu_scraper/ and imported as the `fiu_scraper` package --
neither is true when lib/sync.ts's runScript() spawns `python <script>` with
cwd=scrapers/ (the shared convention every regulator's watcher entrypoint
follows). This script bridges that gap: adjusts sys.path and cwd itself, in
this same process, before importing anything from the package. Identical
pattern to run_cci_scrape.py.

Run with (matches every other regulator's watcher invocation):
    python run_fiu_scrape.py
Writes/updates scrapers/fiu_scraper/data/fiu/fiu_scraper.db --
run_fiu_adapter.py reads that and produces the normalized JSON.
"""

import argparse
import asyncio
import os
import sys

PACKAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fiu_scraper")


def main():
    # --limit is for manual smoke-testing only (e.g. `python run_fiu_scrape.py
    # --limit 10`) -- lib/sync.ts's daily run never passes it, matching every
    # other regulator's unbounded full-rescrape-then-dedup pattern.
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    sys.path.insert(0, PACKAGE_DIR)
    os.chdir(PACKAGE_DIR)  # so Config.DATA_DIR ("data/fiu") resolves under fiu_scraper/, matching CCI's own wrapper

    from fiu_scraper.cli import run_scrape
    from fiu_scraper.config import Config

    config = Config()
    if not config.DEEPSEEK_API_KEY:
        print("DEEPSEEK_API_KEY not set -- cannot classify. Aborting.", file=sys.stderr)
        sys.exit(1)

    records = asyncio.run(run_scrape(config, limit=args.limit))
    print(f"FIU-IND scrape complete: {len(records)} real items processed.")


if __name__ == "__main__":
    main()
