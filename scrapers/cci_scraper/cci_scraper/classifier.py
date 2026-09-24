import json
import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

import aiohttp

from . import INSTRUMENT_TYPES, STATUSES, SUBJECTS
from .config import Config

logger = logging.getLogger(__name__)


# ============================================================================
# Pre-filter: cheap, conservative, and NEVER the final arbiter of a tag.
# ============================================================================
#
# Its only job is to reject the narrow band of pure event-attendance/PR content
# that is unambiguous from the title alone -- "X judged a moot court", "Y gave a
# lecture", "Chairperson interviewed by Z". Everything else, including anything
# that doesn't match a keep-pattern either, goes to the model. A false-positive
# drop here loses real data permanently; a false negative just costs one AI
# call. The patterns are deliberately narrow and anchored to the *shape* of a
# byline-plus-verb sentence, not loose keywords, specifically because the prior
# draft's `session chair(ing|ed)` pattern didn't match the real phrasing
# "chaired the Plenary Session" -- word-order-sensitive patterns are fragile;
# this version matches on the verb regardless of what follows it.

_DEFINITE_PR_PATTERNS = [
    r"\bjudged\b.{0,40}\b(moot court|round)\b",
    r"\bdelivered\b.{0,20}\b(lecture|address|speech)\b",
    r"\bchaired\b.{0,30}\b(session|panel|plenary)\b",
    r"\binteracted with\b.{0,20}\bintern",
    r"\binternship batch\b.{0,30}\bconcluded\b",
    r"\bfeatured in\b.{0,20}\b(business standard|newspaper|print edition)\b",
    r"\b(interview|interviewed)\b.{0,20}\b(featured|print edition|newspaper)\b",
]

_DEFINITE_PR_RE = re.compile("|".join(_DEFINITE_PR_PATTERNS), re.IGNORECASE)


def quick_prefilter(title: str) -> bool:
    """Returns False only for unambiguous pure-PR titles. True (send to AI) otherwise."""
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

    return f"""You are a document classifier for the Competition Commission of India (CCI), feeding a legal regulatory wiki. You classify each document against a FIXED, CONTROLLED vocabulary -- choose tags ONLY from the lists below, verbatim (exact spelling). Never invent a tag that is not listed.

STEP 1 -- decide whether to keep this document at all.
CCI's homepage "Latest Updates" feed mixes real regulatory content with pure PR/event-attendance mentions (an official judging a moot court, delivering a guest lecture, chairing a conference session, being interviewed). The test: does the item announce, invite, notify, or dispose of something with an operative consequence -- a vacancy to apply for, a comment period to respond to, a transaction that is now approved, a contract that has been awarded, a rule that is now in force? If yes, keep it. If the item's entire content is "a named official did X at event Y" with no operative consequence, set "keep": false and leave subject/instrument_type/status as null -- do NOT invent a tag like "PR Content" or force it into an unrelated real Subject just because it technically came from CCI.

STEP 2 -- if kept, classify on three independent facets:

Subject (what the document is substantively about):
{subjects_block}

Instrument Type (what kind of document this is):
{instruments_block}

Instrument Type rules: a document published as a Gazette Notification that itself promulgates Rules or Regulations -- title pattern "Notification regarding The Competition (...) Rules/Regulations, YYYY", often with a G.S.R. citation number -- is "Regulation", not "Notification". The G.S.R./gazette mechanism is just how CCI's subordinate legislation gets published; it is not evidence the document is a simple administrative notice. Reserve "Notification" for notices that do not themselves promulgate a Rule or Regulation (e.g. an individual bank/entity exemption notification, a corrigendum).

Status (the document's current legal/operative standing):
{statuses_block}

Status rules: CCI Orders default to "In Force" unless there is explicit evidence in the text of an appeal, stay, or reversal -- do not infer litigation status from a transaction merely being large or high-profile. A document revising an existing Regulation/Notification's terms without replacing it outright is "Amended"; only tag "Superseded" when a full replacement is evidenced. Use "Not Applicable" ONLY for outreach, advocacy, or event-driven communications with no operative deadline, award, or administrative consequence of their own -- a Call for Papers, a conference announcement, a training/workshop notice. Do not force this kind of content into "Draft / Under Consultation" (reserved for an actual instrument that is itself unfinalized and pending) just because no other value seems to fit. Do NOT use "Not Applicable" for a Tender / RFP, an award of work, or a tender cancellation, even though these are not "legal instruments" in the Regulation/Order sense -- a tender with an open submission deadline, a completed contract award, or a cancellation notice all have a real operative consequence and should be "In Force". Likewise, do NOT use "Not Applicable" for a Market Study / Research Report -- a published study is the current, standing version of that research output, so it defaults to "In Force" like everything else, not "Not Applicable", even though it is not itself a binding legal instrument.

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
    flagged for review -- it is never silently trusted."""
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
        reasons.append("Instrument Type is missing")

    model_flagged = bool(data.get("needs_review", False))
    if model_flagged:
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
