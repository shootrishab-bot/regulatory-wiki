import concurrent.futures
import logging
import re
from pathlib import Path
from typing import Optional, Tuple

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# REAL, CONFIRMED 2026-08-18: extract_pdf_text's OCR fallback used to call
# convert_from_path(pdf_path) with no dpi cap and no page limit, converting
# every page of the PDF to a raster image in one subprocess call. On a real
# 87-page pre-2015 scanned CCI order (normal A4 page size, nothing malformed
# about the PDF itself -- confirmed via pdfinfo), that produced >1GB of raw
# pixel data read via a single subprocess.py _readerthread .read() call,
# which raised a real MemoryError in that reader thread. Because the thread
# died mid-read rather than draining the pipe, the child pdftoppm process
# blocked forever writing to a full, undrained pipe, and the main thread
# (which runs this synchronously, un-executor-wrapped, directly on the
# asyncio event loop -- see pipeline.py's _extract_content) deadlocked
# waiting on it, hanging the entire batch, not just this one document.
# Fixed with three independent guards: a lower DPI, a hard page cap (8000
# chars is plenty for classification -- OCRing all 87 pages was wasted work
# even before it crashed), and a timeout so a future hang on some other real
# document degrades to one failed extraction instead of blocking the batch.
_OCR_DPI = 150
_MAX_OCR_PAGES = 15
_OCR_TIMEOUT_SECONDS = 90

# Elements that are pure site chrome on cci.gov.in and never part of a document's
# substantive content -- strip these before anything gets converted to Markdown
# or sent to the classifier. This is a token-cost lever, not just tidiness: the
# same nav/footer HTML repeats on every single page.
BOILERPLATE_SELECTORS = [
    "header", "footer", "nav",
    ".sidebar", ".menu", ".breadcrumb", ".navbar",
    ".social-share", ".skip-to-content", ".accessibility-toolbar",
    ".language-switcher", ".search-widget",
]

BOILERPLATE_TEXT_PATTERNS = [
    r"(?im)^\s*government of india\s*$",
    r"(?im)^\s*(A-|A|A\+)\s*$",  # accessibility font-size toggle text
    r"(?im)^\s*EPABX Board Number.*$",
    r"(?im)^\s*FAX Number.*$",
    r"(?is)Copyright.*All rights reserved\.?",
    r"(?im)^\s*(Home|Sitemap|Contact Us|Disclaimer|Privacy Policy|Terms of Use)\s*$",
]


def html_to_clean_markdown(html: str) -> str:
    """Strip known boilerplate, then convert to Markdown. Falls back to plain text
    extraction if the markdownify package isn't available in the environment."""
    soup = BeautifulSoup(html, "html.parser")
    for selector in BOILERPLATE_SELECTORS:
        for el in soup.select(selector):
            el.decompose()

    try:
        import markdownify  # optional dependency, see requirements.txt

        text = markdownify.markdownify(str(soup), heading_style="ATX")
    except ImportError:
        logger.warning("markdownify not installed, falling back to plain text extraction")
        text = soup.get_text(separator="\n")

    for pattern in BOILERPLATE_TEXT_PATTERNS:
        text = re.sub(pattern, "", text)

    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)  # collapse repeated blank lines
    return text.strip()


def extract_pdf_text(pdf_path: Path) -> Tuple[Optional[str], str]:
    """
    Extract text from a PDF, falling back to OCR if direct extraction returns
    (near-)nothing -- common for scanned/image gazette notifications.

    Returns (text_or_None, extraction_method) where extraction_method is one of
    'direct', 'ocr', or 'failed'.
    """
    from .config import Config

    min_chars = Config.MIN_CHARS_FOR_SUCCESSFUL_EXTRACTION

    try:
        from pypdf import PdfReader
    except ImportError:
        from PyPDF2 import PdfReader  # type: ignore

    try:
        text = ""
        reader = PdfReader(str(pdf_path))
        for page in reader.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"
        text = text.strip()

        if len(text) >= min_chars:
            return text, "direct"

        logger.info("Direct extraction returned %d chars (<%d) for %s, trying OCR", len(text), min_chars, pdf_path)
    except Exception as exc:
        logger.warning("Direct PDF extraction failed for %s: %s", pdf_path, exc)

    # OCR fallback
    try:
        import pytesseract
        from pdf2image import convert_from_path, pdfinfo_from_path

        try:
            total_pages = pdfinfo_from_path(str(pdf_path)).get("Pages", _MAX_OCR_PAGES)
        except Exception:
            total_pages = _MAX_OCR_PAGES
        last_page = min(total_pages, _MAX_OCR_PAGES)

        def _run_ocr() -> str:
            images = convert_from_path(str(pdf_path), dpi=_OCR_DPI, first_page=1, last_page=last_page)
            return "\n".join(pytesseract.image_to_string(img) for img in images)

        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = pool.submit(_run_ocr)
        try:
            ocr_text = future.result(timeout=_OCR_TIMEOUT_SECONDS).strip()
        except concurrent.futures.TimeoutError:
            pool.shutdown(wait=False)
            logger.error(
                "OCR timed out after %ds for %s (page 1-%d of %d total) -- "
                "treating as failed rather than risking another batch-wide hang.",
                _OCR_TIMEOUT_SECONDS, pdf_path, last_page, total_pages,
            )
            return None, "failed"
        pool.shutdown(wait=False)

        if len(ocr_text) >= min_chars:
            return ocr_text, "ocr"
        logger.warning("OCR also returned insufficient text (%d chars) for %s", len(ocr_text), pdf_path)
        return (ocr_text or None), "failed"
    except Exception as exc:
        logger.error("OCR extraction failed for %s: %s", pdf_path, exc)
        return None, "failed"


def truncate_for_classification(text: str, max_chars: int) -> str:
    """Titles + first N chars is almost always enough signal for Subject/Instrument
    Type/Status; full Acts/Annual Reports don't need their entire body classified."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[... truncated for classification ...]"
