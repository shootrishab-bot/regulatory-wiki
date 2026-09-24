"""
DOS-ISRO Ecosystem Adapter -- covers all 13 real (source, category)
combinations dos_isro_watcher.py produces. Supersedes isro_adapter.py.

REGULATOR_CODE = "DOS-ISRO" per the taxonomy workbook's Taxonomy sheet
(every row's own "Regulator" column) and Schema Note (source_id
convention: sha1(regulator_code|source_url|title), already applied in
dos_isro_watcher.py's make_id() -- this adapter just passes each row's
own "id" through as source_id, same as every other adapter in this
project).

Per-category real shapes, all confirmed via a real live scrape
(2026-08-19, 362 total real documents):

  ISRO/TENDERS, ISRO/ANNUAL_REPORTS, ISRO/POLICY, NSIL/ANNUAL_REPORTS:
    url is always a direct PDF link -- file_url=url, needs_download=True.

  ISRO/PRESS_RELEASE:
    url is an HTML detail page (not a PDF) for 101/113 real rows;
    genuinely empty for 12 real rows with a broken href="#" link on the
    live site (see dos_isro_scraper.py's module docstring point 2) --
    those fall back to the section's own listing page as source_url and
    needs_download=False, same treatment isro_adapter.py already had.

  NSIL/TENDERS:
    url is a real attachment PDF when present; genuinely absent for a few
    real rows (an EoI/RFP whose only real link is the external CPPP
    portal, not hosted on nsilindia.co.in itself -- confirmed live).
    Carries a REAL site-provided status_hint ("Open"/"Close" text) --
    the first of these 4 sources to have one; passed straight through
    per NormalizedDocument's own documented convention (ground truth
    from the regulator itself, not a model guess).

  INSPACE/AUTHORIZATIONS:
    JUDGMENT CALL, not a mechanical pass-through: these 113 real records
    have no per-document URL or downloadable file at all -- the
    ServiceNow table row IS the complete real record (authorization
    type, authorized entity, what it's for, validity, execution date).
    Rather than leave raw_text=None and force the classifier to work
    from the title alone (which is already all that title contains), a
    short raw_text summary is SYNTHESIZED here from the row's own real
    fields, with raw_text_source="html_page" (closest existing enum
    value -- NormalizedDocument has no dedicated "structured API record"
    value) and needs_download=False (there is nothing more to fetch --
    this already IS the complete record, not a stub pointing at more
    content elsewhere). Flagging this explicitly since it's genuinely
    different from every other adapter in this project, which only ever
    passes through content the source scraper already extracted
    verbatim, never synthesizes new text.

  INSPACE/NGP:
    url is a real ServiceNow attachment download link
    (sys_attachment.do?sys_id=...) -- confirmed live to serve the real
    147-page NGP PDF (per the taxonomy's own Dataset sheet), even though
    the URL string itself has no ".pdf" suffix. file_extension_hint is
    hardcoded "pdf" here specifically (the one deliberate exception to
    this project's "never hardcode pdf" convention -- justified because
    this is a single, individually-confirmed real document, not a
    generic multi-extension feed the way MIB's was).

  INSPACE/PUBLICATIONS:
    url is a real sys_attachment.do download link for most of the 42 real
    rows; genuinely None for the handful whose real `url` field points at
    ANOTHER inspace.gov.in sub-page instead of a direct file (e.g. the NGP
    document itself, listed again here as a Publications entry, and a
    "Coffee Table Book" viewer page) -- file_url/needs_download follow
    has_real_link exactly like every other section, no special-casing
    needed here since dos_isro_scraper.py already resolved this at parse
    time. The real per-document category text (doc_category, e.g.
    "Brochure & Newsletter", "Guidelines, Reports & White Papers") has no
    dedicated NormalizedDocument slot and is dropped here, same precedent
    as MIB's wing_category.

  INSPACE/DATA_DISSEMINATORS:
    Same JUDGMENT CALL as Authorizations -- these 88 real registration
    records have no per-document URL or file at all; a raw_text summary
    is SYNTHESIZED from the row's own real fields (org, registration
    number, satellite owner, payload, constellations, validity).
    needs_download=False, same reasoning as Authorizations.

  INSPACE/EVENTS:
    url is a real link (internal inspace.gov.in sub-page or an external
    site, e.g. herox.com) for all 3 real rows -- file_url=None (never a
    direct downloadable file), needs_download=True so downstream attempts
    to fetch+extract the linked page's own content, same as any other
    HTML-detail-page source in this project.

    published_date is always None as of 2026-09-16 -- the scraper no
    longer derives one from the event's date RANGE (see
    parse_inspace_events' own docstring for the real future-dated row
    that change fixed). normalize() also forces it to None for this
    category, because master CSV rows scraped before the fix still carry
    the old value and are never rewritten by the watcher.

  INSPACE/OPPORTUNITIES, INSPACE/OPPORTUNITIES_ARCHIVE:
    UPDATED 2026-08-19, second pass: url still points to a real
    inspace.gov.in ServiceNow sub-page (?id=...), but
    dos_isro_watcher.py's fetch_opportunity_subpages() now fetches each
    real, non-excluded sub-page directly (same session/token bootstrap
    scrape_inspace() already has for Authorizations/NGP) and captures its
    real content -- 33 of 49 real rows now carry real raw_text, per an
    explicit relevance filter (EXCLUDED_OPPORTUNITY_SLUGS in
    dos_isro_watcher.py): pure training courses, webinars, internships,
    and student competitions are skipped (16 real rows -- e.g. "Course on
    Essentials of Space Technology in Agriculture", "Semiconductor
    Webinar", "Internship"), everything with real regulatory/business
    substance (EoI, AO, RFP, Fund, Registration, Recruitment, Empanelment,
    Technology Transfer, Advisory Note, Consultation Paper) is scraped.
    When a sub-page ALSO has a real attachment (sys_attachment.do) link,
    that's treated as the authoritative primary source and re-fetched
    downstream (needs_download=True, file_extension_hint="pdf"), same
    precedent as ipindia_adapter.py's judgment call for HTML-content-plus-
    PDF rows -- raw_text stays populated as a fallback either way. The 16
    excluded rows still fall back to title + doc_category only, same
    thinner-signal treatment as the first pass.
"""

