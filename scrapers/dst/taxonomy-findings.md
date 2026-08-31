# DST Taxonomy Findings — v2.0, real batch run 2026-08-17

Full real pipeline (scrape → extract → Markdown/OCR → classify) run against
all 4 source clusters: **692 real documents** (dst-core 24, dst-calls 350,
nsdi 7, aistic 311). 375 auto-accepted, 317 flagged for review, 0 errors.
Findings below are from reading the real classification output against the
real taxonomy, not simulated. Nothing in `DST_Regulatory_Taxonomy_v2_0.xlsx`
was edited — these are proposals for you to apply.

## Coverage check

All 9 Subjects and all 8 Instrument Types got at least one real document —
no dead tags to prune this round. Two of the 4 formal-instrument Status
values never fired: `Superseded` (0 real documents — consistent with the
workbook's own note that this was "not directly evidenced... but the
mechanism is confirmed to exist," so not a new finding) and `Amended` (0 —
this **is** a new finding, see below, since the workbook's own Dataset sheet
named two specific real documents it expected to land here).

## Finding 1 — `Amended` status never fires, even on the two documents the workbook itself named for it

**CONFIRMED.** The workbook's Dataset sheet explicitly expects two real
documents to be tagged `Status: Amended`:

- "OM on Revision of Fellowship under different Programmes of WISE-KIRAN
  Division" — workbook: *"Status: Amended (revises base WISE-KIRAN
  fellowship terms)"*
- "Fellowship Hike WISE-PhD 20231018" — workbook: *"Status: Amended"*

Real classifier output for both, this run: **`Status: In Force`**, not
Amended. (Reasons given: *"The document is an OM revising fellowship
emoluments, which is a financial administrative action, and it is currently
operative"* / *"...currently operative."*) Both were auto-accepted at 0.95
confidence — the model isn't uncertain, it's confidently landing on the
wrong value for this pattern specifically.

**Proposed fix:** add an explicit Tagging Guide rule + example (the existing
rule about self-referential Amended/Superseded is present but evidently not
concrete enough for the model to apply to this real pattern):

> A document that revises the rate/amount/terms of an underlying scheme it
> does not itself constitute (e.g. a fellowship-hike OM) is `Amended`, even
> though the document *itself* was never a previous version being replaced —
> "the scheme's terms changed" counts as self-referential change for this
> purpose, not just "a literal new edition of this exact document exists."
> Example: "Fellowship Hike WISE-PhD 20231018" → `Amended`, not `In Force`.

## Finding 2 — 3 real scope-mismatch cases, all resolvable by moving Subject, not adding a tag

**CONFIRMED**, caught live by the new `status_subject_scope_mismatch`
validation (lib/ingest.ts) built for this taxonomy's hybrid Status vocabulary
— exactly the kind of signal it was built to surface:

- "Revision of fellowship in Women Scientist Scheme" → Subject: `Funding
  Calls & Proposals (Domestic)`, Status: `In Force` (wrong group for that
  Subject)
- "Revision in Post Doctoral Fellowship in Nano Science & Technology" → same
  pattern
- "Format and guidelines for the scheme Science & Technology for Women" →
  same pattern

All 3 are administrative revision/guideline documents about an *existing*
scheme's terms, not a dated Call for Proposals with its own application
window — structurally identical to the WISE-KIRAN/WISE-PhD documents in
Finding 1, which correctly landed under `Financial Rules & Fund
Administration` (a formal-instrument Subject) rather than a Funding Calls
Subject. These 3 didn't get that same routing, which is exactly why they hit
the wrong Status group.

**Proposed fix:** add a Tagging Guide rule distinguishing "a document that
*is* a Call for Proposals" from "a document *about* an existing scheme's
administration" — same shape of judgment call the workbook already makes for
recruitment ads vs. recruitment rules:

> A document that revises, clarifies, or restates the terms/format/
> guidelines of an *already-existing* scheme is `Financial Rules & Fund
> Administration` (or `Service Conditions & Recruitment Rules`, if it's
> fellowship/personnel-terms specific), not a Funding Calls Subject — even
> when the scheme itself is a funding scheme. Funding Calls Subjects are
> reserved for the original Call for Proposals / RFP document that opens a
> specific, dated application window. Example: "Format and guidelines for
> the scheme Science & Technology for Women" → `Financial Rules & Fund
> Administration`, not `Funding Calls & Proposals (Domestic)`.

Applying this fix would also make Finding 1's WISE-KIRAN pattern more
consistent to apply, since it's the same underlying distinction.

## Finding 3 — Funding Calls dominate the real corpus far more than the taxonomy's "primary vs. secondary layer" framing suggests

**CONFIRMED**, real volume count, not a tagging error:

| Subject | Count | Share |
|---|---:|---:|
| Funding Calls & Proposals (Bilateral/International) | 273 | 39% |
| Funding Calls & Proposals (Domestic) | 264 | 38% |
| Proposal Results & Selection Lists | 111 | 16% |
| National S&T Policies | 16 | 2% |
| Service Conditions & Recruitment Rules | 9 | 1% |
| Financial Rules & Fund Administration | 8 | 1% |
| Governance and Administration | 7 | 1% |
| Statutory Notifications & Gazette Instruments | 3 | <1% |
| Ethics & Conflict of Interest Guidelines | 1 | <1% |

The three Funding Calls Subjects are **94%** of the real corpus; the six
"core regulatory" Subjects the v2.0 rescoping was built around are 6%
combined. This isn't a tagging defect — dst-core's real pages are
genuinely thin (confirmed: e.g. `acts-orders` has exactly one real
document), while aistic's real archive alone is 311 documents. Not
proposing a taxonomy change here, just flagging it: if the wiki's UI design
assumes "funding calls" is a lighter secondary browsing category, the real
data says otherwise, and that's worth knowing before building around the
opposite assumption.

## Data-quality note (not a taxonomy issue) — aistic.gov.in has substantial real link rot

317 of 692 real documents (46%) failed extraction. Root cause, confirmed
directly (not assumed): aistic.gov.in's file-serving endpoint
(`/ASEAN/AbstractFilePath?...`) returns a real `HTTP 200` with
`Content-Length: 0` for many pre-2018 archived documents — confirmed
server-side dead files, not a scraper/auth issue (tested with real session
cookies + a real Referer header; the server correctly identified the
request and returned `Content-Type: application/pdf` with a real filename in
`Content-Disposition`, but the underlying file itself is empty). Recent
documents (2024–2026) extract cleanly — spot-checked two real recent PDFs at
1.3MB and 14KB. All 317 are still ingested and correctly flagged
`text_extraction_failed` (classified from title alone, confidence intact) —
none were silently dropped. Nothing to fix on our side; flagging in case DST
is ever asked to restore these files.

## What I did NOT change

`DST_Regulatory_Taxonomy_v2_0.xlsx` itself — all three proposed fixes above
are Tagging Guide rule additions for you to apply, per the build brief's
instruction not to edit the workbook directly.
