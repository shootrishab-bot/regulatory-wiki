"""
Handles the two AJAX-driven search pages (Antitrust Orders, Combination
Notifications) that showed a real "Processing..." loading state during
taxonomy research -- a strong signal there's a JSON API underneath the form
that the page's own JS calls, which would be far cheaper and more reliable to
hit directly than driving a headless browser on every scrape.

Strategy, in order:
  1. API DISCOVERY (this module's main job): load the real page in a real
     browser via Playwright, listen for every network response, submit the
     search form with a broad default filter (e.g. no filters / widest date
     range), and inspect what comes back. If a JSON response matching a
     document-list shape is found, log it to config.DISCOVERY_LOG_PATH and
     use it directly on subsequent runs -- one HTTP request, no browser.
  2. DOM FALLBACK: if no JSON API is found (e.g. the site renders results
     server-side into the same page via a full form POST), fall back to
     driving the actual form with Playwright and scraping the rendered
     results table.

NEITHER PATH HAS BEEN VERIFIED AGAINST THE LIVE SITE from this environment --
this sandbox has no network route to cci.gov.in. Run `discover` (see cli.py)
first and read the discovery log before trusting either path in production.
Do not guess at date-input or submit-button selectors beyond what's here;
inspect the real DOM if the generic selectors below don't find anything, and
update SEARCH_FORM_SELECTORS accordingly rather than adding more guesses.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .config import Config

logger = logging.getLogger(__name__)

# Best-effort, generic selectors. Verify against the real DOM before relying
# on these -- see the module docstring.
SEARCH_FORM_SELECTORS = {
    "date_inputs": 'input[type="date"], input[name*="date" i], input[id*="date" i]',
    "submit_button": 'button[type="submit"], input[type="submit"], button:has-text("Search")',
    "results_container": "table tbody tr, .result-item, .order-item, .search-result",
}

# A response is a plausible "document list API" candidate if its JSON body is
# a list, or an object containing a list under a common key, of length >= 2
# with dict items that look like they have title/date/link-shaped fields.
_LIKELY_LIST_KEYS = ("data", "results", "items", "orders", "notifications", "records")
_LIKELY_TITLE_KEYS = ("title", "name", "caseTitle", "case_title", "subject", "orderTitle")


@dataclass
class DiscoveredEndpoint:
    url: str
    method: str
    request_payload: Optional[Dict[str, Any]]
    response_shape_sample: Any
    confidence: str  # 'high' | 'medium' | 'low'


@dataclass
class DiscoveryReport:
    page_url: str
    endpoints_found: List[DiscoveredEndpoint] = field(default_factory=list)
    fallback_required: bool = True
    notes: str = ""


def _looks_like_document_list(body: Any) -> str:
    """Returns 'high' | 'medium' | 'low' confidence that this JSON body is a document list."""
    candidates = []
    if isinstance(body, list):
        candidates = body
    elif isinstance(body, dict):
        for key in _LIKELY_LIST_KEYS:
            if isinstance(body.get(key), list):
                candidates = body[key]
                break

    if len(candidates) < 2 or not isinstance(candidates[0], dict):
        return "low"

    sample = candidates[0]
    has_title_field = any(k in sample for k in _LIKELY_TITLE_KEYS)
    has_date_field = any("date" in k.lower() for k in sample.keys())
    if has_title_field and has_date_field:
        return "high"
    if has_title_field or has_date_field:
        return "medium"
    return "low"


async def discover_api(config: Config, page_url: str) -> DiscoveryReport:
    """
    Loads `page_url` in a real headless browser, submits the search form with
    the widest reasonable filter, and inspects every JSON network response for
    something that looks like the document list the form is populating.

    Requires the `playwright` package and `playwright install chromium` to have
    been run. Writes findings to config.DISCOVERY_LOG_PATH regardless of outcome
    so a failed discovery run is still visible, not silent.
    """
    from playwright.async_api import async_playwright

    report = DiscoveryReport(page_url=page_url)
    captured: List[DiscoveredEndpoint] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()

        async def on_response(response):
            try:
                content_type = response.headers.get("content-type", "")
                if "application/json" not in content_type:
                    return
                body = await response.json()
                confidence = _looks_like_document_list(body)
                if confidence in ("high", "medium"):
                    captured.append(
                        DiscoveredEndpoint(
                            url=response.url,
                            method=response.request.method,
                            request_payload=_safe_post_data(response.request),
                            response_shape_sample=_truncate_sample(body),
                            confidence=confidence,
                        )
                    )
            except Exception:
                pass  # non-JSON or unreadable response; not a candidate

        page.on("response", on_response)

        try:
            await page.goto(page_url, wait_until="networkidle", timeout=config.REQUEST_TIMEOUT * 1000)

            date_inputs = await page.query_selector_all(SEARCH_FORM_SELECTORS["date_inputs"])
            if len(date_inputs) >= 2:
                # Widest reasonable range -- last 5 years -- to maximise the chance
                # of a non-empty result set that reveals the response shape.
                await date_inputs[0].fill("2021-01-01")
                await date_inputs[-1].fill("2026-12-31")

            submit = await page.query_selector(SEARCH_FORM_SELECTORS["submit_button"])
            if submit:
                await submit.click()
                await page.wait_for_load_state("networkidle", timeout=config.REQUEST_TIMEOUT * 1000)
            else:
                report.notes += "No submit button found with generic selectors; form may not have been submitted. "

        except Exception as exc:
            report.notes += f"Error during discovery navigation: {exc}. "
        finally:
            await browser.close()

    captured.sort(key=lambda e: {"high": 0, "medium": 1, "low": 2}[e.confidence])
    report.endpoints_found = captured
    report.fallback_required = not any(e.confidence == "high" for e in captured)

    _write_discovery_log(config, report)
    return report


def _safe_post_data(request) -> Optional[Dict[str, Any]]:
    try:
        data = request.post_data
        if data:
            try:
                return json.loads(data)
            except json.JSONDecodeError:
                return {"raw": data[:500]}
    except Exception:
        pass
    return None


def _truncate_sample(body: Any, max_items: int = 2) -> Any:
    if isinstance(body, list):
        return body[:max_items]
    if isinstance(body, dict):
        out = {}
        for k, v in body.items():
            out[k] = v[:max_items] if isinstance(v, list) else v
        return out
    return body


def _write_discovery_log(config: Config, report: DiscoveryReport) -> None:
    existing: Dict[str, Any] = {}
    if config.DISCOVERY_LOG_PATH.exists():
        try:
            existing = json.loads(config.DISCOVERY_LOG_PATH.read_text())
        except Exception:
            existing = {}

    existing[report.page_url] = {
        "fallback_required": report.fallback_required,
        "notes": report.notes,
        "endpoints_found": [
            {
                "url": e.url,
                "method": e.method,
                "request_payload": e.request_payload,
                "response_shape_sample": e.response_shape_sample,
                "confidence": e.confidence,
            }
            for e in report.endpoints_found
        ],
    }
    config.DISCOVERY_LOG_PATH.write_text(json.dumps(existing, indent=2, default=str))
    logger.info("Wrote API discovery report to %s", config.DISCOVERY_LOG_PATH)
