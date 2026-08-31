"""
Runs labour_adapter.py against the real scraped epfo_master.csv and writes
the normalized output as JSON. Mirrors run_mib_adapter.py / run_dot_adapter.py.
"""

import csv
from collections import Counter

import labour_adapter
from normalized_document import write_normalized_json

INPUT_CSV = "data/epfo_master.csv"
OUTPUT_JSON = "data/epfo_normalized.json"


def main():
    with open(INPUT_CSV, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} rows from {INPUT_CSV}")

    url_counts = Counter(r["source_url"] for r in rows)
    dupes = {k: v for k, v in url_counts.items() if v > 1}
    if dupes:
        print(f"WARNING: {len(dupes)} duplicate source_urls found in the CSV:")
        for k, v in list(dupes.items())[:10]:
            print(f"  {k}: {v} occurrences")
    else:
        print("Duplicate source_url check: 0 duplicates")

    documents = [labour_adapter.normalize(row) for row in rows]
    write_normalized_json(OUTPUT_JSON, documents)

    print(f"Wrote {len(documents)} normalized documents to {OUTPUT_JSON}")

    needs_download = sum(1 for d in documents if d.needs_download)
    no_date = sum(1 for d in documents if not d.published_date)
    print(f"  needs_download=True: {needs_download}")
    print(f"  no published_date:   {no_date}")


if __name__ == "__main__":
    main()
