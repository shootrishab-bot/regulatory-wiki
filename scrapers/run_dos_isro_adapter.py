"""
Runs dos_isro_adapter.py against the real scraped dos_isro_master.csv and
writes the normalized output as JSON. Mirrors run_mib_adapter.py.
"""

import csv
from collections import Counter

import dos_isro_adapter
from normalized_document import write_normalized_json

INPUT_CSV = "data/dos_isro_master.csv"
OUTPUT_JSON = "data/dos_isro_normalized.json"


def main():
    with open(INPUT_CSV, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} rows from {INPUT_CSV}")

    id_counts = Counter(r["id"] for r in rows)
    dupes = {k: v for k, v in id_counts.items() if v > 1}
    if dupes:
        print(f"WARNING: {len(dupes)} duplicate source ids found in the CSV:")
        for k, v in list(dupes.items())[:10]:
            print(f"  {k}: {v} occurrences")
    else:
        print("Duplicate source_id check: 0 duplicates (all ids unique)")

    documents = [dos_isro_adapter.normalize(row) for row in rows]
    write_normalized_json(OUTPUT_JSON, documents)

    print(f"Wrote {len(documents)} normalized documents to {OUTPUT_JSON}")

    by_category = Counter(d.category_hint for d in documents)
    needs_download = sum(1 for d in documents if d.needs_download)
    no_date = sum(1 for d in documents if not d.published_date)
    has_raw_text = sum(1 for d in documents if d.raw_text)
    print(f"  by category: {dict(sorted(by_category.items()))}")
    print(f"  needs_download=True:   {needs_download}")
    print(f"  no published_date:     {no_date}")
    print(f"  raw_text already set:  {has_raw_text}")


if __name__ == "__main__":
    main()
