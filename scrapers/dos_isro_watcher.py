#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DOS-ISRO Ecosystem scraper -- covers all 4 real sources in
DOS_ISRO_Regulatory_Taxonomy_v1_0.xlsx's scope: isro.gov.in, IN-SPACe
(inspace.gov.in), NSIL (nsilindia.co.in). DOS (dos.gov.in) is confirmed
dead (see dos_isro_scraper.py's module docstring point 1) and is not
scraped -- its real policy documents are hosted on isro.gov.in instead.

Supersedes isro_watcher.py, which only covered isro.gov.in. All row-
parsing logic lives in dos_isro_scraper.py (offline-testable, independent
of this file's fetching/session/CSV-I/O concerns), same separation
dot_watcher.py/meity_parser.py established.

STATUS (2026-08-19): every source below is confirmed live, not assumed.
isro.gov.in and nsilindia.co.in need only plain `requests` (no WAF, no JS
rendering -- confirmed for both independently). inspace.gov.in is a
ServiceNow Service Portal (see dos_isro_scraper.py point 3) -- also only
needs plain `requests` at SCRAPE time (Playwright was only used once,
during discovery, to find the real API shape): load any real
inspace.gov.in page once per run to get a session cookie AND the real
CSRF token (`var g_ck = '...'`, embedded in that page's own HTML), then
reuse both for the `/api/now/sp/page?id=...` JSON API calls.

id generation follows the Schema Note's documented convention exactly:
sha1(regulator_code|source_url|title). For the small number of real
records with no per-document URL of their own (ISRO's 12 broken href="#"
press releases -- see dos_isro_scraper.py point 2 of the ISRO section
docstring; IN-SPACe's Authorization records, which have no individual
detail-page URL at all -- see point 3), source_url falls back to the
section's own listing/API page, and the real Authorization Number (or
title+date, for ISRO's broken links) keeps ids distinct since it's always
part of the title.
"""

from datetime import datetime, timezone
from pathlib import Path
import argparse
import csv
import hashlib
import json
import os
import re
import time

import requests

import dos_isro_scraper as dis

REGULATOR_CODE = "DOS-ISRO"

ISRO_BASE_URL = "https://www.isro.gov.in"
NSIL_BASE_URL = "https://www.nsilindia.co.in"
INSPACE_BASE_URL = "https://www.inspace.gov.in"
INSPACE_PORTAL_ID = "94b328b687a8151054e2eb9abbbb3576"  # real, confirmed live via
                                                          # the actual API call's own
                                                          # querystring -- not guessed

DATA_DIR = "data"
MASTER_CSV = os.path.join(DATA_DIR, "dos_isro_master.csv")
NEW_JSON = os.path.join(DATA_DIR, "dos_isro_new_entries.json")

REQUEST_TIMEOUT = 30
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Superset of fields across all 4 sources -- empty string for whichever
# field a given source/category doesn't produce, rather than a different
# column set per source (same convention isro_watcher.py used for its own
# 3 sections).
CSV_FIELDS = [
    "id",
    "title",
    "url",
    "source",       # ISRO | NSIL | INSPACE
    "category",     # TENDERS | PRESS_RELEASE | ANNUAL_REPORTS | POLICY | AUTHORIZATIONS | NGP
    "published_date",
    "published_date_raw",
    "centre",                # ISRO Tenders only
    "opening_date",          # ISRO Tenders, NSIL Tenders
    "closing_date",          # ISRO Tenders, NSIL Tenders
    "closing_time",          # ISRO Tenders only
    "fiscal_year",           # ISRO/NSIL Annual Reports
    "file_size",             # ISRO Tenders only
    "status_hint",           # NSIL Tenders only -- real site-provided Open/Close
    "reference_number",      # NSIL Tenders only
    "tender_id",              # NSIL Tenders only
    "authorization_number",   # IN-SPACe Authorizations only
    "authorization_type",     # IN-SPACe Authorizations only
    "authorized_entity",      # IN-SPACe Authorizations only
    "authorization_for",      # IN-SPACe Authorizations only
    "validity",                # IN-SPACe Authorizations, Data Disseminators
    "execution_date_raw",      # IN-SPACe Authorizations only
    "doc_category",              # IN-SPACe Publications, Opportunities (real per-document category
                                  # text, e.g. "Brochure & Newsletter" -- distinct from the top-level
                                  # "category" column above, which is the section name)
    "belowline",                 # IN-SPACe Publications only (real file-size hint text)
    "is_new",                     # IN-SPACe Publications, Opportunities (real "New" badge)
    "disseminator_org",            # IN-SPACe Data Disseminators only
    "registration_number",          # IN-SPACe Data Disseminators only
    "satellite_owner",               # IN-SPACe Data Disseminators only
    "payload",                        # IN-SPACe Data Disseminators only
    "satellite_constellations",        # IN-SPACe Data Disseminators only
    "validity_expired",                 # IN-SPACe Data Disseminators only
    "raw_text",                          # IN-SPACe Opportunities (current + archive) sub-pages only --
                                          # real extracted page content, see fetch_opportunity_subpages()
    "attachment_url",                     # IN-SPACe Opportunities sub-pages only -- a real attachment
                                           # link found ON the sub-page, distinct from doc["url"] (the
                                           # sub-page link itself)
    "scraped_at",
]


def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def make_id(source_url: str, title: str) -> str:
    """sha1(regulator_code|source_url|title) -- exact convention documented
    in the taxonomy workbook's Schema Note."""
    return hashlib.sha1(f"{REGULATOR_CODE}|{source_url}|{title}".encode()).hexdigest()[:16]


def load_existing_ids():
    if not os.path.exists(MASTER_CSV):
        return set()
    with open(MASTER_CSV, newline="", encoding="utf-8") as f:
        return {row["id"] for row in csv.DictReader(f)}


def fetch(url: str, session: requests.Session = None) -> str:
    s = session or requests
    resp = s.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def _blank_row(doc: dict, source: str, category: str, scraped_at: str) -> dict:
    row = {field: "" for field in CSV_FIELDS}
    row.update({
        "title": doc.get("title", ""),
        "url": doc.get("url") or "",
        "source": source,
        "category": category,
        "published_date": doc.get("published_date") or "",
        "published_date_raw": doc.get("published_date_raw") or "",
        "scraped_at": scraped_at,
    })
    for field in CSV_FIELDS:
        if field in doc and doc[field] is not None:
            row[field] = doc[field]
    return row


def build_rows(docs: list, source: str, category: str, id_title_fallback: bool, existing_ids: set) -> list:
    """Converts parsed doc dicts into CSV-ready rows, generating a stable
    id per the Schema Note's convention. id_title_fallback=True means
    records with no per-document url (ISRO's broken-link rows, IN-SPACe
    Authorizations) still get a distinct id via title (which always
    contains a real distinguishing identifier for both those cases -- the
    real title text, or the real Authorization Number)."""
    rows = []
    scraped_at = now_iso()
    section_url = SECTION_URLS.get((source, category), "")

    for doc in docs:
        title = doc.get("title", "")
        source_url = doc.get("url") or section_url
        row_id = make_id(source_url, title)
        if row_id in existing_ids:
            continue
        rows.append(_blank_row(doc, source, category, scraped_at))
        rows[-1]["id"] = row_id

    return rows


SECTION_URLS = {
    ("ISRO", "TENDERS"): f"{ISRO_BASE_URL}/Tenders.html",
    ("ISRO", "PRESS_RELEASE"): f"{ISRO_BASE_URL}/Press.html",
    ("ISRO", "ANNUAL_REPORTS"): f"{ISRO_BASE_URL}/AnnualReports.html",
    ("ISRO", "POLICY"): f"{ISRO_BASE_URL}/IndiaSpacePolicy.html",
    ("NSIL", "TENDERS"): f"{NSIL_BASE_URL}/tenders",
    ("NSIL", "ANNUAL_REPORTS"): f"{NSIL_BASE_URL}/annual-report",
    ("INSPACE", "AUTHORIZATIONS"): f"{INSPACE_BASE_URL}/inspace?id=inspace_authorizations",
    ("INSPACE", "NGP"): f"{INSPACE_BASE_URL}/inspace?id=inspace_ngp_update_page",
    ("INSPACE", "PUBLICATIONS"): f"{INSPACE_BASE_URL}/inspace?id=inspace_publications",
    ("INSPACE", "DATA_DISSEMINATORS"): f"{INSPACE_BASE_URL}/inspace?id=inspace_data_disseminator_page",
    ("INSPACE", "EVENTS"): f"{INSPACE_BASE_URL}/inspace?id=inspace_events_list",
    ("INSPACE", "OPPORTUNITIES"): f"{INSPACE_BASE_URL}/inspace?id=inspace_opportunities_page",
    ("INSPACE", "OPPORTUNITIES_ARCHIVE"): f"{INSPACE_BASE_URL}/inspace?id=inspace_opportunities_archive",
}


# ============================================================================
# ISRO (plain requests, no session needed -- same as isro_watcher.py)
# ============================================================================

def scrape_isro(existing_ids: set) -> list:
    all_rows = []

    print("\n========== ISRO: Tenders ==========")
    html = fetch(SECTION_URLS[("ISRO", "TENDERS")])
    docs = dis.parse_isro_tenders(html)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "ISRO", "TENDERS", True, existing_ids))

    print("\n========== ISRO: Press Releases ==========")
    html = fetch(SECTION_URLS[("ISRO", "PRESS_RELEASE")])
    docs = dis.parse_isro_press_releases(html)
    broken = sum(1 for d in docs if not d.get("url"))
    print(f"{len(docs)} real rows found ({broken} with a real broken href=\"#\" link -- kept, not dropped)")
    all_rows.extend(build_rows(docs, "ISRO", "PRESS_RELEASE", True, existing_ids))

    print("\n========== ISRO: Annual Reports ==========")
    html = fetch(SECTION_URLS[("ISRO", "ANNUAL_REPORTS")])
    docs = dis.parse_isro_annual_reports(html)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "ISRO", "ANNUAL_REPORTS", True, existing_ids))

    print("\n========== ISRO: Policy (India Space Policy 2023) ==========")
    for page_path, title_hint in dis.ISRO_POLICY_PAGES.items():
        html = fetch(f"{ISRO_BASE_URL}/{page_path}")
        docs = dis.parse_isro_policy_page(html, title_hint)
        print(f"{len(docs)} real row(s) found on {page_path}")
        all_rows.extend(build_rows(docs, "ISRO", "POLICY", True, existing_ids))

    return all_rows


