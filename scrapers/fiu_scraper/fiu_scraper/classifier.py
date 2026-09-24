import json
import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

import aiohttp

from . import INSTRUMENT_TYPES, STATUSES, SUBJECTS, TAXONOMY_VERSION
from .config import Config

logger = logging.getLogger(__name__)


# ============================================================================
# Pre-filter: cheap, conservative, and NEVER the final arbiter of a tag.
# ============================================================================
#
# Same philosophy as cci_scraper's: reject only the narrow, unambiguous band
# of pure courtesy/ceremonial content, biased toward sending anything
# ambiguous to the model rather than dropping it -- a false-positive drop
# loses real data permanently, a false negative costs one extra API call.
# FIU-IND's real "What's New"/Careers feeds (unlike CCI's homepage) did not
# show the same "official judged a moot court" style PR noise during live
# inspection (2026-08-25) -- their noise, if any, looks more like pure
# ceremonial-visit or courtesy-call mentions, so the patterns below are kept
# narrow and few rather than guessed broad.

_DEFINITE_PR_PATTERNS = [
    r"\bpaid a courtesy call\b",
    r"\battended\b.{0,30}\b(felicitation|farewell|ceremonial)\b",
    r"\bcondolence\b.{0,20}\bmessage\b",
]

_DEFINITE_PR_RE = re.compile("|".join(_DEFINITE_PR_PATTERNS), re.IGNORECASE)


def quick_prefilter(title: str) -> bool:
    """Returns False only for unambiguous pure-courtesy titles. True (send to AI) otherwise."""
    return not _DEFINITE_PR_RE.search(title)


# ============================================================================
# Classification result
# ============================================================================

@dataclass
class ClassificationResult:
    kept: bool
    subject: Optional[str] = None
    instrument_type: Optional[str] = None
    status: Optional[str] = None
    confidence: Optional[float] = None
    rationale: Optional[str] = None
    needs_review: bool = False
    review_reasons: List[str] = field(default_factory=list)
    method: str = "ai"  # 'ai' | 'error_fallback'
    raw_response: str = ""


