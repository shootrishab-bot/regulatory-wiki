"""
Runs mtcte_adapter.py against the real scraped mtcte_master.csv and writes
the normalized output as JSON, per normalized_document.write_normalized_json()'s
documented usage pattern. Mirrors run_dot_adapter.py's structure exactly.
"""

import csv

import mtcte_adapter
from normalized_document import write_normalized_json

INPUT_CSV = "data/mtcte_master.csv"
OUTPUT_JSON = "data/mtcte_normalized.json"


def main():
    with open(INPUT_CSV, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} rows from {INPUT_CSV}")

    deduped_rows = mtcte_adapter.dedup_cross_source(rows)
    print(f"After dedup_cross_source(): {len(deduped_rows)} rows")

    documents = [mtcte_adapter.normalize(row) for row in deduped_rows]
    write_normalized_json(OUTPUT_JSON, documents)

    print(f"Wrote {len(documents)} normalized documents to {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
