import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


class Database:
    """SQLite database for storing scraped documents, change history, and scrape runs."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    url TEXT,
                    source_url TEXT NOT NULL,
                    source_feed TEXT,
                    regulator TEXT NOT NULL DEFAULT 'CCI',
                    date TEXT,
                    subject TEXT,
                    instrument_type TEXT,
                    status TEXT,
                    classification_confidence REAL,
                    classification_method TEXT,      -- 'ai' | 'error_fallback' | 'dropped_by_prefilter'
                    needs_review INTEGER DEFAULT 0,
                    review_reasons TEXT,               -- JSON array, human-readable reasons
                    rationale TEXT,                     -- model's one-line justification
                    kept INTEGER DEFAULT 1,             -- 0 if the pipeline decided to drop it (pure PR etc.)
                    content_excerpt TEXT,                -- Markdown/cleaned text actually sent to classifier
                    pdf_path TEXT,
                    extraction_method TEXT,               -- 'direct' | 'ocr' | 'html' | null
                    download_status TEXT,
                    etag TEXT,             -- HTTP ETag from the last real download/HEAD of `url`,
                                            -- used by pipeline.py's filter_changed_items() to skip
                                            -- re-downloading+re-OCRing+re-classifying an unchanged
                                            -- PDF on a re-scrape -- see that function's own docstring
                    last_modified TEXT,    -- HTTP Last-Modified, same purpose as etag (either
                                            -- matching is treated as "unchanged"; a static file
                                            -- server may only reliably send one of the two)
                    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_checked TIMESTAMP
                )
                """
            )
            # Lightweight migration for a database created before etag/last_modified
            # existed -- SQLite has no "ADD COLUMN IF NOT EXISTS", so the duplicate-
            # column error (which is exactly what a database that already has
            # these columns raises) is the expected, swallowed case, not a real
            # failure. Runs on every Database() construction; harmless no-op once
            # the columns exist.
            for column_sql in ("ALTER TABLE documents ADD COLUMN etag TEXT",
                                "ALTER TABLE documents ADD COLUMN last_modified TEXT"):
                try:
                    cur.execute(column_sql)
                except sqlite3.OperationalError as exc:
                    if "duplicate column name" not in str(exc):
                        raise
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS change_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id TEXT,
                    field_changed TEXT,
                    old_value TEXT,
                    new_value TEXT,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (document_id) REFERENCES documents(id)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scrape_runs (
                    run_id TEXT PRIMARY KEY,
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    mode TEXT,               -- 'scrape' | 'watch' | 'test_sample'
                    status TEXT,
                    items_found INTEGER,
                    items_new INTEGER,
                    items_updated INTEGER,
                    items_dropped INTEGER,
                    items_needs_review INTEGER,
                    items_skipped_unchanged INTEGER,  -- filtered out by filter_changed_items()
                                                       -- before the expensive pipeline ran at all --
                                                       -- see pipeline.py's own docstring
                    error_message TEXT
                )
                """
            )
            try:
                cur.execute("ALTER TABLE scrape_runs ADD COLUMN items_skipped_unchanged INTEGER")
            except sqlite3.OperationalError as exc:
                if "duplicate column name" not in str(exc):
                    raise
            cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_subject ON documents(subject)")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_documents_instrument ON documents(instrument_type)"
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_documents_needs_review ON documents(needs_review)"
            )
            conn.commit()

    def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            return dict(row) if row else None

    def save_document(self, doc: Dict[str, Any]) -> bool:
        """Insert or update a document, logging any change to subject/instrument_type/status/kept."""
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            existing = self.get_document(doc["id"])

            fields = (
                doc["title"],
                doc.get("url"),
                doc.get("date"),
                doc.get("subject"),
                doc.get("instrument_type"),
                doc.get("status"),
                doc.get("classification_confidence"),
                doc.get("classification_method"),
                1 if doc.get("needs_review") else 0,
                doc.get("review_reasons"),
                doc.get("rationale"),
                1 if doc.get("kept", True) else 0,
                doc.get("content_excerpt"),
                doc.get("pdf_path"),
                doc.get("extraction_method"),
                doc.get("download_status"),
                doc.get("etag"),
                doc.get("last_modified"),
            )

            if existing:
                cur.execute(
                    """
                    UPDATE documents SET
                        title=?, url=?, date=?, subject=?, instrument_type=?, status=?,
                        classification_confidence=?, classification_method=?, needs_review=?,
                        review_reasons=?, rationale=?, kept=?, content_excerpt=?, pdf_path=?,
                        extraction_method=?, download_status=?, etag=?, last_modified=?,
                        last_checked=CURRENT_TIMESTAMP
                    WHERE id=?
                    """,
                    fields + (doc["id"],),
                )
                for tracked_field in ("subject", "instrument_type", "status", "kept"):
                    old_val = existing.get(tracked_field)
                    new_val = doc.get(tracked_field)
                    if tracked_field == "kept":
                        old_val, new_val = existing.get("kept"), (1 if doc.get("kept", True) else 0)
                    if old_val != new_val:
                        cur.execute(
                            """INSERT INTO change_log (document_id, field_changed, old_value, new_value)
                               VALUES (?, ?, ?, ?)""",
                            (doc["id"], tracked_field, str(old_val), str(new_val)),
                        )
            else:
                cur.execute(
                    """
                    INSERT INTO documents (
                        id, title, url, source_url, source_feed, regulator, date,
                        subject, instrument_type, status, classification_confidence,
                        classification_method, needs_review, review_reasons, rationale,
                        kept, content_excerpt, pdf_path, extraction_method, download_status,
                        etag, last_modified, ingested_at, last_checked
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """,
                    (
                        doc["id"], doc["title"], doc.get("url"), doc["source_url"],
                        doc.get("source_feed"), doc.get("regulator", "CCI"),
                    ) + fields[2:],
                )
            conn.commit()
            return True

    def touch_checked(self, doc_id: str, etag: Optional[str] = None, last_modified: Optional[str] = None) -> None:
        """Records that a document was re-checked and confirmed unchanged (or
        backfills its fingerprint for the first time), WITHOUT touching its
        classification data or writing a change_log entry -- the lightweight
        sibling of save_document() for pipeline.py's filter_changed_items()
        skip path. Deliberately a plain UPDATE, not save_document(), so a
        confirmed-unchanged document's real classification is never at risk
        of being clobbered by this cheap check alone."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE documents SET etag = ?, last_modified = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?",
                (etag, last_modified, doc_id),
            )
            conn.commit()

    def get_documents_with_status_change(self, since: datetime) -> List[Dict[str, Any]]:
        """Used by the watcher/alerter: documents whose Status field changed since `since`."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT DISTINCT d.*, cl.old_value AS status_old_value, cl.new_value AS status_new_value,
                       cl.changed_at AS status_changed_at
                FROM documents d
                JOIN change_log cl ON d.id = cl.document_id
                WHERE cl.field_changed = 'status' AND cl.changed_at >= ?
                ORDER BY cl.changed_at DESC
                """,
                (since.isoformat(),),
            ).fetchall()
            return [dict(r) for r in rows]

    def record_scrape_run(self, **kwargs) -> None:
        kwargs.setdefault("items_skipped_unchanged", None)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO scrape_runs (
                    run_id, started_at, completed_at, mode, status,
                    items_found, items_new, items_updated, items_dropped,
                    items_needs_review, items_skipped_unchanged, error_message
                ) VALUES (:run_id, :started_at, :completed_at, :mode, :status,
                          :items_found, :items_new, :items_updated, :items_dropped,
                          :items_needs_review, :items_skipped_unchanged, :error_message)
                """,
                kwargs,
            )
            conn.commit()

    def get_stats(self) -> Dict[str, Any]:
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            total = cur.execute("SELECT COUNT(*) FROM documents WHERE kept = 1").fetchone()[0]
            dropped = cur.execute("SELECT COUNT(*) FROM documents WHERE kept = 0").fetchone()[0]
            by_subject = dict(
                cur.execute(
                    "SELECT subject, COUNT(*) FROM documents WHERE kept=1 GROUP BY subject"
                ).fetchall()
            )
            by_instrument = dict(
                cur.execute(
                    "SELECT instrument_type, COUNT(*) FROM documents WHERE kept=1 GROUP BY instrument_type"
                ).fetchall()
            )
            by_status = dict(
                cur.execute(
                    "SELECT status, COUNT(*) FROM documents WHERE kept=1 GROUP BY status"
                ).fetchall()
            )
            by_method = dict(
                cur.execute(
                    "SELECT classification_method, COUNT(*) FROM documents GROUP BY classification_method"
                ).fetchall()
            )
            needs_review = cur.execute(
                "SELECT COUNT(*) FROM documents WHERE needs_review = 1"
            ).fetchone()[0]
            return {
                "total_kept": total,
                "total_dropped": dropped,
                "needs_review": needs_review,
                "needs_review_pct": round(100 * needs_review / total, 1) if total else 0.0,
                "by_subject": by_subject,
                "by_instrument": by_instrument,
                "by_status": by_status,
                "by_classification_method": by_method,
            }