# ============================================================================
# NSIL (plain requests)
# ============================================================================

def scrape_nsil(existing_ids: set) -> list:
    all_rows = []

    print("\n========== NSIL: Tenders ==========")
    html = fetch(SECTION_URLS[("NSIL", "TENDERS")])
    docs = dis.parse_nsil_tenders(html)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "NSIL", "TENDERS", True, existing_ids))

    print("\n========== NSIL: Annual Reports ==========")
    html = fetch(SECTION_URLS[("NSIL", "ANNUAL_REPORTS")])
    docs = dis.parse_nsil_annual_reports(html)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "NSIL", "ANNUAL_REPORTS", True, existing_ids))

    return all_rows


# ============================================================================
# IN-SPACe (ServiceNow -- session + CSRF token bootstrap, then plain
# requests JSON API calls; see dos_isro_scraper.py point 3 and this file's
# module docstring for the real, confirmed mechanics)
# ============================================================================

_G_CK_RE = re.compile(r"var g_ck\s*=\s*['\"]([^'\"]+)['\"]")
_OPPORTUNITY_ID_RE = re.compile(r"[?&]id=([^&]+)")

# Real judgment call, per explicit direction: scrape every real Opportunities
# sub-page EXCEPT ones that are pure training/education/outreach with no
# regulatory or business substance for a legal/regulatory audience -- courses,
# webinars, internships, and student competitions. Every excluded slug was
# checked against its real listing-page title (see dos_isro_master.csv) before
# being added here, not guessed from the id alone. Everything else (EoI, AO,
# RFP, Fund, Registration, Recruitment, Empanelment, Technology Transfer,
# Advisory Note, Consultation Paper) is scraped.
EXCLUDED_OPPORTUNITY_SLUGS = {
    "cyber_security_and_quantum_technology_v2",  # "Short-Term Skill Development Course on..."
    "inspace_webinar",  # "Semiconductor Webinar"
    "agri_course_2025_main",  # "Course on Essentials of Space Technology in Agriculture"
    "course_orbital_mechanics_2025",  # "Fundamentals of Orbital Mechanics..." (course)
    "fundamentals_launch_vehicle",  # "Course on Fundamentals of Launch Vehicle Technologies"
    "inspace_space_economy_webinar",  # "Webinar on Data collection methodology..."
    "course_space_law_p",  # "Course on Space Law, Policy, Economics and Benefits" -- a
                            # training course despite the regulatory-sounding name, not a
                            # policy document itself
    "inspace_course_propulsion_systems_page",  # "Course on Propulsion System..."
    "inspace_model_rocketry_cansat",  # student competition
    "inspace_data_product_page",  # "Course on Space Data Products & Services"
    "inspace_a2z_satellite_course_page",  # "Course on A2Z of Satellite Technology"
    "internship_institutes",  # "Internship"
    "internship",  # "EoI from Space Industries for Student Internship" -- an EoI in
                    # form, but for a student internship programme, not a regulatory/
                    # business matter
    "inspace_course_sta",  # "Space Technology for Agriculture" (course, per its own id)
    "inspace_flight_course",  # "Course on Orbital Mechanics, Attitude Dynamics & Control..."
    "inspace_india_japan_space_industry_com",  # "Participate in India Japan Space
                                                 # Industry day" -- an event-attendance
                                                 # invitation, not an EoI/application
}


