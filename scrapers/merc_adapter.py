"""
MERC Adapter -- Pattern A (no content yet; the ingestion pipeline downloads
and extracts the PDF itself).

INPUT: rows produced by scrapers/merc_watcher.py (scrapers/data/merc_raw.json).
OUTPUT: NormalizedDocument, the single shape lib/ingest.ts consumes.

The two judgment calls this adapter makes, and why:

1. `category_hint` vs `status_hint`. MERC's Orders feed carries a real `terms`
   vocabulary (25 confirmed values) that is MOSTLY subject-matter ("Renewable
   Energy RE", "Open Access", "Power Purchase Agreement") but contains four
   values that are really INSTRUMENT-type signals ("CORRIGENDUM ORDER",
   "Interim order", "Clarificatory Order", "Removal of Difficulties") and one
   that is a procedural-posture signal ("Suo Moto"). Passing the whole thing
   through as one undifferentiated hint would tell the classifier "the subject
   of this document is CORRIGENDUM ORDER", which is not what MERC means by it.
   So `terms` is split: subject-ish values stay in `category_hint`, and the
   instrument-ish ones are ALSO surfaced there but explicitly labelled, since
   NormalizedDocument has no `instrument_hint` field and inventing one would
   fork the contract every other adapter in this project already satisfies.

2. `status_hint` is emitted for exactly two real, source-provided states and
   nothing else:
     - Repealed regulations/guidelines: MERC files these under its own
       "Repealed Regulations" / "Repealed Guidelines" sections. That is the
       regulator's own assertion about the instrument's status, not a model
       guess -- the same class of ground truth as MTCTE's Active/Expired
       column, and it maps onto the taxonomy's real `Repealed` value.
     - Draft regulations: MERC's "/regulation_type/draft-regulations/" section
       is, by MERC's own labelling, pre-publication material. Maps onto
       `Draft / Under Consultation`.
   The Hearings feed's own `status` column ("Scheduled") is deliberately NOT
   mapped -- see `_hearing_status_note`.

Run:
    python scrapers/run_merc_adapter.py
"""

from __future__ import annotations

from datetime import date

from normalized_document import NormalizedDocument

REGULATOR_CODE = "MERC"

# `terms` values from the real Orders feed that describe the INSTRUMENT rather
# than the subject matter. Confirmed counts from the live feed (2026-09-10):
# CORRIGENDUM ORDER 20, Interim order 18, Removal of Difficulties 16,
# Clarificatory Order 10.
_INSTRUMENT_TERMS = {
    "CORRIGENDUM ORDER",
    "Interim order",
    "Clarificatory Order",
    "Removal of Difficulties",
}

# Feeds MERC itself files under a "repealed" heading. The regulator's own
# shelving is the status assertion here.
_REPEALED_FEED_PREFIXES = ("regulations_repealed", "guidelines_repealed")
_DRAFT_FEED_PREFIXES = ("regulations_draft",)

# Human-readable section labels that are worth carrying into category_hint even
# when the row has no `terms` value of its own -- MERC's section IS the
# category for every HTML-table feed.
def _category_hint(row: dict) -> str | None:
    terms = (row.get("terms") or "").strip()
    section = (row.get("section") or "").strip()

    parts: list[str] = []
    if terms:
        if terms in _INSTRUMENT_TERMS:
            # Labelled so the classifier reads it as an instrument signal, not
            # as "this document is about corrigenda".
            parts.append(f"Instrument: {terms}")
        else:
            parts.append(terms)
    if section and section not in parts:
        parts.append(section)

    hint = " | ".join(parts)
    return hint or None


def _status_hint(row: dict) -> str | None:
    feed = row.get("feed") or ""
    if feed.startswith(_REPEALED_FEED_PREFIXES):
        return "Repealed"
    if feed.startswith(_DRAFT_FEED_PREFIXES):
        return "Draft"
    return None


def _hearing_status_note(row: dict) -> None:
    """Documents why the Hearings feed's real `status` column is not mapped.

    The feed genuinely carries a site-provided status ("Scheduled"), and the
    temptation is to treat it like MTCTE's Active/Expired -- ground truth that
    should override the classifier. It should not. MTCTE's column describes an
    INSTRUMENT's lifecycle ("this certificate is expired"), which is what the
    Status facet models. MERC's column describes a HEARING's calendar state
    ("this listing is scheduled / adjourned"), which is a different kind of
    thing entirely: a hearing notice document is itself in force as a notice
    regardless of whether the hearing it announces was later adjourned.
    Mapping it would put calendar state into a facet that means legal state.

    It IS passed through in category_hint (via `section`), where it informs
    Subject/Instrument classification without contaminating Status.
    """
    return None


