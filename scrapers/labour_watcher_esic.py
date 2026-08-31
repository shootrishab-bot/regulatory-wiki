"""ESIC watcher entrypoint -- see labour_watcher_common.py for the shared
real scrape/parse/write logic. Source: esic (colon-path pagination,
/circulars/index/page:N) -- see labour_scrape.py's SOURCES dict.

KNOWN GAP (confirmed 2026-08-13): the real crawl hits its MAX_PAGES safety
cap (30 pages / ~300 rows) without labour_scrape.py's row-count heuristic
ever confirming a genuine last page for this source -- ESIC's real total
document count is unknown and likely larger than what one run captures. Not
a correctness bug (every page fetched is real, and MAX_PAGES exists
specifically to bound a crawl that never finds its own stopping signal), but
worth raising MAX_PAGES_DEFAULT in labour_scrape.py or investigating ESIC's
real pagination further before treating a single run's count as complete."""

import asyncio
from labour_watcher_common import run_regulator_watcher

SOURCE_KEYS = ["esic"]
OUTPUT_CSV = "data/esic_master.csv"

if __name__ == "__main__":
    asyncio.run(run_regulator_watcher("ESIC", SOURCE_KEYS, OUTPUT_CSV))
