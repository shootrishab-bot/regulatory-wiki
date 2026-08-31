"""
Converts the CCI taxonomy-pressure-test output (output/test-sample-stratified-
*.json -- 303 real documents, 295 kept, sampled+classified by this package's
OWN standalone classifier.py/SQLite pipeline) into the wiki's shared
NormalizedDocument JSON contract, for ingestion through the same
lib/ingest.ts pipeline every other regulator uses.

Deliberately does NOT carry over subject/instrument_type/status from the
source file. Those were produced by a DIFFERENT prompt (classifier.py's own,
not lib/ingest.ts's) and taxonomy-findings-v2.md found a real, confirmed bug
in that prompt's Status handling (23 tender/procurement documents wrongly
tagged "Not Applicable"). lib/ingest.ts re-classifies every document fresh
against the same taxonomy (seeded by seed-cci.ts, which encodes the fix
directly in the "Not Applicable" tag's definition) -- so this script only
carries over real, source-derived fields (title, URLs, date, extracted
text), not the old classification.

Only "kept": true records are carried through -- "kept": false means the
pressure-test's own prefilter/classifier decided to drop it (pure PR/event
content with nothing to tag), same convention as every other regulator's
adapter.

Date format: CCI's own scraper writes dates as "DD/MM/YYYY" (confirmed via
a real record: "10/09/2024" next to body text reading "10th day of
September, 2024" -- DD/MM, not MM/DD). Converted to ISO 8601 here.

Usage:
    python normalize.py
Writes ../data/cci_normalized.json (matches the scrapers/data/<code>_normalized.json
convention every other regulator's run_<code>_adapter.py uses).
"""

import json
import hashlib
from pathlib import Path

SOURCE_FILE = Path(__file__).parent / "output" / "test-sample-stratified-20260819T113135.json"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "cci_normalized.json"

REGULATOR_CODE = "CCI"


def to_iso_date(date_str: str | None) -> str | None:
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
    # Real gap found in the source data: 1 kept record ("Notice inviting
    # tender for Provision of Electrical Maintenance...") has no extractable
    # text at all (download_status "not_pdf", extraction_method null) --
    # flagged here so it routes to needs_review instead of being silently
    # classified from its title alone.
    extraction_failed = row.get("kept") and not content_excerpt

    return {
        "regulator_code": REGULATOR_CODE,
        "source_id": row["id"],
        "title": row.get("title", ""),
        "source_url": row.get("source_url") or row.get("url") or "",
        "published_date": to_iso_date(row.get("date")),
        "file_url": row.get("url") or None,
        "file_extension_hint": "pdf" if row.get("download_status") == "downloaded" else None,
        "category_hint": row.get("source_feed"),
        "status_hint": None,  # CCI's own precomputed "status" is a MODEL guess
                               # from a different, since-found-buggy prompt --
                               # not source-site ground truth, so it doesn't
                               # qualify as a status_hint (see module docstring).
        "raw_text": content_excerpt or None,
        "raw_text_source": "pdf_excerpt" if content_excerpt else None,
        "needs_download": False,  # raw_text already present when non-empty;
                                    # the one exception is flagged via
                                    # extraction_failed instead of triggering
                                    # a live re-fetch.
        "scraped_at": None,
        "extraction_failed": bool(extraction_failed),
    }


def main():
    rows = json.loads(SOURCE_FILE.read_text(encoding="utf-8"))
    kept = [r for r in rows if r.get("kept")]
    docs = [normalize_row(r) for r in kept]

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(docs, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Read {len(rows)} rows ({len(kept)} kept, {len(rows) - len(kept)} dropped).")
    print(f"Wrote {len(docs)} normalized documents to {OUTPUT_FILE}")
    no_text = sum(1 for d in docs if d["extraction_failed"])
    print(f"  {no_text} flagged extraction_failed (no extractable text).")


if __name__ == "__main__":
    main()
