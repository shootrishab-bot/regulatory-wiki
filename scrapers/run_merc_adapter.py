"""
Runs merc_adapter over scrapers/data/merc_raw.json and writes
scrapers/data/merc_normalized.json for scripts/ingest-merc.ts to consume.

Run:
    python scrapers/run_merc_adapter.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import merc_adapter  # noqa: E402
from normalized_document import write_normalized_json  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
RAW_PATH = os.path.join(DATA_DIR, "merc_raw.json")
OUT_PATH = os.path.join(DATA_DIR, "merc_normalized.json")


def main() -> int:
    with open(RAW_PATH, encoding="utf-8") as fh:
        rows = json.load(fh)

    documents = merc_adapter.normalize_all(rows)
    write_normalized_json(OUT_PATH, documents)

    with_file = sum(1 for d in documents if d.file_url)
    with_date = sum(1 for d in documents if d.published_date)
    with_status = sum(1 for d in documents if d.status_hint)
    print(f"Normalized {len(documents)} MERC documents -> {OUT_PATH}")
    print(f"  with file_url:       {with_file}")
    print(f"  with published_date: {with_date}")
    print(f"  with status_hint:    {with_status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