from normalized_document import NormalizedDocument

REGULATOR_CODE = "DOS-ISRO"

_PDF_CATEGORIES = {
    ("ISRO", "TENDERS"),
    ("ISRO", "ANNUAL_REPORTS"),
    ("ISRO", "POLICY"),
    ("NSIL", "ANNUAL_REPORTS"),
    ("INSPACE", "PUBLICATIONS"),  # real url is a downloadable sys_attachment.do
                                   # link when present -- see module docstring
}

_SECTION_LISTING_URLS = {
    ("ISRO", "TENDERS"): "https://www.isro.gov.in/Tenders.html",
    ("ISRO", "PRESS_RELEASE"): "https://www.isro.gov.in/Press.html",
    ("ISRO", "ANNUAL_REPORTS"): "https://www.isro.gov.in/AnnualReports.html",
    ("ISRO", "POLICY"): "https://www.isro.gov.in/IndiaSpacePolicy.html",
    ("NSIL", "TENDERS"): "https://www.nsilindia.co.in/tenders",
    ("NSIL", "ANNUAL_REPORTS"): "https://www.nsilindia.co.in/annual-report",
    ("INSPACE", "AUTHORIZATIONS"): "https://www.inspace.gov.in/inspace?id=inspace_authorizations",
    ("INSPACE", "NGP"): "https://www.inspace.gov.in/inspace?id=inspace_ngp_update_page",
    ("INSPACE", "PUBLICATIONS"): "https://www.inspace.gov.in/inspace?id=inspace_publications",
    ("INSPACE", "DATA_DISSEMINATORS"): "https://www.inspace.gov.in/inspace?id=inspace_data_disseminator_page",
    ("INSPACE", "EVENTS"): "https://www.inspace.gov.in/inspace?id=inspace_events_list",
    ("INSPACE", "OPPORTUNITIES"): "https://www.inspace.gov.in/inspace?id=inspace_opportunities_page",
    ("INSPACE", "OPPORTUNITIES_ARCHIVE"): "https://www.inspace.gov.in/inspace?id=inspace_opportunities_archive",
}