def fetch_opportunity_subpages(session: requests.Session, token: str, docs: list) -> None:
    """Fetches each real, non-excluded Opportunities sub-page ONCE per
    unique ?id= slug (confirmed live: several real titles share one real
    slug, e.g. "Apply for Authorization"/"Apply for Registration"/"Apply
    for Advisory Note for ITU filing" all point to ?id=authorisation_main
    -- genuinely the same real page, not 3 separate ones) and enriches each
    doc dict in place with real page content (raw_text) and a real
    attachment URL if the page has one. Mutates docs; returns nothing."""
    content_by_slug: dict = {}
    for doc in docs:
        url = doc.get("url") or ""
        m = _OPPORTUNITY_ID_RE.search(url)
        slug = m.group(1) if m else None
        if not slug or slug in EXCLUDED_OPPORTUNITY_SLUGS:
            continue

        if slug not in content_by_slug:
            print(f"  fetching real sub-page: {slug} ...")
            try:
                data = fetch_inspace_page(session, token, slug)
                content_by_slug[slug] = dis.parse_inspace_opportunity_subpage(data, doc["title"])
            except Exception as e:
                print(f"  !!! failed to fetch sub-page {slug}: {e}")
                content_by_slug[slug] = None
            time.sleep(0.5)

        page = content_by_slug[slug]
        if page:
            doc["raw_text"] = page.get("raw_text")
            # Deliberately a SEPARATE field from doc["url"] (the sub-page link
            # itself, already set by parse_inspace_opportunities[_archive]) --
            # keeps both real references distinct rather than overwriting one.
            if page.get("url"):
                doc["attachment_url"] = page["url"]


