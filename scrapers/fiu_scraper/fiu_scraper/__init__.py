"""
FIU-IND Regulatory Scraper & Watcher
Target: fiuindia.gov.in
Taxonomy: FIU_Regulatory_Taxonomy_v1_0.xlsx (Taxonomy / Tagging Guide / Dataset / Schema Note)

Mirrors cci_scraper/'s structure and the three structural fixes that package
made over its own prior drafts: AI-first classification against full document
text (never a regex/keyword guess as the final tag), the taxonomy workbook's
controlled vocabulary as the single source of truth (every returned tag is
validated, never trusted blind), and a cheap pre-filter that is deliberately
biased toward sending ambiguous items to the model rather than dropping them.

ONE difference from cci_scraper: this package has no api_discovery.py. Live
inspection of all real FIU-IND source pages (2026-08-25, see
../taxonomy-findings.md) found every one of them is static, server-rendered
HTML with no AJAX/JSON API anywhere -- confirmed by fetching each page with a
plain `requests` GET (no session warm-up, no cookies, no CSRF) and finding
real content in the initial response every time. CCI's AJAX-discovery
machinery (Playwright network listener, DOM fallback) has nothing to attach
to here, so it was not built. If a future redesign of fiuindia.gov.in
introduces a JS-rendered listing page, port api_discovery.py over from
cci_scraper/ at that point rather than guessing at a fix now.

ANOTHER difference: the controlled vocabulary below is loaded directly from
FIU_Regulatory_Taxonomy_v1_0.xlsx at import time, not hand-copied into a
Python literal the way cci_scraper/__init__.py's SUBJECTS/INSTRUMENT_TYPES/
STATUSES were. That hand-copying was flagged in CCI's own build as worth
automating once there was a natural place to do it -- this is that place.
Keeping the workbook as the single physical source of truth means a future
taxonomy revision only has to touch the .xlsx, not this file too.

PROPOSED ADDITIONS (2026-08-25): two tags from ../taxonomy-findings.md
Finding 1 -- Subject "Recruitment & Institutional Opportunities" and
Instrument Type "Recruitment / Vacancy Notice" -- are NOT in the physical
.xlsx (which stays unedited, per the build brief) but ARE now live in
prisma/seed-fiu.ts (versionAdded "v1.1 (proposed)"), since a real pipeline
run found recruitment/vacancy content had come to make up ~99% of what was
landing on the general "Institutional Governance & Administration" Subject
with no Instrument Type fitting it at all. Rather than break the "load
straight from the workbook, no hardcoded literal" design this file's own
docstring above argues for, the two proposed tags are appended in code AFTER
the xlsx load, in their own clearly-separate _PROPOSED_* constants below --
same "code temporarily ahead of an unedited workbook" pattern
cci_scraper/__init__.py used for its own "Not Applicable" Status addition,
just structured as an addition on top of a load rather than a fully
hand-copied list. Delete _PROPOSED_SUBJECT_ADDITIONS/
_PROPOSED_INSTRUMENT_TYPE_ADDITIONS (and this note) once the physical
workbook is actually revised to include these two tags.
"""

from pathlib import Path
from typing import Dict, List

REGULATOR_CODE = "FIU"

# scrapers/fiu_scraper/fiu_scraper/__init__.py -> repo root is 4 levels up.
_TAXONOMY_XLSX_PATH = Path(__file__).resolve().parents[3] / "FIU_Regulatory_Taxonomy_v1_0.xlsx"

_FACET_TO_KEY = {
    "Subject": "subjects",
    "Instrument Type": "instrument_types",
    "Status": "statuses",
}


def _load_taxonomy(xlsx_path: Path) -> Dict[str, List[str]]:
    """Reads the Taxonomy sheet's (Regulator, Facet, Tag Name, ..., Status,
    Version Added, ...) rows and returns the three ACTIVE-only tag-name lists,
    in workbook row order. The workbook's own 'Status' column (col F, ACTIVE/
    DEPRECATED governance) is distinct from the 'Status' FACET (col B) rows
    that hold the actual Status vocabulary values like 'In Force' -- both are
    named "Status" but mean different things, don't conflate them."""
    if not xlsx_path.exists():
        raise FileNotFoundError(
            f"Taxonomy workbook not found at {xlsx_path}. This package loads its "
            "controlled vocabulary directly from FIU_Regulatory_Taxonomy_v1_0.xlsx "
            "(kept at the repo root) instead of a hardcoded list -- make sure it's "
            "present and checked into the repo."
        )

    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb["Taxonomy"]

    out: Dict[str, List[str]] = {"subjects": [], "instrument_types": [], "statuses": []}
    header_seen = False
    for row in ws.iter_rows(values_only=True):
        if not header_seen:
            if row[:3] == ("Regulator", "Facet", "Tag Name"):
                header_seen = True
            continue
        regulator, facet, tag_name = row[0], row[1], row[2]
        governance_status = row[5] if len(row) > 5 else None
        if not regulator or not facet or not tag_name:
            continue
        key = _FACET_TO_KEY.get(str(facet).strip())
        if key is None:
            continue
        if governance_status and str(governance_status).strip().upper() != "ACTIVE":
            continue
        out[key].append(str(tag_name).strip())
    return out


_taxonomy = _load_taxonomy(_TAXONOMY_XLSX_PATH)

# See the module docstring's "PROPOSED ADDITIONS" note -- mirrors
# prisma/seed-fiu.ts's identical two "v1.1 (proposed)" tags exactly, kept in
# sync by hand since these live in two different languages/files.
_PROPOSED_SUBJECT_ADDITIONS: List[str] = ["Recruitment & Institutional Opportunities"]
_PROPOSED_INSTRUMENT_TYPE_ADDITIONS: List[str] = ["Recruitment / Vacancy Notice"]

SUBJECTS: List[str] = _taxonomy["subjects"] + _PROPOSED_SUBJECT_ADDITIONS
INSTRUMENT_TYPES: List[str] = _taxonomy["instrument_types"] + _PROPOSED_INSTRUMENT_TYPE_ADDITIONS
STATUSES: List[str] = _taxonomy["statuses"]

TAXONOMY_VERSION = "FIU_Regulatory_Taxonomy_v1_0 + 2 code-only v1.1-proposed tags (see taxonomy-findings.md)"

if not (SUBJECTS and INSTRUMENT_TYPES and STATUSES):
    raise RuntimeError(
        f"Taxonomy load from {_TAXONOMY_XLSX_PATH} produced an empty facet "
        f"(subjects={len(SUBJECTS)}, instrument_types={len(INSTRUMENT_TYPES)}, "
        f"statuses={len(STATUSES)}) -- the workbook's Taxonomy sheet layout may "
        "have changed; inspect it before trusting anything downstream."
    )