def _system_prompt() -> str:
    subjects_block = "\n".join(f"- {s}" for s in SUBJECTS)
    instruments_block = "\n".join(f"- {i}" for i in INSTRUMENT_TYPES)
    statuses_block = "\n".join(f"- {s}" for s in STATUSES)

    return f"""You are a document classifier for FIU-IND (Financial Intelligence Unit - India), feeding a legal regulatory wiki. You classify each document against a FIXED, CONTROLLED vocabulary ({TAXONOMY_VERSION}) -- choose tags ONLY from the lists below, verbatim (exact spelling). Never invent a tag that is not listed.

STEP 1 -- decide whether to keep this document at all.
FIU-IND's real feeds (Compliance Orders, Downloads, What's New, Careers, Tenders) mix real regulatory/enforcement/institutional content with occasional pure courtesy or ceremonial mentions (a farewell function, a condolence message, a courtesy call) that have no operative consequence. The test: does the item announce, notify, guide, penalize, or dispose of something with a real operative consequence -- a penalty imposed, a guideline reporting entities must follow, a vacancy to apply for, a tender with a submission deadline, an Act/Rule that is in force? If yes, keep it, even if it doesn't cleanly fit an existing Instrument Type (see the "no clean fit" rule below) -- a real operative document with no perfect tag should still be KEPT and flagged for review, not dropped. Only set "keep": false for content whose entire substance is a named official attending/being honored at an event with nothing else to it.

STEP 2 -- if kept, classify on three independent facets:

Subject (what the document is substantively about):
{subjects_block}

Instrument Type (what kind of document this is):
{instruments_block}

Subject priority rule -- Virtual Digital Assets: a Notification, Guideline, Circular, or Adjudication/Penalty Order that specifically concerns Virtual Digital Asset Service Providers (VDA SPs) gets Subject: Virtual Digital Asset (VDA) Regulation, taking priority over the more general Reporting Entity Registration & Designation or Enforcement Actions & Penalties Subjects -- this schema only supports one Subject per document, so the more specific VDA tag always wins over the general one when a document is genuinely about VDA SPs. Example: a penalty order against a VDA Service Provider (e.g. a Binance- or Bybit-style case) is Subject: Virtual Digital Asset (VDA) Regulation, Instrument Type: Adjudication / Penalty Order -- NOT Subject: Enforcement Actions & Penalties. A penalty order against an entity for a general PMLA/reporting violation unrelated to VDA activity (e.g. a bank's general compliance failure) stays Subject: Enforcement Actions & Penalties.

Recruitment rule: a job vacancy, deputation posting, or contractual staff/consultant engagement notice (e.g. "Filling up posts of Deputy Director...", "Applications for the post of Consultants...") is Subject: Recruitment & Institutional Opportunities, Instrument Type: Recruitment / Vacancy Notice -- NOT Subject: Institutional Governance & Administration (reserved for genuine internal-governance content: Director appointments, organisational structure, administrative directives -- not staffing/hiring notices) and NOT Subject: Procurement & Tenders even when this content is found on the Tenders page or otherwise looks administratively bundled with real tenders -- staffing a position is not purchasing goods/works/services, and the two Subjects should stay separated by substance regardless of which real page a notice happens to appear on.

No-clean-fit rule: if a document is clearly real and operative but none of the Instrument Type values above describe it well (e.g. a periodic compliance-status list like a "non-compliant NBFC" disclosure), still set "keep": true, pick the closest available Subject, set "instrument_type": null rather than forcing a bad-fit tag, and set "needs_review": true with a rationale naming what kind of document it actually is. This surfaces a real taxonomy gap for a human to review rather than mislabeling it.

Status (the document's current legal/operative standing):
{statuses_block}

Status rules:
- A penalty order defaults to "In Force" unless there is EXPLICIT evidence in the text (or a linked follow-up document) of an appeal to the Appellate Tribunal (Section 26 PMLA) or a stay. Do NOT infer "Under Litigation / Stayed" merely because a penalty is large or the entity is prominent -- a big, newsworthy penalty (e.g. against a major exchange) with no appeal mentioned is still "In Force".
- A Recruitment / Vacancy Notice defaults to "In Force" too, the same way a Tender / RFP does -- it has a real operative consequence (an application/submission deadline), even though it isn't a binding legal instrument in the Regulation/Order sense. Do not default this content to "Not Applicable" just because it isn't legislative.
- Kept press-release/outreach content with no regulatory-instrument lifecycle of its own (a general institutional announcement, an MoU signing, a delegation visit) gets Subject: Public Communication & Outreach and Status: Not Applicable -- never force this kind of content into an enforcement-order or draft-instrument Status.
- FIU-IND's own periodic institutional disclosures (its Annual Report, for instance) are Status: Not Applicable too -- they are the current standing version of a recurring disclosure, not an instrument with an in-force/superseded lifecycle the way an Act, Rule, Guideline, or Order has.
- "Draft / Under Consultation" is reserved for a real instrument that is itself genuinely unfinalized and pending -- do not use it as a catch-all for content that doesn't fit anywhere else.

Respond with ONLY a single JSON object, no markdown fences, no commentary outside the JSON:
{{
  "keep": true or false,
  "subject": "<exact tag from Subject list, or null>",
  "instrument_type": "<exact tag from Instrument Type list, or null>",
  "status": "<exact tag from Status list, or null>",
  "confidence": <0-100 integer, your genuine confidence in the Subject+Instrument Type classification>,
  "needs_review": true or false,
  "rationale": "<one short sentence>"
}}

Keep "rationale" to one sentence. Do not include any text outside the JSON object."""


def _user_prompt(title: str, content: Optional[str], url: str) -> str:
    parts = [f"Title: {title}"]
    if url:
        parts.append(f"URL: {url}")
    if content:
        parts.append(f"\nDocument text:\n{content}")
    else:
        parts.append("\n(No document text available -- classify from the title and URL only.)")
    return "\n".join(parts)


