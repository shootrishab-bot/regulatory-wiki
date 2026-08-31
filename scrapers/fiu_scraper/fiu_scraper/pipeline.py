import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from . import classifier
from .config import Config
from .extractor import extract_pdf_text, html_to_clean_markdown, truncate_for_classification
from .scraper import FIUFetcher, ScrapedItem

logger = logging.getLogger(__name__)


async def process_item(
    fetcher: FIUFetcher,
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
            "review_reasons": json.dumps(["Matched a definite pure-courtesy pattern in the title"]),
        }

    content, extraction_method, pdf_path = await _extract_content(fetcher, session, config, item)

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
    }


async def _extract_content(
    fetcher: FIUFetcher, session: aiohttp.ClientSession, config: Config, item: ScrapedItem
) -> tuple[Optional[str], Optional[str], Optional[Path]]:
    if not item.url:
        return None, None, None

    # CONFIRMED live 2026-08-25 (real test-sample run, 4/518 records): the
    # naive "not .pdf -> try to fetch and decode as HTML" branch below raised
    # on two genuinely different real cases -- a `javascript:openurl(...)`
    # pseudo-link (Careers' "National Career Services" row links out via a JS
    # popup, not a real fetchable URL) and two binary Office files (.doc/.xls
    # -- a Non-Disclosure Undertaking template and an FCRA-registered-NGO
    # list) that aren't valid UTF-8 HTML. Both degrade to title-only
    # classification here rather than raising a pipeline exception that
    # pipeline.py's own error_fallback catch-all would otherwise mask as a
    # generic failure instead of an explained one.
    lower_url = item.url.lower()
    if not lower_url.startswith(("http://", "https://")):
        return None, None, None
    if lower_url.endswith((".doc", ".docx", ".xls", ".xlsx")):
        return None, None, None

    if lower_url.endswith(".pdf"):
        pdf_path = config.DOWNLOAD_DIR / f"{item.source_id}.pdf"
        ok = await fetcher.download_pdf(session, item.url, pdf_path)
        if not ok:
            return None, None, None
        text, method = extract_pdf_text(pdf_path)
        return text, method, pdf_path

    html = await fetcher.fetch_html(session, item.url)
    if not html:
        return None, None, None
    return html_to_clean_markdown(html), "html", None


async def process_batch(
    config: Config, items: List[ScrapedItem], concurrency: int = 4
) -> List[Dict[str, Any]]:
    """Runs process_item over a batch with bounded concurrency -- be polite to
    both fiuindia.gov.in (via FIUFetcher's rate limiter) and the DeepSeek API."""
    fetcher = FIUFetcher(config)
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