def bootstrap_inspace_session() -> tuple:
    """Loads a real inspace.gov.in page once to get session cookies + the
    real CSRF token, both required by the /api/now/sp/page JSON API.
    Raises RuntimeError if the token isn't found -- callers must not
    silently proceed with a missing/None token, since every subsequent
    API call would then fail or return an auth-rejected response."""
    session = requests.Session()
    resp = session.get(
        SECTION_URLS[("INSPACE", "AUTHORIZATIONS")],
        headers={"User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    m = _G_CK_RE.search(resp.text)
    if not m:
        raise RuntimeError(
            "Could not find the real IN-SPACe CSRF token (var g_ck = ...) in the "
            "bootstrap page -- the ServiceNow portal's page structure may have "
            "changed. Re-inspect the live page rather than proceeding with no token."
        )
    return session, m.group(1)


def fetch_inspace_page(session: requests.Session, token: str, page_id: str) -> dict:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-UserToken": token,
    }
    resp = session.get(
        f"{INSPACE_BASE_URL}/api/now/sp/page",
        headers=headers,
        params={
            "id": page_id,
            "portal_id": INSPACE_PORTAL_ID,
            "request_uri": f"/inspace?id={page_id}",
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def scrape_inspace(existing_ids: set) -> list:
    all_rows = []

    print("\n========== IN-SPACe: bootstrapping session + CSRF token ==========")
    session, token = bootstrap_inspace_session()
    print("session + token OK")

    print("\n========== IN-SPACe: Authorizations ==========")
    data = fetch_inspace_page(session, token, "inspace_authorizations")
    docs = dis.parse_inspace_authorizations(data)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "INSPACE", "AUTHORIZATIONS", True, existing_ids))

    print("\n========== IN-SPACe: NGP ==========")
    data = fetch_inspace_page(session, token, "inspace_ngp_update_page")
    docs = dis.parse_inspace_ngp(data)
    print(f"{len(docs)} real row(s) found")
    all_rows.extend(build_rows(docs, "INSPACE", "NGP", True, existing_ids))

    print("\n========== IN-SPACe: Publications ==========")
    data = fetch_inspace_page(session, token, "inspace_publications")
    docs = dis.parse_inspace_publications(data)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "INSPACE", "PUBLICATIONS", True, existing_ids))

    print("\n========== IN-SPACe: Data Disseminators ==========")
    data = fetch_inspace_page(session, token, "inspace_data_disseminator_page")
    docs = dis.parse_inspace_data_disseminators(data)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "INSPACE", "DATA_DISSEMINATORS", True, existing_ids))

    print("\n========== IN-SPACe: Events ==========")
    data = fetch_inspace_page(session, token, "inspace_events_list")
    docs = dis.parse_inspace_events(data)
    print(f"{len(docs)} real rows found")
    all_rows.extend(build_rows(docs, "INSPACE", "EVENTS", True, existing_ids))

    print("\n========== IN-SPACe: Opportunities (current) ==========")
    data = fetch_inspace_page(session, token, "inspace_opportunities_page")
    docs = dis.parse_inspace_opportunities(data)
    print(f"{len(docs)} real rows found -- fetching real sub-page content (excluding pure courses/webinars/internships)")
    fetch_opportunity_subpages(session, token, docs)
    all_rows.extend(build_rows(docs, "INSPACE", "OPPORTUNITIES", True, existing_ids))

    print("\n========== IN-SPACe: Opportunities (archive) ==========")
    data = fetch_inspace_page(session, token, "inspace_opportunities_archive")
    docs = dis.parse_inspace_opportunities_archive(data)
    print(f"{len(docs)} real rows found -- fetching real sub-page content (excluding pure courses/webinars/internships)")
    fetch_opportunity_subpages(session, token, docs)
    all_rows.extend(build_rows(docs, "INSPACE", "OPPORTUNITIES_ARCHIVE", True, existing_ids))

    return all_rows


