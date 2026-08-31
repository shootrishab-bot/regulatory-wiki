"""EPFO watcher entrypoint -- see labour_watcher_common.py for the shared
real scrape/parse/write logic. Sources: epfo_updates (no real pagination,
371+ real rows confirmed) and epfo_circulars (no real pagination, 91+ real
rows confirmed) -- see labour_scrape.py's SOURCES dict for the underlying
real-site evidence behind each."""

import asyncio
from labour_watcher_common import run_regulator_watcher

SOURCE_KEYS = ["epfo_updates", "epfo_circulars"]
OUTPUT_CSV = "data/epfo_master.csv"

if __name__ == "__main__":
    asyncio.run(run_regulator_watcher("EPFO", SOURCE_KEYS, OUTPUT_CSV))
