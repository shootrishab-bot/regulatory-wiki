"""
Daily-sync adapter entrypoint for FIU-IND. Reads the fiu_scraper package's own
SQLite database (written by run_fiu_scrape.py, via the real `scrape` command)
and writes the wiki's shared NormalizedDocument JSON contract -- same
relationship run_cci_adapter.py has to cci_scraper's SQLite database.

REPLACES the legacy fiu_adapter.py, which read a master CSV that
fiu_watcher.py wrote (a single page's top-10 items, no taxonomy). This chose
option (b) from the build brief -- read fiu_scraper's SQLite directly rather
than have the new scraper's CLI export a CSV in the legacy shape -- for the
same reason CCI's adapter did: it preserves classification_method,
needs_review, and rationale, which a CSV round-trip would lose, and there is
no longer a legacy CSV consumer to stay compatible with once fiu_watcher.py
is removed.

Only kept=1 rows are carried through -- "kept": false means fiu_scraper's own
prefilter/classifier decided to drop it (pure courtesy/ceremonial content with
nothing to tag), same convention as every other regulator's adapter.

Deliberately does NOT carry over subject/instrument_type from SQLite as
status_hint/category_hint overrides of ground truth -- those come from
fiu_scraper's OWN classifier.py prompt, not lib/ingest.ts's. lib/sync.ts's
ingestBatch() re-classifies every document fresh against the Postgres-seeded
taxonomy (prisma/seed-fiu.ts), exactly like CCI's adapter does -- see
run_cci_adapter.py's own docstring for the real, confirmed bug (23 CCI tender
documents wrongly tagged) that this convention avoids repeating.

Run with (matches every other regulator's adapter invocation):
    python run_fiu_adapter.py
Reads fiu_scraper/data/fiu/fiu_scraper.db
Writes data/fiu_normalized.json
"""

import json
import os
import sqlite3

SCRAPERS_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRAPERS_DIR, "fiu_scraper", "data", "fiu", "fiu_scraper.db")
OUTPUT_JSON = os.path.join(SCRAPERS_DIR, "data", "fiu_normalized.json")

REGULATOR_CODE = "FIU"


def normalize_row(row: dict) -> dict:
    content_excerpt = (row.get("content_excerpt") or "").strip()
    extraction_failed = not content_excerpt

    return {
        "regulator_code": REGULATOR_CODE,
        "source_id": row["id"],
        "title": row.get("title") or "",
        "source_url": row.get("source_url") or row.get("url") or "",
        # fiu_scraper's own scraper.py already normalizes every real date
        # format (ordinal, dotted, "as on"/"dated" free text) to ISO at scrape
        # time -- see scraper.py's parse_date_to_iso() -- so `date` here is
        # already ISO or None, no further parsing needed.
        "published_date": row.get("date"),
        "file_url": row.get("url") or None,
        "file_extension_hint": "pdf" if row.get("download_status") == "downloaded" else None,
        "category_hint": row.get("source_feed"),
        "status_hint": None,  # see module docstring -- not source-site ground truth
        "raw_text": content_excerpt or None,
        "raw_text_source": "pdf_excerpt" if content_excerpt else None,
        "needs_download": False,
        "scraped_at": row.get("ingested_at"),
        "extraction_failed": bool(extraction_failed),
    }


def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit(
            f"No FIU-IND SQLite database found at {DB_PATH} -- run run_fiu_scrape.py first."
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
