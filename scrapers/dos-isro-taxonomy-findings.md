# DOS-ISRO Taxonomy Findings — v1.0, real full-corpus run 2026-08-19

Full real pipeline (scrape → normalize → classify) run against the entire
real corpus available at this stage: **544 real documents** across all 4
sources (isro.gov.in, IN-SPACe, NSIL; DOS confirmed dead) and 13 real
(source, category) combinations. 0 errors, 494 auto-accepted, 40 flagged for
review (7.4%), 10 skipped as already-ingested duplicates (from an earlier
10-document pipeline smoke test). Findings below are from reading the real
classification output against the real taxonomy, not simulated. Nothing in
`DOS_ISRO_Regulatory_Taxonomy_v1_0.xlsx` was edited.

## Coverage check

| Facet | Fired | Total | Never fired |
|---|---:|---:|---|
| Subject | 12 | 12 | — (full coverage) |
| Instrument Type | 8 | 11 | Act / Bill, FAQ, RTI Response / Disclosure |
| Status | 5 | 6 | Amended (see Finding 1 — real gap, but not the one first reported here; corrected below) |

All 12 Subjects fired on real documents — no dead Subject tags. The 3
never-firing Instrument Types are structurally absent from these 4 sources,
same pattern already established for CCI/DST: none of isro.gov.in,
inspace.gov.in, or nsilindia.co.in publish primary legislation (no Space
Activities Act exists yet — the taxonomy's own Notes column already expects
this), a public FAQ page, or RTI disclosure content through the sources
scraped so far. Not proposing removal.

## Finding 1 — `Amended` Status never fires — CORRECTED after review

**The first version of this finding was wrong, and worth recording why.**
It originally claimed that 11 real Authorization documents titled
"Amendment No. N" should themselves be tagged `Amended` rather than `In
Force`. That's backwards. Thinking about it the way a lawyer would: an
amendment is itself a freestanding instrument — once issued (and not itself
later amended or repealed), it is currently operative, so `In Force` is the
*correct* tag for the amendment document itself. `Amended` describes the
**base instrument that got modified**, not the amending instrument. The
model's original classifications (amendments tagged `In Force`) were right;
my finding was backwards.

**The real, corrected finding, re-checked directly against the base
documents**: 6 real base Authorizations in this corpus have at least one
later real amendment also in the corpus, and every one of the 6 bases is
*still* tagged `In Force`, not `Amended` — confirmed by matching each
amendment's referenced Authorization Number back to its own base document's
row:

| Base Authorization | Real amendments in corpus | Base's current Status |
|---|---|---|
| PMA/IN-SPACe/AUTH/2025/90 | 90A, 90B | In Force |
| PMA/IN-SPACe/AUTH/2025/89 | 89A, 89B, 89C | In Force |
| PMA/IN-SPACe/AUTH/2024/56 | 56A | In Force |
| PMA/IN-SPACe/AUTH/2025/93 | 93A | In Force |
| PMA/IN-SPACe/AUTH/2024/61 | 61A | In Force |
| PMA/IN-SPACe/AUTH/2025/75 | 75A, 75B | In Force |

**Why this is a genuinely harder fix than a Tagging Guide rule, and worth
flagging honestly rather than proposing something that won't work**: the
pipeline classifies each document independently, from its own title/content
alone. The base Authorization (e.g. `.../2025/90`) was issued *before* its
amendment existed — there is nothing in that document's own text for the
model to notice that would justify tagging it `Amended` at classification
time. No per-document prompt rule can fix this, because the information
needed (a later amendment exists) isn't available when the base document is
classified. The real fix is a **cross-referencing post-processing step**,
not a taxonomy or prompt change: after a batch is classified, match each
Authorization-type document whose title references "Amendment No. N (ref.
Authorization No. X)" back to document X in the corpus, and if X's current
Status is `In Force`, update it to `Amended`. This is a real feature to
build (a supersession/amendment-chain resolver), out of scope for a
prompt-level Tagging Guide fix, and not attempted in this pass.

## Finding 2 — `needs_review` is 6x concentrated in IN-SPACe Opportunities (current + archive), a real scraper/adapter limitation, not a taxonomy defect

**CONFIRMED.** Overall `needs_review` rate is 7.4% (40/544), but broken down
by source category:

| Category | Flagged | Total | Rate |
|---|---:|---:|---:|
| INSPACE_OPPORTUNITIES | 10 | 17 | 59% |
| INSPACE_OPPORTUNITIES_ARCHIVE | 15 | 32 | 47% |
| Everything else combined | 15 | 495 | 3% |

