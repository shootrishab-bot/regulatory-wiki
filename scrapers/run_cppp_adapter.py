"""
Runs cppp_adapter over a CPPP raw-scrape file and writes the normalized JSON
that scripts/ingest-sample.ts consumes.

TWO REAL INPUTS EXIST, AND BOTH HAVE TO BE REPRODUCIBLE
The listing scrape and the institutional scrape are separate runs of
cppp_watcher.py (the latter via --skip-listings), and they normalize to
separate files. This script took no arguments until 2026-09-14, so only the
first of the two was reachable by a committed command -- while the
institutional file is the input behind the most consequential finding of the
whole CPPP exercise (cppp-taxonomy-findings.md, Finding 7: Subject and
Instrument Type definitions were never sent to the classifier, caught by
re-running those 89 documents). An unreproducible input under a finding that
load-bearing is a gap, so --raw/--out exist here now, matching the convention
build_cppp_sample.py already uses.

Run:
    python scrapers/run_cppp_adapter.py

    python scrapers/run_cppp_adapter.py \
        --raw scrapers/data/cppp_institutional_raw.json \
        --out scrapers/data/cppp_institutional_normalized.json
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cppp_adapter  # noqa: E402
from normalized_document import write_normalized_json  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
RAW_PATH = os.path.join(DATA_DIR, "cppp_raw.json")
OUT_PATH = os.path.join(DATA_DIR, "cppp_normalized.json")


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize a CPPP raw scrape")
    parser.add_argument("--raw", default=RAW_PATH)
    parser.add_argument("--out", default=OUT_PATH)
    args = parser.parse_args()

    with open(args.raw, encoding="utf-8") as fh:
        rows = json.load(fh)

    documents = cppp_adapter.normalize_all(rows)
    write_normalized_json(args.out, documents)

    with_file = sum(1 for d in documents if d.file_url)
    with_text = sum(1 for d in documents if d.raw_text)
    with_status = sum(1 for d in documents if d.status_hint)
    print(f"Normalized {len(documents)} CPPP documents -> {args.out}")
    print(f"  with file_url (downloadable): {with_file}")
    print(f"  with listing raw_text:        {with_text}")
    print(f"  with status_hint:             {with_status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