# ============================================================================
# CSV / JSON I/O
# ============================================================================

def append_to_master(rows):
    exists = os.path.exists(MASTER_CSV)
    with open(MASTER_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


def write_new_entries(rows):
    with open(NEW_JSON, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)


def _has_real_attachment(row: dict) -> bool:
    url = row.get("url") or row.get("attachment_url") or ""
    return "sys_attachment.do" in url or url.lower().endswith(".pdf")


# Real, individually verified (2026-08-19 audit) cases where the SAME real
# document is genuinely indexed more than once by these sites themselves.
# Deliberately an explicit allowlist, NOT a generic "same title" heuristic
# -- a generic rule is unsafe here for two real, confirmed reasons:
#   1. Recurring scheme names collide on title but are genuinely different
#      documents -- confirmed live: "Engagement of Young Professionals"
#      covers two real recruitment cycles with different real deadlines
#      (20 June 2026 vs 19 January 2026).
#   2. ISRO Tenders' titles are built from the Advt. No. cell, which can
#      legitimately repeat across a tender's own real lifecycle -- e.g.
#      "SAC/CMG/CPHD/CW/EPC-I/02/2026-2027 Dated:25.06.2026" appears on
#      both the original NIT and its own corrigendum, confirmed via two
#      different real PDF filenames (a "Detailed_NIT_..." and a
#      "corrigendum1_..."). A corrigendum is a genuinely distinct real
#      instrument (CCI's own taxonomy treats corrigenda this way too),
#      not a re-listing of the same document -- auto-merging these would
#      silently drop a real regulatory document, which is worse than
#      leaving two same-titled entries for a human to tell apart. NOT
#      merged here, and not merged automatically by any heuristic; only
#      the 5 specifically verified cases below are.
KNOWN_DUPLICATE_TITLES = {
    "Indian Space Policy 2023",  # hosted on isro.gov.in AND re-listed on
                                  # IN-SPACe's own Publications page --
                                  # confirmed same real policy document
    "Notification on the validity of the capacity provisioning contracts",  # IN-SPACe's
                                  # own Publications list indexes this real
                                  # notification twice under two different
                                  # real categories -- confirmed directly
                                  # in the site's own client_script data
    "EO Consultation Paper",  # appears in both Publications and the
                               # Opportunities archive -- confirmed same
                               # real consultation paper, no distinguishing
                               # real content on either side
    "Press Meet - Briefing by Dr. K Sivan, Chairman, ISRO",  # two real
                               # isro.gov.in Press Release pages with
                               # identical title and no distinguishing
                               # real content
    "UNNATI (UNispace Nanosatellite Assembly & Training by ISRO)",  # same
                               # as above -- two real Press Release pages,
                               # same real programme, no distinguishing
                               # content
}


def deduplicate_by_title(rows: list) -> list:
    """Merges ONLY the 5 explicitly verified real cross-listing duplicates
    in KNOWN_DUPLICATE_TITLES (see its own comment for why this is an
    allowlist, not a generic title-match heuristic). Keeps the row with a
    real downloadable attachment (sys_attachment.do or .pdf) when
    available, over a row whose only real link is another listing/sub-page.
    Every other same-titled group (e.g. ISRO Tenders' NIT/corrigendum
    pairs, or any future title collision not on this list) is left alone
    -- unmerged duplicates are a real, flagged UX issue (see the 2026-08-19
    audit), but silently dropping a real, distinct document would be
    worse."""
    by_title: dict = {}
    for row in rows:
        by_title.setdefault(row["title"], []).append(row)

    deduped = []
    dropped_count = 0
    for title, group in by_title.items():
        if len(group) == 1 or title not in KNOWN_DUPLICATE_TITLES:
            deduped.extend(group)
            continue

        with_attachment = [r for r in group if _has_real_attachment(r)]
        keep = with_attachment[0] if with_attachment else group[0]
        deduped.append(keep)
        dropped_count += len(group) - 1
        print(f"  [DEDUP] \"{title[:70]}\" -- {len(group)} real listings for the same document, "
              f"kept {keep['source']}/{keep['category']}, dropped {len(group)-1}")

    if dropped_count:
        print(f"\nDeduplication: kept {len(deduped)} of {len(rows)} rows ({dropped_count} real cross-listing duplicates merged)")
    return deduped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sources",
        nargs="*",
        default=None,
        choices=["ISRO", "NSIL", "INSPACE"],
        help="Optional: limit to specific sources (e.g. --sources NSIL) for a small test run.",
    )
    args = parser.parse_args()

    ensure_dirs()
    existing_ids = load_existing_ids()
    print(f"Loaded {len(existing_ids)} existing records")

    sources_to_run = args.sources or ["ISRO", "NSIL", "INSPACE"]

    all_new_rows = []
    seen_this_run = set()

    scrapers = {"ISRO": scrape_isro, "NSIL": scrape_nsil, "INSPACE": scrape_inspace}
    for source in sources_to_run:
        rows = scrapers[source](existing_ids)
        for row in rows:
            if row["id"] in seen_this_run:
                continue
            seen_this_run.add(row["id"])
            all_new_rows.append(row)
        time.sleep(1)

    print("\n========== Deduplicating cross-listing duplicates ==========")
    all_new_rows = deduplicate_by_title(all_new_rows)

    print("\n====================")
    print("New entries:", len(all_new_rows))
    from collections import Counter
    by_source_category = Counter((r["source"], r["category"]) for r in all_new_rows)
    for k, v in sorted(by_source_category.items()):
        print(f"  {k[0]}/{k[1]}: {v}")

    if all_new_rows:
        append_to_master(all_new_rows)
    write_new_entries(all_new_rows)
    print("CSV + JSON updated")


if __name__ == "__main__":
    main()
