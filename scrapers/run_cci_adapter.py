"""
Daily-sync adapter entrypoint for CCI. Reads the cci_scraper package's own
SQLite database (written by run_cci_scrape.py, via the real `scrape`
command) and writes the wiki's shared NormalizedDocument JSON contract --
the same mapping cci_scraper/normalize.py used for the one-off
test-sample-stratified ingestion, just reading from SQLite instead of a
fixed JSON snapshot, so this reflects whatever the most recent live scrape
actually found rather than a frozen sample.

Only kept=1 rows are carried through -- "kept": false means the pipeline's
own prefilter/classifier decided to drop it (pure PR/event content with
nothing to tag), same convention as every other regulator's adapter.

Deliberately does NOT carry over subject/instrument_type/status from
SQLite. Those come from cci_scraper's OWN classifier.py prompt, not
lib/ingest.ts's -- see cci_scraper/normalize.py's docstring for the real,
confirmed bug this avoided (23 tender documents wrongly tagged "Not
Applicable" by that prompt). lib/sync.ts's ingestBatch() re-classifies every
document fresh against the Postgres-seeded taxonomy (prisma/seed-cci.ts),
exactly like the one-off ingestion did.

Run with (matches every other regulator's adapter invocation):
    python run_cci_adapter.py
Reads cci_scraper/data/cci/cci_scraper.db
Writes data/cci_normalized.json
"""

import json
import os
import sqlite3

SCRAPERS_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRAPERS_DIR, "cci_scraper", "data", "cci", "cci_scraper.db")
OUTPUT_JSON = os.path.join(SCRAPERS_DIR, "data", "cci_normalized.json")

REGULATOR_CODE = "CCI"


def to_iso_date(date_str):
    """CCI's own scraper writes dates as DD/MM/YYYY (confirmed via a real
    record: "10/09/2024" next to body text reading "10th day of September,
    2024" -- DD/MM, not MM/DD)."""
    if not date_str:
        return None
    parts = date_str.split("/")
    if len(parts) != 3:
        return None
    dd, mm, yyyy = parts
    if not (dd.isdigit() and mm.isdigit() and yyyy.isdigit()):
        return None
    return f"{yyyy}-{mm.zfill(2)}-{dd.zfill(2)}"


def normalize_row(row: dict) -> dict:
    content_excerpt = (row.get("content_excerpt") or "").strip()
    extraction_failed = not content_excerpt

    return {
        "regulator_code": REGULATOR_CODE,
        "source_id": row["id"],
        "title": row.get("title") or "",
        "source_url": row.get("source_url") or row.get("url") or "",
        "published_date": to_iso_date(row.get("date")),
        "file_url": row.get("url") or None,
        "file_extension_hint": "pdf" if row.get("download_status") == "downloaded" else None,
        "category_hint": row.get("source_feed"),
        "status_hint": None,  # see module docstring -- CCI's own precomputed
                               # status is a model guess from a different,
                               # since-found-buggy prompt, not source-site
                               # ground truth
        "raw_text": content_excerpt or None,
        "raw_text_source": "pdf_excerpt" if content_excerpt else None,
        "needs_download": False,
        "scraped_at": row.get("ingested_at"),
        "extraction_failed": bool(extraction_failed),
    }


def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit(
            f"No CCI SQLite database found at {DB_PATH} -- run run_cci_scrape.py first."
        )

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM documents WHERE kept = 1").fetchall()]
    total_rows = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    conn.close()

    docs = [normalize_row(r) for r in rows]

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(docs, f, indent=2, ensure_ascii=False)

    no_text = sum(1 for d in docs if d["extraction_failed"])
    print(f"Read {total_rows} rows in SQLite ({len(rows)} kept, {total_rows - len(rows)} dropped).")
    print(f"Wrote {len(docs)} normalized documents to {OUTPUT_JSON}")
    print(f"  {no_text} flagged extraction_failed (no extractable text).")


if __name__ == "__main__":
    main()