def _validate_and_build(raw: str) -> ClassificationResult:
    """Parses the model's JSON and validates every tag against the real controlled
    vocabulary. A tag that isn't in the workbook is nulled out and the record is
    flagged for review -- it is never silently trusted. Identical validation
    logic to cci_scraper/classifier.py."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return ClassificationResult(
                kept=True, needs_review=True, method="ai",
                review_reasons=["Model response was not valid JSON"], raw_response=raw,
            )
        try:
            data = json.loads(match.group())
        except json.JSONDecodeError:
            return ClassificationResult(
                kept=True, needs_review=True, method="ai",
                review_reasons=["Model response was not valid JSON, even after extraction"],
                raw_response=raw,
            )

    keep = bool(data.get("keep", True))
    if not keep:
        return ClassificationResult(kept=False, method="ai", raw_response=raw,
                                     rationale=data.get("rationale"))

    subject = data.get("subject")
    instrument_type = data.get("instrument_type")
    status = data.get("status")

    reasons: List[str] = []
    if subject is not None and subject not in SUBJECTS:
        reasons.append(f"Model returned an out-of-vocabulary Subject: {subject!r}")
        subject = None
    if instrument_type is not None and instrument_type not in INSTRUMENT_TYPES:
        reasons.append(f"Model returned an out-of-vocabulary Instrument Type: {instrument_type!r}")
        instrument_type = None
    if status is not None and status not in STATUSES:
        reasons.append(f"Model returned an out-of-vocabulary Status: {status!r}")
        status = None
    if subject is None:
        reasons.append("Subject is missing")
    if instrument_type is None:
        reasons.append("Instrument Type is missing (may be a real no-clean-fit case -- see rationale)")

    model_flagged = bool(data.get("needs_review", False))
    if model_flagged and "Model flagged low confidence" not in reasons:
        reasons.append("Model flagged low confidence")

    confidence = data.get("confidence")
    try:
        confidence = float(confidence) if confidence is not None else None
    except (TypeError, ValueError):
        confidence = None

    return ClassificationResult(
        kept=True,
        subject=subject,
        instrument_type=instrument_type,
        status=status,
        confidence=confidence,
        rationale=data.get("rationale"),
        needs_review=bool(reasons),
        review_reasons=reasons,
        method="ai",
        raw_response=raw,
    )


async def classify(
    session: aiohttp.ClientSession,
    config: Config,
    title: str,
    content: Optional[str],
    url: str = "",
) -> ClassificationResult:
    """Classify one document. Falls back to a distinct 'error_fallback' method
    (never silently blended with genuine model uncertainty) if the API key is
    missing or the call fails outright."""
    if not config.LLM_API_KEY:
        return ClassificationResult(
            kept=True, needs_review=True, method="error_fallback",
            review_reasons=["LLM_API_KEY not configured -- classification did not run"],
        )

    payload = {
        "model": config.LLM_MODEL,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": _user_prompt(title, content, url)},
        ],
        "temperature": config.CLASSIFICATION_TEMPERATURE,
        "max_tokens": config.CLASSIFICATION_MAX_TOKENS,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {config.LLM_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with session.post(
            config.LLM_API_URL, json=payload, headers=headers,
            timeout=aiohttp.ClientTimeout(total=config.REQUEST_TIMEOUT),
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                logger.error("Classification API error %s: %s", resp.status, body[:500])
                return ClassificationResult(
                    kept=True, needs_review=True, method="error_fallback",
                    review_reasons=[f"Classification API returned HTTP {resp.status}"],
                )
            result = await resp.json()
            raw = result["choices"][0]["message"]["content"]
            return _validate_and_build(raw)
    except Exception as exc:
        logger.error("Classification call failed for %r: %s", title[:80], exc)
        return ClassificationResult(
            kept=True, needs_review=True, method="error_fallback",
            review_reasons=[f"Classification call raised: {exc}"],
        )
