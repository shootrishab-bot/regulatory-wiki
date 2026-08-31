import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


class Database:
    """SQLite database for storing scraped documents, change history, and scrape
    runs. Identical shape to cci_scraper/database.py -- same documents/
    change_log/scrape_runs tables, same save_document() change-tracking logic --
    just defaulting `regulator` to 'FIU' instead of 'CCI'."""

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
                    regulator TEXT NOT NULL DEFAULT 'FIU',
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
                    is_new_penalty_order INTEGER DEFAULT 0,  -- 1 if this row's
                                    -- first-ever save had instrument_type ==
                                    -- 'Adjudication / Penalty Order' -- see
                                    -- alerts.py's own docstring for why this
                                    -- is tracked as a fact about the INSERT,
                                    -- not recomputed later from the current row
                    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_checked TIMESTAMP
                )
                """
            )
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
                    error_message TEXT
                )
                """
            )
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
        """Insert or update a document, logging any change to subject/instrument_type/
        status/kept. On a genuinely new row, also records whether it's a fresh
        Adjudication/Penalty Order -- alerts.py reads this to raise a new-penalty
        alert regardless of whether anything about the document later changes,
        which a change_log-only signal (CCI's own alerting) could never catch,
        since a brand-new row has no prior value to diff against."""
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            existing = self.get_document(doc["id"])
            is_new = existing is None
            is_new_penalty_order = is_new and doc.get("instrument_type") == "Adjudication / Penalty Order"

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
            )

            if existing:
                cur.execute(
                    """
                    UPDATE documents SET
                        title=?, url=?, date=?, subject=?, instrument_type=?, status=?,
                        classification_confidence=?, classification_method=?, needs_review=?,
                        review_reasons=?, rationale=?, kept=?, content_excerpt=?, pdf_path=?,
                        extraction_method=?, download_status=?, last_checked=CURRENT_TIMESTAMP
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
                        is_new_penalty_order, ingested_at, last_checked
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """,
                    (
                        doc["id"], doc["title"], doc.get("url"), doc["source_url"],
                        doc.get("source_feed"), doc.get("regulator", "FIU"),
                    ) + fields[2:] + (1 if is_new_penalty_order else 0,),
                )
            conn.commit()
            return True

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

    def get_new_penalty_orders(self, since: datetime) -> List[Dict[str, Any]]:
        """Used by the watcher/alerter: documents newly INSERTED (not merely
        updated) since `since` whose Instrument Type was Adjudication / Penalty
        Order at that first save -- the priority alert signal for FIU-IND, see
        alerts.py's docstring."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT * FROM documents
                WHERE is_new_penalty_order = 1 AND ingested_at >= ?
                ORDER BY ingested_at DESC
                """,
                (since.isoformat(),),
            ).fetchall()
            return [dict(r) for r in rows]

    def record_scrape_run(self, **kwargs) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO scrape_runs (
                    run_id, started_at, completed_at, mode, status,
                    items_found, items_new, items_updated, items_dropped,
                    items_needs_review, error_message
                ) VALUES (:run_id, :started_at, :completed_at, :mode, :status,
                          :items_found, :items_new, :items_updated, :items_dropped,
                          :items_needs_review, :error_message)
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
