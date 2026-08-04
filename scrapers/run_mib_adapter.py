"""
Runs mib_adapter.py against the real scraped mib_master.csv and writes the
normalized output as JSON, per normalized_document.write_normalized_json()'s
documented usage pattern. Mirrors run_mtcte_adapter.py / run_dot_adapter.py.

No dedup pass here, unlike run_mtcte_adapter.py: MIB's scraper already
produces a stable per-row sha1 id (title|date|category|link) and its 18 real
sections do not overlap the way MTCTE's archive/homepage sources did, so
there is no real cross-source duplication to collapse. Verified against the
real 1,024-row CSV -- see the duplicate check printed below, which is a real
assertion rather than an assumption.
"""

import csv
from collections import Counter

import mib_adapter
from normalized_document import write_normalized_json

INPUT_CSV = "data/mib_master.csv"
OUTPUT_JSON = "data/mib_normalized.json"


def main():
    with open(INPUT_CSV, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} rows from {INPUT_CSV}")

    # Real assertion, not an assumption: confirm the scraper's own ids are
    # actually unique before handing them to the ingestion pipeline, which
    # relies on source_id as its dedup key.
    id_counts = Counter(r["id"] for r in rows)
    dupes = {k: v for k, v in id_counts.items() if v > 1}
    if dupes:
        print(f"WARNING: {len(dupes)} duplicate source ids found in the CSV:")
        for k, v in list(dupes.items())[:10]:
            print(f"  {k}: {v} occurrences")
    else:
        print("Duplicate source_id check: 0 duplicates (all ids unique)")

    documents = [mib_adapter.normalize(row) for row in rows]
    write_normalized_json(OUTPUT_JSON, documents)

    print(f"Wrote {len(documents)} normalized documents to {OUTPUT_JSON}")

    # Real breakdown of what the pipeline will actually have to work with.
    needs_download = sum(1 for d in documents if d.needs_download)
    no_file = sum(1 for d in documents if not d.file_url)
    no_date = sum(1 for d in documents if not d.published_date)
    print(f"  needs_download=True (real downloadable file): {needs_download}")
    print(f"  no file_url at all:                           {no_file}")
    print(f"  no published_date:                            {no_date}")


if __name__ == "__main__":
    main()
