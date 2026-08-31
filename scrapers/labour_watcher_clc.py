"""CLC watcher entrypoint -- see labour_watcher_common.py for the shared
real scrape/parse/write logic. Sources: clc (Circulars/Orders), clc_min_wages
(Minimum Wages), clc_acts_rules (Acts and Rules) -- all query-param
paginated, see labour_scrape.py's SOURCES dict for the underlying real-site
evidence and each section's real page count."""

import asyncio
from labour_watcher_common import run_regulator_watcher

SOURCE_KEYS = ["clc", "clc_min_wages", "clc_acts_rules"]
OUTPUT_CSV = "data/clc_master.csv"

if __name__ == "__main__":
    asyncio.run(run_regulator_watcher("CLC", SOURCE_KEYS, OUTPUT_CSV))