def _synthesize_authorization_text(row: dict) -> str:
    """Builds a short real-content summary from an IN-SPACe Authorization
    record's own structured fields -- see module docstring's JUDGMENT
    CALL note. Every field used here is real data the scraper already
    captured verbatim; nothing is invented."""
    parts = [
        f"Authorization Number: {row.get('authorization_number', '')}",
        f"Authorization Type: {row.get('authorization_type', '')}",
        f"Authorized Entity: {row.get('authorized_entity', '')}",
        f"Authorization For: {row.get('authorization_for', '')}",
        f"Authorization Date: {row.get('published_date_raw', '')}",
        f"Validity of Authorization: {row.get('validity', '')}",
        f"Execution Date: {row.get('execution_date_raw', '')}",
    ]
    return "\n".join(p for p in parts if p.split(": ", 1)[1])


def _synthesize_disseminator_text(row: dict) -> str:
    """Builds a short real-content summary from a Data Disseminator
    registration's own structured fields -- see module docstring's
    JUDGMENT CALL note. Every field used here is real data the scraper
    already captured verbatim; nothing is invented."""
    parts = [
        f"Disseminator Organization: {row.get('disseminator_org', '')}",
        f"Registration Number: {row.get('registration_number', '')}",
        f"Satellite Owner: {row.get('satellite_owner', '')}",
        f"Payload: {row.get('payload', '')}",
        f"Satellite Constellations: {row.get('satellite_constellations', '')}",
        f"Date of Registration: {row.get('published_date_raw', '')}",
        f"Validity: {row.get('validity', '')}",
        f"Validity Expired: {row.get('validity_expired', '')}",
    ]
    return "\n".join(p for p in parts if p.split(": ", 1)[1])