This matches exactly what `dos_isro_adapter.py`'s own docstring flagged as a
known limitation before this run: Opportunities entries link to a real
inspace.gov.in sub-page (`?id=...`) rather than a direct file, and those
sub-pages aren't scraped yet (each is its own bespoke Angular-rendered
content page needing the same session/token bootstrap the main pages use).
`needs_download` was deliberately set to `False` for these, so classification
runs on title + category alone — titles like "Internship", "SBaaS",
"Technology Adoption Fund", "Test Facilities, Reviews etc." are genuinely
too short to classify confidently, and the real results confirm it: e.g.
*"Title suggests administrative governance content, likely a notification,
and no indication of amendment or repeal"* for "Test Facilities, Reviews
etc." — a fair guess, explicitly flagged as low-confidence, not a wrong
guess dressed up as a confident one.

**Not a taxonomy problem** — the Subject/Instrument Type combinations chosen
for these are all individually plausible given the thin signal available.

**FIXED, same day.** Built `fetch_opportunity_subpages()` in
`dos_isro_watcher.py`: fetches each real, non-excluded Opportunities
sub-page using the same IN-SPACe session/token mechanism already used for
Authorizations/NGP, per explicit direction to scrape sub-pages relevant to
a regulatory/legal audience. Excluded 16 of 49 real rows that are pure
training courses, webinars, internships, or student competitions with no
regulatory/business substance (`EXCLUDED_OPPORTUNITY_SLUGS` in
`dos_isro_watcher.py`, e.g. "Course on Essentials of Space Technology in
Agriculture," "Semiconductor Webinar," "Internship") — everything else
(EoI, AO, RFP, Fund, Registration, Recruitment, Empanelment, Technology
Transfer, Advisory Note, Consultation Paper) was scraped: 33/49 real rows
now carry real page content, deleted and re-classified against Postgres.

**Real, measured result**: `needs_review` in this category dropped from
25/49 (51%) to 3/49 (6%), and confidence on the auto-accepted records rose
from mostly 0.6-0.7 to mostly 0.9-0.95. All 3 still-flagged records
("Internship," "Fundamentals of Orbital Mechanics...," "Space Technology
for Agriculture") are among the 16 deliberately excluded rows, still
running on title alone as expected — not a new problem, confirms the fix
is targeting the right cause.

## Finding 3 — real pipeline bug: an NSIL Tenders record with a rejected Status tag despite confident, correct reasoning

**CONFIRMED, worth a closer look at `lib/ingest.ts`'s Status validation (not
the taxonomy's own vocabulary, which is fine).** One real record:

> "Supply and Services of New Website of NSIL — Tender Reference Number in
> CPPP - NSIL/26-27/IT Website/01" → `needs_review: true`,
> `reviewReasons: ["model_returned_invalid_status_tag"]`, `status: null`,
> `subjectConfidence: 0.95`, rationale: *"...the tender is currently
> active."*

The model clearly intended an operative status (rationale says "currently
active," confidence is high) but whatever string it actually returned for
Status didn't match any of the 6 real `DOS-ISRO` Status tag names exactly,
so `lib/ingest.ts`'s vocabulary validation correctly rejected it rather than
silently trusting an out-of-vocabulary value — the validation is working as
designed. This is a single occurrence in 544 real documents (not a
systemic pattern the way Finding 1 is), but worth a quick check of what
string the model actually returned for this one record, in case it's a
subtle, recurring near-miss (e.g. "Active" vs "In Force") rather than a true
one-off.

## What's working well (not a finding, a confirmation)

The Data Disseminators dataset (88 real EO/DDR registration records, brand
new to this pipeline) classified cleanly: 0 flagged, consistently landing on
`Subject: Remote Sensing Data Policy & Licensing` / `Instrument Type:
Authorization` / `Status: In Force`, all at 0.9-0.95 confidence, with
correct, specific rationale referencing each record's real validity date.
The taxonomy's decision to treat data-disseminator registrations as a form
of Authorization (rather than inventing a separate Instrument Type) holds up
well against 88 real, varied examples.

## Data-quality note (not a taxonomy issue) — the 12 broken-link ISRO Press Releases surface again here

12 of the 113 real ISRO Press Release rows have a genuinely broken
`href="#"` link on the live site (confirmed during the scraper build, see
`dos_isro_scraper.py`'s own module docstring) and are classified from title
alone. Several of them (e.g. "BIPA Arbitration Award," "Conference On
Enabling Spacecraft Systems Realization through Industries") appear in this
run's `needs_review` set — expected, already-understood behavior, not a new
finding, just confirming the earlier scraper-stage flag correctly propagates
into lower classification confidence downstream rather than being silently
absorbed.

## What I did NOT change

`DOS_ISRO_Regulatory_Taxonomy_v1_0.xlsx` itself — both proposed fixes above
(the Amended-status Tagging Guide rule, and the Opportunities sub-page
scraping enhancement) are for you to apply. Did not touch the classifier
prompt or `lib/ingest.ts`'s validation logic in this pass.
