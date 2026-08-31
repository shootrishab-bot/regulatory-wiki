import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

from . import classifier
from .config import Config
from .database import Database
from .extractor import extract_pdf_text, html_to_clean_markdown, truncate_for_classification
from .scraper import CCIFetcher, ScrapedItem

logger = logging.getLogger(__name__)


async def process_item(
    fetcher: CCIFetcher,
    session: aiohttp.ClientSession,
    config: Config,
    item: ScrapedItem,
) -> Dict[str, Any]:
    """Full pipeline for one scraped item: prefilter -> extract -> classify -> record dict."""

    if not classifier.quick_prefilter(item.title):
        return {
            "id": item.source_id, "title": item.title, "url": item.url,
            "source_url": item.source_url, "source_feed": item.source_feed,
            "date": item.date, "kept": False,
            "classification_method": "dropped_by_prefilter",
            "review_reasons": json.dumps(["Matched a definite-PR pattern in the title"]),
        }

    content, extraction_method, pdf_path, etag, last_modified = await _extract_content(
        fetcher, session, config, item
    )

    result = await classifier.classify(
        session, config, item.title,
        truncate_for_classification(content, config.MAX_CHARS_FOR_CLASSIFICATION) if content else None,
        item.url or "",
    )

    return {
        "id": item.source_id,
        "title": item.title,
        "url": item.url,
        "source_url": item.source_url,
        "source_feed": item.source_feed,
        "date": item.date,
        "kept": result.kept,
        "subject": result.subject,
        "instrument_type": result.instrument_type,
        "status": result.status,
        "classification_confidence": result.confidence,
        "classification_method": result.method,
        "needs_review": result.needs_review,
        "review_reasons": json.dumps(result.review_reasons),
        "rationale": result.rationale,
        "content_excerpt": (content or "")[:2000],
        "pdf_path": str(pdf_path) if pdf_path else None,
        "extraction_method": extraction_method,
        "download_status": "downloaded" if pdf_path else ("no_link" if not item.url else "not_pdf"),
        # Captured from the real download this run just did (no extra
        # request) -- see database.py's own column comments and
        # filter_changed_items() below for what these are for.
        "etag": etag,
        "last_modified": last_modified,
    }


async def _extract_content(
    fetcher: CCIFetcher, session: aiohttp.ClientSession, config: Config, item: ScrapedItem
) -> Tuple[Optional[str], Optional[str], Optional[Path], Optional[str], Optional[str]]:
    if not item.url:
        return None, None, None, None, None

    if item.url.lower().endswith(".pdf"):
        pdf_path = config.DOWNLOAD_DIR / f"{item.source_id}.pdf"
        ok, etag, last_modified = await fetcher.download_pdf(session, item.url, pdf_path)
        if not ok:
            return None, None, None, None, None
        text, method = extract_pdf_text(pdf_path)
        return text, method, pdf_path, etag, last_modified

    html = await fetcher.fetch_html(session, item.url)
    if not html:
        return None, None, None, None, None
    return html_to_clean_markdown(html), "html", None, None, None