def normalize(row: dict) -> NormalizedDocument:
    source = row.get("source", "")
    category = row.get("category", "")
    key = (source, category)
    url = row.get("url") or ""
    has_real_link = bool(url)

    published_date = row.get("published_date") or None
    # An IN-SPACe event's date is when it HAPPENS, never a publication date
    # (see dos_isro_scraper.parse_inspace_events). The scraper no longer
    # writes one, but master CSVs scraped before that fix still carry the
    # old end-of-event value: the watcher never rewrites a row it has
    # already seen, and this adapter re-reads the whole CSV every run. So
    # the rule is enforced here too, where every row passes.
    if key == ("INSPACE", "EVENTS"):
        published_date = None
    listing_url = _SECTION_LISTING_URLS.get(key, "")

    if key == ("INSPACE", "AUTHORIZATIONS"):
        return NormalizedDocument(
            regulator_code=REGULATOR_CODE,
            source_id=row["id"],
            title=row.get("title", ""),
            source_url=listing_url,
            published_date=published_date,
            file_url=None,
            file_extension_hint=None,
            category_hint=f"{source}_{category}",
            status_hint=None,  # IN-SPACe's real data has no separate status field
                                # for an Authorization -- an issued authorization is
                                # implicitly current; distinct from NSIL's real
                                # Open/Close signal, which genuinely does exist
            raw_text=_synthesize_authorization_text(row),
            raw_text_source="html_page",  # closest existing enum value -- see
                                            # module docstring's JUDGMENT CALL note
            needs_download=False,  # this already IS the complete record
            scraped_at=row.get("scraped_at") or None,
        )

    if key == ("INSPACE", "NGP"):
        return NormalizedDocument(
            regulator_code=REGULATOR_CODE,
            source_id=row["id"],
            title=row.get("title", ""),
            source_url=url or listing_url,
            published_date=published_date,
            file_url=url or None,
            file_extension_hint="pdf" if has_real_link else None,  # confirmed real
                                                                     # PDF -- see
                                                                     # module docstring
            category_hint=f"{source}_{category}",
            status_hint=None,
            raw_text=None,
            raw_text_source=None,
            needs_download=has_real_link,
            scraped_at=row.get("scraped_at") or None,
        )

    if key == ("INSPACE", "DATA_DISSEMINATORS"):
        return NormalizedDocument(
            regulator_code=REGULATOR_CODE,
            source_id=row["id"],
            title=row.get("title", ""),
            source_url=listing_url,
            published_date=published_date,
            file_url=None,
            file_extension_hint=None,
            category_hint=f"{source}_{category}",
            status_hint=None,
            raw_text=_synthesize_disseminator_text(row),
            raw_text_source="html_page",
            needs_download=False,
            scraped_at=row.get("scraped_at") or None,
        )

    if key in (("INSPACE", "OPPORTUNITIES"), ("INSPACE", "OPPORTUNITIES_ARCHIVE")):
        raw_text = row.get("raw_text") or None
        attachment_url = row.get("attachment_url") or None
        # Real content now captured for 33/49 rows (see
        # fetch_opportunity_subpages() in dos_isro_watcher.py) -- the 16
        # deliberately excluded (pure courses/webinars/internships/student
        # competitions, per explicit direction) still fall back to
        # title-only, same as before. When BOTH raw_text and a real
        # attachment exist, the attachment is treated as the authoritative
        # primary source and re-fetched downstream (needs_download=True),
        # same precedent as ipindia_adapter.py's own judgment call for the
        # analogous HTML-content-plus-PDF case; raw_text stays populated as
        # a fallback even then, in case the re-fetch fails.
        return NormalizedDocument(
            regulator_code=REGULATOR_CODE,
            source_id=row["id"],
            title=row.get("title", ""),
            source_url=url or listing_url,
            published_date=published_date,
            file_url=attachment_url,
            file_extension_hint="pdf" if attachment_url else None,
            category_hint=f"{source}_{category}",
            status_hint=None,
            raw_text=raw_text,
            raw_text_source="html_page" if raw_text else None,
            needs_download=bool(attachment_url),
            scraped_at=row.get("scraped_at") or None,
        )

    is_pdf = key in _PDF_CATEGORIES
    status_hint = row.get("status_hint") or None  # real for NSIL/TENDERS, empty elsewhere

    return NormalizedDocument(
        regulator_code=REGULATOR_CODE,
        source_id=row["id"],
        title=row.get("title", ""),
        source_url=url or listing_url,
        published_date=published_date,
        file_url=url if (is_pdf and has_real_link) else None,
        file_extension_hint="pdf" if (is_pdf and has_real_link) else None,
        category_hint=f"{source}_{category}",
        status_hint=status_hint,
        raw_text=None,
        raw_text_source=None,
        needs_download=has_real_link,
        scraped_at=row.get("scraped_at") or None,
    )


def normalize_all(rows: list[dict]) -> list[NormalizedDocument]:
    return [normalize(row) for row in rows]


if __name__ == "__main__":
    sample_rows = [
        {
            "id": "dosisro_a1b2c3",
            "title": "PRL/PURCHASE/PT-32/25-26 Dated:03-03-2026",
            "url": "https://www.isro.gov.in/media_isro/pdf/Tenders/2026/NIT-PT-32.pdf",
            "source": "ISRO", "category": "TENDERS",
            "published_date": "2026-03-03", "published_date_raw": "",
            "scraped_at": "2026-08-19T12:00:00+00:00",
        },
        {
            "id": "dosisro_f6e5d4",
            "title": "PMA/IN-SPACe/AUTH/2026/139: Undertaking Orbital/Sub-Orbital Launches -- for M/s Skyroot Aerospace",
            "url": "",
            "source": "INSPACE", "category": "AUTHORIZATIONS",
            "published_date": "2026-07-16", "published_date_raw": "16 July, 2026",
            "authorization_number": "PMA/IN-SPACe/AUTH/2026/139",
            "authorization_type": "Undertaking Orbital/Sub-Orbital Launches from Indian Territory",
            "authorized_entity": "M/s Skyroot Aerospace Private Limited, Hyderabad",
            "authorization_for": "Undertaking orbital launch of Vikram-1 Launch Vehicle",
            "validity": "4 August, 2026",
            "execution_date_raw": "18 July, 2026",
            "scraped_at": "2026-08-19T12:00:00+00:00",
        },
    ]
    for doc in normalize_all(sample_rows):
        print(doc)
