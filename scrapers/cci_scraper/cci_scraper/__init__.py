"""
CCI Regulatory Scraper & Watcher
Target: cci.gov.in
Taxonomy: CCI_Regulatory_Taxonomy_v1_1.xlsx (Taxonomy / Tagging Guide / Dataset / Schema Note)

NOTE 2026-08-18: TAXONOMY_VERSION below is tracked as v1_3 and STATUSES now
includes "Not Applicable" -- these are the two fixes proposed in
taxonomy-findings.md (Regulation vs. Notification, and a Status value for
non-instrument outreach content), applied here at the code/prompt level so
the second-pass stratified test can actually evaluate them. The physical
`CCI_Regulatory_Taxonomy_v1_1.xlsx` workbook has NOT been regenerated to
match -- that file still says v1.1 and still lacks "Not Applicable". Until
someone updates the real workbook, this constants file is temporarily ahead
of it; regenerate the workbook (or revert these constants) once that's
reconciled.

This package fixes three structural problems found in review of the two prior drafts:

1. Classification is AI-first against full document text, never a regex/keyword
   guess standing in as the final tag. A cheap regex pre-filter exists only to
   reject the narrow, unambiguous band of pure-PR content before spending a
   token -- it never assigns a Subject/Instrument Type/Status itself, and it
   is biased toward sending ambiguous items to the model rather than dropping
   them, because a false-positive drop loses data permanently while a
   false-negative just costs one extra API call.

2. The taxonomy's own controlled vocabulary is the single source of truth.
   The classifier is told explicitly that "this is pure PR with no operative
   consequence" is a `keep: false` decision, not a tag -- it must never invent
   a Subject like "PR Content" that doesn't exist in the workbook. Every
   returned subject/instrument_type/status is validated against the real
   vocabulary; anything not on the list is nulled out and the record is
   flagged for review rather than silently trusted.

3. AJAX-driven search pages (Antitrust Orders, Combination Notifications) are
   handled API-discovery-first: a Playwright network listener captures the
   real XHR/fetch call the site's own JS makes when the search form is used,
   and that's what gets hit on subsequent runs (cheap, reliable) rather than
   driving a full browser on every scrape. If no JSON API is found, it falls
   back to scraping the rendered DOM after submitting the real form. Which
   path actually applies has NOT been verified against the live site from
   this environment -- see README "What still needs live verification."
"""

TAXONOMY_VERSION = "CCI_Regulatory_Taxonomy_v1_3"

SUBJECTS = [
    "Anti-competitive Agreements & Cartel Enforcement",
    "Abuse of Dominant Position",
    "Combination Review & Approval",
    "Combination Filing & Procedure",
    "Combination Compliance & Enforcement",
    "Competition Law Framework",
    "Rulemaking & Public Consultation",
    "Market Studies & Economic Research",
    "Competition Advocacy & Outreach",
    "International Cooperation",
    "Institutional Governance & Administration",
    "Recruitment, Procurement & Institutional Opportunities",
    "Public Information & Transparency",
]

INSTRUMENT_TYPES = [
    "Act",
    "Regulation",
    "Notification",
    "CCI Order",
    "Public Notice / Consultation Notice",
    "Press Release",
    "Tender / RFP",
    "Recruitment / Empanelment Notice",
    "Annual Report",
    "Market Study / Research Report",
    "FAQ",
    "Award of Work / Institutional Notice",
]

STATUSES = [
    "In Force",
    "Draft / Under Consultation",
    "Superseded",
    "Amended",
    "Repealed",
    "Under Litigation / Stayed",
    "Not Applicable",
]

REGULATOR_CODE = "cci"