async def filter_changed_items(
    fetcher: CCIFetcher, session: aiohttp.ClientSession, db: Database, items: List[ScrapedItem]
) -> Tuple[List[ScrapedItem], int]:
    """
    Incremental pre-filter, run BEFORE process_batch: for every item whose
    source_id is already in the database, do a cheap HEAD request against its
    PDF and compare the real ETag/Last-Modified against what's stored,
    skipping the expensive download+OCR+classify pipeline entirely when
    nothing has actually changed.

    WHY THIS EXISTS: a real live diagnostic run (2026-08-25, see
    ../taxonomy-findings-v2.md-adjacent sync investigation) confirmed
    `run_scrape()` re-downloads, re-OCRs, and re-classifies all ~1,324 real
    documents on every single call, with nothing checking what's already
    known -- a full run took ~48.5 minutes and exceeded lib/sync.ts's
    SCRAPE_TIMEOUT_MS, and every run was re-paying real DeepSeek cost to
    reclassify documents that had not changed at all since the previous run.

    WHAT COUNTS AS "CHANGED", stated explicitly per this function's own
    design brief rather than assumed: a document's `source_id` is
    sha1(regulator|source_url|title) (source_id.py) -- it does NOT change
    just because the underlying PDF at the same URL was replaced (e.g. a
    corrigendum uploaded over the original file, or -- CCI's real, confirmed
    case, see taxonomy-findings.md's Status rules -- an Order later marked
    under appeal). Neither `date` nor `title` in ScrapedItem is a reliable
    signal for that: `date` is the document's own fixed order/publication
    date, not a "last modified" timestamp, and confirmed live 2026-08-25 that
    cci.gov.in's real file server (not the documents' own content) serves
    real, stable ETag/Last-Modified headers on every PDF -- a HEAD request
    against the same URL this item already links to is the actual signal
    used here, not a guess from listing-page metadata.

    LIMITATION, stated rather than silently assumed: items with no PDF `url`
    (currently only the homepage feed, ~36 of ~1,324 real items -- 2.7% of
    the corpus) have no cheap file-level signal available from cci.gov.in's
    own listing pages at all. There is nothing here to compare against
    without re-fetching and re-parsing the HTML itself, which is most of the
    cost this filter exists to avoid in the first place. These always go
    through the full pipeline; accepted given how small that population is
    relative to the ~92% of the corpus (antitrust order PDFs) this fix
    actually targets.

    A document whose source_id is not yet in the database at all is always
    new -- always goes through the full pipeline, same as before this
    function existed.

    HEAD checks run concurrently (bounded by config.HEAD_CHECK_CONCURRENCY),
    not one-at-a-time -- see that field's own comment in config.py for why a
    sequential pass through the shared download rate limiter would itself
    take ~44 minutes across the real corpus, erasing most of the point of
    skipping the expensive pipeline.
    """
    to_process: List[ScrapedItem] = []
    skipped = 0

    # Cheap, synchronous DB lookups first -- splits out anything that can be
    # decided without a network call at all (new items, non-PDF items) from
    # the set that actually needs a concurrent HEAD check.
    needs_check: List[Tuple[ScrapedItem, Dict[str, Any]]] = []
    for item in items:
        existing = db.get_document(item.source_id)
        if existing is None:
            to_process.append(item)
        elif not item.url or not item.url.lower().endswith(".pdf"):
            # No cheap fingerprint possible -- see docstring's LIMITATION note.
            to_process.append(item)
        else:
            needs_check.append((item, existing))

    semaphore = asyncio.Semaphore(fetcher.config.HEAD_CHECK_CONCURRENCY)

    async def check_one(item: ScrapedItem, existing: Dict[str, Any]):
        async with semaphore:
            fingerprint = await fetcher.head_fingerprint(session, item.url)
        return item, existing, fingerprint

    results = await asyncio.gather(*(check_one(item, existing) for item, existing in needs_check))

    for item, existing, fingerprint in results:
        if fingerprint is None:
            # HEAD failed for any reason -- fail open toward reprocessing,
            # not toward silently trusting stale data.
            to_process.append(item)
            continue

        etag, last_modified = fingerprint
        stored_etag = existing.get("etag")
        stored_last_modified = existing.get("last_modified")

        unchanged = (stored_etag is not None and stored_etag == etag) or (
            stored_last_modified is not None and stored_last_modified == last_modified
        )

        if unchanged:
            db.touch_checked(item.source_id, etag=etag, last_modified=last_modified)
            skipped += 1
        else:
            # Either genuinely changed, or this row predates fingerprint
            # tracking (stored_etag/stored_last_modified both still None,
            # e.g. every real row already in the database before this
            # feature existed) -- reprocess once so a real fingerprint gets
            # captured, rather than guessing "unchanged" with no evidence.
            to_process.append(item)

    return to_process, skipped


async def process_batch(
    config: Config, items: List[ScrapedItem], concurrency: int = 4
) -> List[Dict[str, Any]]:
    """Runs process_item over a batch with bounded concurrency -- be polite to
    both cci.gov.in (via CCIFetcher's rate limiter) and the DeepSeek API."""
    fetcher = CCIFetcher(config)
    semaphore = asyncio.Semaphore(concurrency)

    async with aiohttp.ClientSession() as session:

        async def bounded(item: ScrapedItem):
            async with semaphore:
                try:
                    return await process_item(fetcher, session, config, item)
                except Exception as exc:
                    logger.error("Pipeline failed for %r: %s", item.title[:80], exc)
                    return {
                        "id": item.source_id, "title": item.title, "url": item.url,
                        "source_url": item.source_url, "source_feed": item.source_feed,
                        "date": item.date, "kept": True,
                        "classification_method": "error_fallback",
                        "needs_review": True,
                        "review_reasons": json.dumps([f"Pipeline exception: {exc}"]),
                    }

        return list(await asyncio.gather(*(bounded(i) for i in items)))
