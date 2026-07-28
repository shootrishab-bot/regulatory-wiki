"""
Runs dot_adapter.py against the real scraped dot_master.csv and writes the
normalized output as JSON, per normalized_document.write_normalized_json()'s
documented usage pattern.
"""

import csv
import sys

import dot_adapter
from normalized_document import write_normalized_json

INPUT_CSV = "dot/dot_master.csv"
OUTPUT_JSON = "dot/dot_normalized.json"


def main():
    with open(INPUT_CSV, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} rows from {INPUT_CSV}")

    documents = dot_adapter.normalize_all(rows)
    write_normalized_json(OUTPUT_JSON, documents)

    print(f"Wrote {len(documents)} normalized documents to {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