def _file_extension_hint(row: dict) -> str | None:
    url = row.get("file_url") or ""
    if "." not in url.rsplit("/", 1)[-1]:
        return None
    ext = url.rsplit(".", 1)[-1].split("?")[0].lower()
    return ext if 1 <= len(ext) <= 5 else None


def _title(row: dict) -> str:
    """A real MERC title, with the case number attached when the feed has one.

    Case numbers matter here in a way they do not for most regulators in this
    project: MERC's own corpus threads a matter across an Order, later
    Corrigendum Orders, and Daily Orders that all share "Case No. N of YYYY",
    and the taxonomy's first Tagging Guide rule is about exactly that linkage.
    Keeping the case number inside the title is what makes it recoverable
    downstream without adding a field to the shared contract.
    """
    title = (row.get("title") or "").strip()
    case_no = (row.get("case_no") or "").strip()
    if case_no and case_no.lower() not in title.lower():
        return f"{title} [Case No. {case_no}]" if title else f"Case No. {case_no}"
    return title


def _published_date(row: dict) -> str | None:
    """The feed's date, except a hearing that has not happened yet.

    The Hearings feed has no notice-issue date; its only date is the
    hearing's own (the epoch timestamp beside "Thu 29/10/2026 11:00 AM").
    For a past hearing that is a fair stand-in -- the notice went out before
    it -- but a scheduled one is dated in the FUTURE, which no published
    document can be: 68 rows on 2026-09-24, every one tripping the UI's
    "unverified date" badge. Same call as IN-SPACe events
    (dos_isro_scraper.parse_inspace_events): the date something HAPPENS is
    not when anything was published, so a future one is left out rather than
    presented as a publication date. hearing_date stays in merc_raw.json.
    """
    published = row.get("published_date")
    if row.get("feed") == "hearings" and published and published > date.today().isoformat():
        return None
    return published


def normalize(row: dict) -> NormalizedDocument:
    _hearing_status_note(row)
    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["source_id"],
        title=_title(row),
        source_url=row.get("source_url", ""),
        published_date=_published_date(row),
        file_url=row.get("file_url"),
        file_extension_hint=_file_extension_hint(row),
        category_hint=_category_hint(row),
        status_hint=_status_hint(row),
        raw_text=None,
        raw_text_source=None,
        # Every MERC row points at a real, directly-downloadable
        # merc.gov.in/wp-content/uploads/... file (no JS viewer, no login), so
        # extraction is left to lib/ingest.ts's own fetch + pdf-parse path
        # rather than duplicated here. The 86 rows with no attachment at all
        # get needs_download=False, since there is nothing to download --
        # they classify from title alone.
        needs_download=bool(row.get("file_url")),
        scraped_at=row.get("scraped_at"),
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample = [
        {
            "feed": "orders",
            "section": "Orders",
            "source_url": "https://merc.gov.in/orders-details/",
            "title": "Case of Maharashtra State Electricity Distribution Company Limited for Final True Up",
            "case_no": "226 of 2022",
            "published_date": "2023-03-31",
            "terms": "Tariff Related",
            "file_url": "https://merc.gov.in/wp-content/uploads/2023/03/Order-226-of-2022.pdf",
            "source_id": "abc123",
            "scraped_at": "2026-09-10T10:00:00Z",
        },
        {
            "feed": "regulations_repealed:repealed-regulations-tariff-regulations",
            "section": "Repealed Regulations — repealed regulations tariff regulations",
            "source_url": "https://merc.gov.in/regulation_type/repealed-regulations-tariff-regulations/",
            "title": "MERC (Multi Year Tariff) Regulations, 2015",
            "case_no": "",
            "published_date": None,
            "terms": "",
            "file_url": "https://merc.gov.in/wp-content/uploads/2022/07/MYT-2015.pdf",
            "source_id": "def456",
            "scraped_at": "2026-09-10T10:00:00Z",
        },
    ]
    for doc in normalize_all(sample):
        print(doc)
