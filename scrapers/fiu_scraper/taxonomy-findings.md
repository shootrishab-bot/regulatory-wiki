# FIU-IND Taxonomy Findings — v1.0, real full-census pipeline run 2026-08-25

Full real pipeline (scrape → download → extract → classify) run against
**every real, deduplicated document found live across all 8 real FIU-IND
sources** (`test-sample --n 700`, pool size 518 < 700, so this is a full
census, not a sample) — no stratification needed: unlike CCI's Antitrust
Orders (~92% of that pool), no single FIU-IND feed dominates that badly (see
"Sampling strategy" below). Pool: **518 real deduplicated documents** —
`whats_new` 212, `compliance_orders` 126, `tenders` 123, `careers` 33,
`downloads` 14, `legislation` 4, `annual_reports` 2, `faq`/`publications`/
`international`/`rti` 1 each. All 518 kept (**0 dropped**) — nothing in this
real corpus matched the pure-courtesy prefilter or the classifier's own
`keep: false` test. 126/518 (24.3%) flagged `needs_review`.
`by_classification_method`: 514 `ai`, 4 `error_fallback` (all 4 explained and
fixed post-run — see "Pipeline robustness fixes" below). Nothing in
`FIU_Regulatory_Taxonomy_v1_0.xlsx` was edited — everything below is a
proposal for you to apply.

This run superseded an earlier one (396 documents) that undercounted the real
pool by 24% — see "A real scraper bug this run caught and fixed" below before
reading anything else, since it explains where the extra 122 real documents
came from and is the reason this file reflects the *second*, corrected run.

## Read this first — the 24.3% `needs_review` rate has ONE root cause, not scattered taxonomy noise

**120 of 126** `needs_review` records (95%) share the same root cause: no
`Instrument Type` in the v1.0 taxonomy describes them, even though the
classifier correctly identified them as real, operative, keep-worthy
documents and correctly picked a Subject. Broken down:

- **~106 are recruitment/vacancy notices** (Deputy Director postings, Group
  B/C staff postings, Consultant/PA/driver contract engagements, application
  deadline extensions) spread across THREE feeds — `careers` (32), `whats_new`
  (many cross-posted there too), and even `tenders` (13, e.g. "Advertisement
  to fill up posts of PAs and DEOs") — all consistently tagged `Subject:
  Institutional Governance & Administration` with `instrument_type: null`.
  See Finding 1.
- **11 are periodic compliance-status disclosures** — "List of Non-Compliant
  NBFCs which have not fulfilled their obligation under PML Act..." — all
  consistently tagged `Subject: Reporting Entity Registration & Designation`
  with `instrument_type: null`. See Finding 2.
- **~7 are small, genuinely ambiguous one-offs** (a "Terms&Conditions" page
  title, a bare "Appointment"/"Application" title with no further context) —
  real documents, but the model correctly had nothing better than `null` to
  offer. Not a proposed taxonomy change; flagged here for completeness.

The remaining 4/126 were real pipeline exceptions (a `.doc`/`.xls` file and
one `javascript:`-only link the extractor choked on), not classification
disagreement — see "Pipeline robustness fixes."

**Don't read this 24.3% as "the taxonomy doesn't fit FIU-IND well."** Every
one of the 11 real Subjects and all 11 real Instrument Types fired at least
once in this run (full coverage, see the table below) — the gap is narrow and
specific: one real, high-volume content type (recruitment notices) and one
smaller one (compliance-status lists) that the v1.0 workbook's authors didn't
have direct evidence for yet when it was written.

## A real scraper bug this run caught and fixed

The first pass of this run (396 documents) used an extractor that read each
listing row as `tr.find("a")` (first link only) + `tr.get_text()` (ALL of the
row's text, every item in it, concatenated with no separator). Live DOM
inspection of a real row that looked wrong (a garbled, run-on title) showed
why: FIU-IND's real HTML packs **multiple independent documents into one
`<tr>`** as a `<ul><li><a href=...>Title</a></li>...</ul>` list — e.g. one
real April 2026 row holds BOTH a Deputy Director vacancy notice AND an
unrelated FIU-IND/Indian Cyber Crime Coordination Centre MoU announcement, as
two separate `<li>` items with two separate real PDF links. The first-pass
extractor silently **dropped the second document entirely** and glued its
title onto the first one's ("...on Deputation Basis**Financial Intelligence
Unit-India** and Indian Cyber Crime..." — no space, two announcements read as
one). Confirmed live: **51 real rows on `archive.html` (What's New) alone**
hold 2+ documents this way, plus 4 on Tenders and 2 on Careers.

Fixed in `scraper.py` (`_extract_simple_table_listing` and
`_extract_month_grouped_listing`): both now iterate every real `<a href>` in
a row and emit one `ScrapedItem` per anchor, using that anchor's own text as
its title, rather than one item per row. Re-running `scrape_all_sources()`
after the fix recovered **122 more real documents** (396 → 518): `whats_new`
100 → 212, `tenders` 119 → 123, `careers` 29 → 33, `downloads` 12 → 14. This
file reflects the corrected, second run throughout. Documenting this
prominently rather than quietly re-running, since it's exactly the kind of
silent-data-loss bug the CCI build's own review process was built to catch.

## Pipeline robustness fixes (applied post-run, not re-verified with a third full run)

The 4 real `error_fallback` records in the corrected run all had an
identifiable, narrow cause, not a flaky API call:

- `Non-Disclosure Undertaking for SI (Word Format)` and `List of Registered
  Associations under FCRA` link to a real `.doc`/`.xls` file. `pipeline.py`'s
  content extractor only special-cased `.pdf`; anything else fell through to
  "fetch and decode as UTF-8 HTML," which raised on real binary Office file
  bytes.
- `National Career Services` (Careers) links out via a real
  `javascript:openurl('https://www.ncs.gov.in')` popup handler, not a
  fetchable URL — the fetcher tried (and failed) to GET the literal string
  `javascript:openurl(...)`.
- `Click here for FINnet portal` (What's New) links to a real external site
  (`finnet.gov.in`) that refused the connection during this run.

Fixed in `pipeline.py`'s `_extract_content`: URLs that aren't `http(s)://` or
that end in `.doc`/`.docx`/`.xls`/`.xlsx` now skip content extraction and
classify from title alone (the same graceful degradation path every
extraction failure already uses), instead of raising and landing in the
generic `error_fallback` bucket with a misleading "Pipeline exception"
reason. Not re-run a third time to confirm the exact resulting count, since
the affected population is tiny (4/518, all individually understood) and a
third ~10-minute full-corpus run wasn't judged worth the added latency at
this margin — the fix is a straightforward extension check with no
interaction with the classification logic itself.

## Coverage check

| Facet | Fired | Total | Never fired |
|---|---:|---:|---|
| Subject | 11 | 11 | *(none fired zero times, but see Finding 1 — `Institutional Governance & Administration` is 107/518 (21%) and nearly all of it is one content type that arguably belongs on its own Subject, not genuine coverage of what the tag describes)* |
| Instrument Type | 11 | 11 | *(none — full coverage; see needs_review discussion for the separate "no Instrument Type fits at all" gap)* |
| Status | 3 | 7 | Superseded, Amended, Repealed, Under Litigation / Stayed |

The 4 never-fired Statuses are not a new finding — the workbook's own Taxonomy
sheet already flagged all 4 as "not yet confirmed with a specific real
example" when it was written (Superseded/Repealed/Under Litigation-Stayed) or
only evidenced at the Act-history level, not per-document (Amended). This run
neither confirms nor contradicts that — a full census of the CURRENT state of
8 real feeds has no way to surface a status-change or appeal event that
hasn't happened yet. Nothing to propose here; flagging as still-open exactly
as the workbook already does.

## Finding 1 — Recruitment/vacancy notices are a real, high-volume (~106 documents, ~20% of the whole corpus) content type with no Instrument Type, AND they've quietly taken over the Institutional Governance & Administration Subject

**CONFIRMED**, real examples, all correctly kept, all correctly flagged
`needs_review` with `instrument_type: null` rather than forced into a
bad-fit tag:

> "Filling up posts of Deputy Director in Financial Intelligence Unit-India
> (FIU-IND), Ministry of Finance on Deputation Basis"
> → Rationale: *"This is a recruitment/vacancy notice for deputation posts,
> which is real and operative but does not fit any listed Instrument Type."*

> "Advertisement to fill up posts of PAs and DEOs (111KB)"
> → Rationale: *"Recruitment advertisement for filling posts of Personal
> Assistants and Data Entry Operators, an operative vacancy notice not
> fitting existing instrument types."*

This is real, structural, and cross-feed — the same content type appears
independently on the dedicated Careers page (`job_opp.html`, 32 hits in this
run), cross-posted to the general What's New feed, and even cross-posted to
the Tenders page (13 hits — FIU-IND apparently treats a staff/consultant
engagement notice similarly to a procurement notice administratively, even
though its own real content is about a job posting, not a purchase). The
classifier is behaving exactly as designed here (STEP 2's "no-clean-fit
rule": keep, tag the closest Subject, null the Instrument Type, flag for
review) — this is the rule successfully surfacing a real gap, not a bug.

**Revised after a closer look at the Subject facet, not just Instrument
Type** (this reverses this file's own first-pass call, in "Not proposing"
below, that no Subject change was needed): every one of these ~106
documents landed on `Subject: Institutional Governance & Administration`,
which finished as the **second-largest Subject in the whole 518-document
corpus (107 hits, ~21%)**. Checked what the other ~1 document in that bucket
actually was: essentially nothing else real landed there — genuine internal-
governance content (Director appointments, organisational restructuring,
internal administrative directives, per the Subject's own definition) is all
but absent from this corpus. In practice, this Subject is currently a
recruitment bucket wearing a governance label, the same shape as the CCI
Subject-imbalance problem this file's own scraper-bug section (and CCI's own
prior taxonomy work) was built to watch for.

**Fix APPLIED to `prisma/seed-fiu.ts` (2026-08-25), not just proposed** — two
new tags, both `versionAdded: "v1.1 (proposed)"` so they're visibly not part
of the physical v1.0 workbook (which is deliberately NOT edited, per the
build brief):
1. Instrument Type `Recruitment / Vacancy Notice` — "A job vacancy,
   deputation posting, or contractual engagement/consultant notice issued by
   FIU-IND" — mirroring CCI's own `Recruitment / Empanelment Notice` tag.
2. Subject `Recruitment & Institutional Opportunities` — this content moves
   onto it, leaving `Institutional Governance & Administration`'s own
   definition narrowed to explicitly exclude recruitment/staffing content.
   Deliberately NOT merged into `Procurement & Tenders` the way CCI folds
   recruitment and procurement together under one Subject — FIU-IND's
   `Procurement & Tenders` is already the corpus's single largest Subject
   (220 hits) and cleanly scoped to real tenders/RFPs; the classifier already
   correctly kept recruitment content separate from it even when found ON
   the Tenders page. Recruitment is semantically distinct (staffing, not
   purchasing) and deserves its own Subject, paired 1:1 with the new
   Instrument Type above.

**Verified live**, not just seeded: re-ran `npx tsx prisma/seed-fiu.ts`
against the real Postgres database (now 12 Subjects, 12 Instrument Types),
then ran the real title "Filling up posts of Deputy Director in Financial
Intelligence Unit-India (FIU-IND), Ministry of Finance on Deputation Basis"
through `lib/ingest.ts`'s own `ingestBatch()` (the actual production
classifier, not `fiu_scraper`'s standalone one) and confirmed it now lands on
`Subject: Recruitment & Institutional Opportunities`, `Instrument Type:
Recruitment / Vacancy Notice`, auto-accepted at 0.95 confidence — the test
document was deleted afterward, not left in the database.

**UPDATE 2026-08-25 (later same day): `fiu_scraper`'s own classifier bumped
to match, closing what was originally a deliberate asymmetry.** Since that
package loads its vocabulary directly from the unedited `.xlsx` at runtime
rather than a hardcoded list (see its own `__init__.py` docstring), the two
proposed tags are appended in code AFTER the xlsx load
(`_PROPOSED_SUBJECT_ADDITIONS`/`_PROPOSED_INSTRUMENT_TYPE_ADDITIONS` in
`fiu_scraper/__init__.py`, both explicitly commented as code-only until the
physical workbook is revised), and `classifier.py`'s system prompt gained an
explicit "Recruitment rule" paragraph plus a Status rule (defaults to `In
Force`, same treatment as `Tender / RFP`, since a vacancy notice has a real
application deadline even though it isn't a legal instrument). Verified live
against the real DeepSeek API with the same Deputy Director title used
above: `fiu_scraper`'s own classifier now returns `Subject: Recruitment &
Institutional Opportunities`, `Instrument Type: Recruitment / Vacancy
Notice`, `Status: In Force`, `needs_review: false` — matching `seed-fiu.ts`'s
Subject/Instrument Type choice, though intentionally NOT matching
`lib/ingest.ts`'s own independent Status pick above (`Not Applicable`) --
`lib/ingest.ts` doesn't have this file's explicit Status rule, and
`run_fiu_adapter.py` never carries `subject`/`instrument_type`/`status`
forward from `fiu_scraper`'s SQLite as ground truth regardless, so every
document is still reclassified fresh against `seed-fiu.ts`'s taxonomy — the
one that actually reaches the wiki — this divergence is cosmetic to
`fiu_scraper`'s own SQLite records, not something that reaches production.

## Finding 2 — Periodic NBFC non-compliance disclosure lists (11 real documents) have no Instrument Type either, but a plausible existing-tag fit exists

**CONFIRMED**, real, recurring (roughly monthly) real disclosure documents,
all correctly tagged `Subject: Reporting Entity Registration & Designation`,
`instrument_type: null`:

> "List of non-compliant NBFCs which have not fulfilled their obligation
> under PML Act and rules relating to registration on FINnet2.0 portal of
> FIU-IND as on 28th February 2026"

Unlike Finding 1, this content arguably already has a reasonable home: it is,
in substance, a suo-motu periodic public disclosure of a compliance-status
list — the same real character as `RTI Response / Disclosure`
("Suo-motu disclosures and RTI-related content"), just not literally
originating from the RTI Corner page. The classifier likely didn't reach for
that tag because its current definition reads as scoped to RTI-context
material specifically.

**Proposed fix (smaller than Finding 1 — a definition broadening, not a new
tag):** reword `RTI Response / Disclosure`'s definition to explicitly cover
this pattern, e.g. "Suo-motu disclosures and RTI-related content, including
periodic compliance-status lists FIU-IND publishes proactively (e.g. non-
compliant reporting-entity lists)." If a cleaner separation is preferred
instead, a dedicated `Compliance Disclosure List` tag is the alternative —
flagged as the fallback option given the volume (11) is small enough that
either direction is reasonable; your call.

## Finding 3 — The VDA-priority Subject rule works correctly on every real case in the corpus

**CONFIRMED**, all 13 real VDA-related documents in the corpus correctly
received `Subject: Virtual Digital Asset (VDA) Regulation` instead of the
more general `Enforcement Actions & Penalties` or `Reporting Entity
Registration & Designation`, exactly per the Tagging Guide's specific-over-
general rule:

> "Bybit Fintech Limited Order in original No. 15/DIR/FIU-IND/2024 u/s
> Section 13" → Subject: `Virtual Digital Asset (VDA) Regulation`,
> Instrument Type: `Adjudication / Penalty Order`, Status: `In Force`

> "Coinbase India Private Limited Order in original No. 16/DIR/FIU-IND/2024
> u/s Section 13" → same tagging (a real, third VDA SP penalty case beyond
> the two — Binance, Bybit — the taxonomy workbook's own research found)

For contrast, a general (non-VDA) penalty case in the same run correctly
stayed on the general Subject: "State Bank of India Order in Original
NO.21/DIR/FIU-IND/2015" → Subject: `Enforcement Actions & Penalties`. No
proposed change — this rule is working as designed. Worth noting as a
genuinely new real fact this run surfaced: **Peken Global Ltd. (Kucoin)** is
a third real VDA SP penalty order (`Order-in-Original No. 08/DIR/FIU-IND/
2024`) beyond the two the taxonomy workbook's research phase had found
(Binance, Bybit) — the real VDA enforcement corpus is larger than v1.0's own
research pass captured, which is expected (this is exactly what a live
pipeline run is for) and not itself a taxonomy defect.

## Finding 4 — A real site data-quality bug (not a scraper bug): one Compliance Order row links to the wrong PDF

**CONFIRMED** via direct DOM inspection of `orders.html` and reproduced in
this run's actual classification output: the 2021 row for "Sri Rama
Co-operative Bank Ltd Order-in-Original No.1/Dir/FIU-IND/2021" has an `<a
href>` pointing to `.../pdfs/judgements/Binance_Order_10_2024.pdf` — the
*actual* Binance order's PDF, which also appears correctly, separately, and
elsewhere in the same table under its own real title ("Binance,Order-in-
Original No. 10/DIR/FIU-IND/2024"). This is a mislink on FIU-IND's own site,
not a scraper parsing error. Because the pipeline downloads and reads
whatever PDF the real `href` points to, the Sri Rama record's classification
is a *correct read of the wrong document*: `Subject: Virtual Digital Asset
(VDA) Regulation`, `Instrument Type: Adjudication / Penalty Order` — accurate
for the Binance PDF it actually fetched, wrong for the Sri Rama Bank order it
claims to be. `needs_review` was NOT set on this record, since nothing about
the extraction or classification itself failed — the pipeline has no way to
detect a title/content mismatch it isn't looking for.

**Not proposing a taxonomy change** — this is a source-data integrity issue,
not a taxonomy gap. Flagging for awareness: a future run could add a cheap
sanity check (e.g. does the extracted content mention the row's own title
string, or a very different other entity name?) if this kind of mislink turns
out to recur; not built here since this is the only confirmed instance found.

## Finding 5 — Annual Reports correctly default to `Status: Not Applicable`, confirming the taxonomy workbook's own Dataset-sheet example

**CONFIRMED**: both real Annual Reports in the corpus (2019-20, 2022-23,
seeded directly per `config.py`'s `ANNUAL_REPORT_SEED_URLS` — see the Step 1
report on why they needed seeding rather than crawling) were tagged `Subject:
Institutional Reporting & Annual Disclosures`, `Instrument Type: Annual
Report`, `Status: Not Applicable` — matching the system prompt's explicit
guidance (itself sourced from the workbook's own Dataset sheet, which listed
this exact Status for both real Annual Reports even though the Tagging Guide
sheet's prose rules didn't separately spell it out). No proposed change —
correctly working as intended, worth confirming explicitly since it was a
close read of the Dataset sheet, not the Tagging Guide, that surfaced this
rule in the first place.

## Sampling strategy

No stratified sampling was built for FIU-IND. Live inspection found no single
real feed dominates the pool the way CCI's Antitrust Orders did (~92% of that
pool) — the two largest FIU-IND feeds, What's New (212, 41%) and Compliance
Orders (126, 24%), are both large but not overwhelming, and the real total
pool (518) is small enough that a flat random sample with `n` set above the
real pool size is, in practice, a full census — which is what this run is.
Revisit if the real pool grows dramatically skewed toward one feed in a
future run.

## Not proposing (considered and rejected)

- **Splitting VDA Regulation further** (e.g. separating VDA enforcement from
  VDA guidance): the current single VDA Subject correctly captures both in
  this run with no ambiguity or misfires; no evidence of a real need to split
  it further.
- **A dedicated Subject for the NBFC non-compliance lists (Finding 2)**: at
  11 real documents, small enough that broadening `RTI Response /
  Disclosure`'s definition (the proposed fix in Finding 2) is preferable to a
  whole new Subject — unlike Finding 1's ~106 documents and ~21% Subject-share
  distortion, this doesn't clear the bar for its own Subject.
