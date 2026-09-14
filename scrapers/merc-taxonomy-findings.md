# MERC Taxonomy Findings — v1.0 tested against a real 100-document random sample, 2026-09-10

Full real pipeline (scrape → normalize → classify → Postgres) built and run
against **merc.gov.in**. Nothing in `MERC_Regulatory_Taxonomy_v1_0.xlsx` was
edited; the revised workbook is a separate file
(`MERC_Regulatory_Taxonomy_v1_1.xlsx`), generated from an explicit revision
spec so every change can be traced to evidence below.

## What was built and run

| Step | Artefact | Result |
|---|---|---|
| Scrape | `scrapers/merc_watcher.py` | **20,740 real documents**, 40 feeds |
| Normalize | `scrapers/merc_adapter.py` | 20,654 with a file URL, 19,069 with a parseable date |
| Seed | `prisma/seed-merc.ts` | 9 Subjects, 10 Instrument Types, 7 Status values |
| Classify | `scripts/ingest-sample.ts MERC … 100 --seed 20260910` | 100 documents, 0 errors |
| Analyse | `scripts/analyze-taxonomy-run.ts` | see below |

The sample is a **uniform random draw over the whole 20,740-document corpus**
with a recorded seed, not the first 100 rows of a feed. That distinction is
the whole point: the taxonomy was built from research into MERC's Orders and
Regulations, and a front-loaded sample would have kept confirming that
research instead of testing it.

## The corpus MERC actually publishes

This is the finding everything else follows from. The v1.0 workbook was built
from research that found real Orders, real Regulations, real Draft Orders and
real Corrigendum Orders — all of which exist. What the research could not see,
because it never enumerated the corpus, is the **shape** of it:

| Share | Rows | Content | v1.0 Instrument Type for it |
|---:|---:|---|---|
| 48.2% | 9,995 | Hearing notices / cause-list documents | **none** |
| 19.8% | 4,105 | Final Orders | `Order` ✓ |
| 11.8% | 2,448 | Daily Orders (procedural) | **none** |
| 5.7% | 1,183 | Press releases and public notices | `Press Release` / `Public Notice` ✓ |
| 5.3% | 1,094 | RTI replies, appeals, disclosures | `RTI Response / Disclosure` ✓ |
| 2.8% | 581 | Regulations (existing / repealed / draft) | `Regulations` ✓ |
| 2.0% | 416 | Standards of Performance compliance data | **none** |
| 1.3% | 279 | MERC's own procurement tenders | **none** |
| 0.8% | 158 | Recruitment advertisements | **none** |
| 0.8% | 157 | Committee minutes and constitution notifications | **none** |
| 0.5% | 94 | Sector reports (distribution/transmission/generation) | `Annual Report` only |
| 0.4% | 84 | Licences issued | **none** |
| 0.3% | 66 | Acts, policies, GoI/GoM rules | `Act` ✓ (partly) |

**Roughly 60% of what MERC publishes is procedural case management, and the
v1.0 taxonomy has no Instrument Type for any of it.** The workbook is not
wrong about what it covers; it is incomplete about what it has to cover.

## Coverage against the real sample

| Facet | Fired | Total | Never fired |
|---|---:|---:|---|
| Subject | 8 | 9 | Public Communication & Outreach |
| Instrument Type | 5 | 10 | Act, Annual Report, Corrigendum Order, Draft Order, FAQ |
| Status | 4 | 7 | Amended, Repealed, Superseded |

**40 of 100 documents were flagged for review (40%).** For comparison, read
straight out of the same Postgres instance: DOS-ISRO 3.2% over 563 entries,
DOT 4.1% over 592, ESIC 7.3%, EPFO 8.1%, CCI 8.6% over 1,320. 39 of MERC's 40
flags were `low_confidence` and 7 were `text_extraction_failed` (6 documents
carried both). A 40% flag rate is itself the headline number: this is not a
model that is uncertain, it is a vocabulary that does not have the words.

Two of the ten Instrument Types absorbed nearly everything — `Order` (47) and
`Public Notice / Consultation Notice` (42) took **89 of 100** documents between
them. Two tags carrying 89% of a corpus is a taxonomy that has collapsed into
a pair of catch-alls, not one that is working.

---

## Finding 1 — Hearing notices have no Instrument Type, and it shows

**48.2% of the real corpus, 47 of the 100 sampled documents.**

Every one of the 47 was forced into a tag that does not describe it, and the
classifier split one homogeneous document class two ways:

| Assigned Instrument Type | Assigned Status | Count |
|---|---|---:|
| `Public Notice / Consultation Notice` | `Not Applicable` | 37 |
| `Order` | `In Force` | 9 |
| `Public Notice / Consultation Notice` | `In Force` | 1 |

Mean confidence across all 47: **0.715**. **29 of the 47 (62%) were flagged for
review.** A taxonomy that fits its corpus does not split one document class
three ways across two Instrument Types and two Statuses.

The classifier's own reasons say what these documents are, unprompted:

> "This is a **hearing notice** for a petition seeking approval of a spinning
> reserve operationalization procedure…"
> "This is a **hearing rescheduling notice** for Case No. 24 of 2014, a
> procedural administrative communication…"
> "This is a **hearing notice** issued by the Commission communicating the
> e-Hearing schedule and procedural directions…"

It knows. It has nowhere to put it.

**What these documents really are** (read directly from the PDFs, not
inferred): a formal document headed `NOTICE`, issued "Before the Maharashtra
Electricity Regulatory Commission", addressed to named Petitioner(s) and
Respondent(s) in a numbered case, communicating that "e-Hearing in this matter
is scheduled on Thursday, 29th October, 2026 at 11.00 AM" and directing the
parties to nominate representatives.

That is neither of the two tags it was given. `Public Notice / Consultation
Notice` is defined in v1.0 as "a notice inviting stakeholder comments on a
draft Regulation or draft Order" — a hearing notice invites nobody to comment
on anything; it directs named parties to appear. `Order` is defined as "a real,
operative case-specific Order disposing of a petition" — a hearing notice
disposes of nothing.

**Proposed: add Instrument Type `Hearing Notice`.**

## Finding 2 — Daily Orders are silently mis-tagged as final Orders

**11.8% of the corpus, 13 of the 100 sampled.** All 13 were tagged `Order` —
12 as `In Force`, 1 as `Under Litigation / Stayed` (see Finding 4) — mostly
unflagged and at reasonable confidence, which is exactly why this one is worth
catching. Finding 1 announces itself through low confidence; this one does
not.

A real MERC Daily Order, read from the PDF:

> CORAM: Valsa Nair Singh, Chairperson / Anand M. Limaye, Member / Surendra J.
> Biyani, Member … **Daily Order** … 1. Heard the Advocate for the Petitioner
> and Respondent. 2. The Petitioner submitted that…

It is a real, coram-signed order of the Commission recording what happened at
a hearing and issuing interim directions. It is **not** a final Order
disposing of the petition — the case continues. Filing both under one tag
means a query for "MERC's decisions in Case No. 66 of 2023" returns every
adjournment slip alongside the decision, and there is no way to separate them.

MERC itself keeps them separate: they are a distinct feed with a distinct
label, and the corpus also contains real documents titled **"Draft Daily
Order"**, which the v1.0 vocabulary cannot express at all.

**Proposed: add Instrument Type `Daily Order`.**

## Finding 3 — Status is undefined for procedural documents, so it was guessed inconsistently

**50 of 100 documents were tagged `Not Applicable`** — the single largest
Status value in the sample, on a taxonomy whose `Not Applicable` is defined as
covering "press releases, FAQs, and other non-instrument content". Only 4 of
the 100 documents were press releases or FAQs.

Worse, the split within the hearings feed tracks the Instrument Type split
almost exactly: 37 documents tagged `Public Notice` got `Not Applicable`, 9
tagged `Order` got `In Force`, and 1 crossed over. Identical documents,
opposite Status, decided almost entirely by which wrong Instrument Type they
happened to land in.

The taxonomy never says what Status a procedural document takes, so the
classifier inferred one from the Instrument Type it had already guessed. That
is a taxonomy gap producing a compounding error, not a model failure.

**Proposed:** widen the `Not Applicable` definition to name procedural and
administrative communications explicitly, and add a Tagging Guide rule fixing
the two cases:

- A `Hearing Notice` is a spent, one-time procedural communication about a
  calendar event. It has no ongoing legal state. → `Not Applicable`.
- A `Daily Order` is an operative order of the Commission whose interim
  directions bind the parties until the final Order. → `In Force`.

## Finding 4 — The one `Under Litigation / Stayed` in the run is wrong, and the workbook's own rule does not catch it

Exactly one of the 100 documents was tagged `Under Litigation / Stayed`, at
confidence **0.85** — high enough to be auto-accepted with no review flag. It
is wrong, and it is wrong in a way worth fixing in the taxonomy rather than
blaming on the model.

The document is a Daily Order in Case No. 44 of 2014. Its real text, read from
the PDF:

> The Advocate of MSEDCL submitted that it has challenged the Judgment of the
> ATE dated 22 April, 2015 in Appeal No. 169 of 2014 before the Supreme Court
> in Civil Appeal No. 5708 of 2015. Supreme Court vide Order dated 3 August,
> 2015 directed to issue Notice. MSEDCL has also filed Interim Application
> before Supreme Court to stay the Judgment of the ATE, **however no stay has
> been granted by the Supreme Court.**

Two independent reasons the tag is wrong. The litigation concerns the
**ATE's judgment**, not this Daily Order — a document that *narrates*
litigation about a different instrument is not itself under appeal. And the
document says in terms that **no stay was granted**, so nothing is stayed at
all.

The v1.0 Tagging Guide has a Status rule here, and it is a good one: "Do not
infer Status: Under Litigation / Stayed from an Order's size, tariff impact,
or the prominence of the licensee involved. Require explicit evidence of a
real APTEL appeal or a stay order." The document *does* contain explicit
evidence of a real appeal — just not of this document. The rule guards against
inferring from prominence and says nothing about **whose** litigation counts.

The generic classification prompt has exactly this self-referential rule for
`Amended` and `Superseded` ("applies ONLY when the document ITSELF has been
changed or replaced"). `Under Litigation / Stayed` needs the same sentence,
and MERC is the regulator where it bites, because Daily Orders routinely
recite the parties' submissions about proceedings elsewhere.

**Proposed:** add a Tagging Guide rule requiring that the appeal or stay
concern *this* document, and that a stay be granted rather than merely sought.

## Finding 5 — The site's own hearing `status` column must NOT be mapped to the Status facet

The Hearings feed carries a real, source-provided `status` column. The
temptation is to treat it the way MTCTE's `Active`/`Expired` column is
treated — as ground truth that overrides the classifier. **It must not be**,
and the real data shows why on two independent grounds.

First, it is not the same kind of fact. MTCTE's column describes an
*instrument's* lifecycle; MERC's describes a *hearing's* calendar state. A
hearing notice for a hearing that was later adjourned is still a validly
issued notice.

Second, it is not a controlled vocabulary at all. The live feed carries **91
distinct values** across 7,071 rows, most of them free text typed per row:

| Value | Rows |
|---|---:|
| Completed | 6,085 |
| Reschedule with further notice | 1,419 |
| Reschedule | 1,380 |
| Scheduled | 236 |
| Postponed till further notice | 197 |
| Schedule | 70 |
| `5` | 55 |
| "Rescheduled on Friday 20/October/2023 10:30 AM" | 24 |
| …83 more, including `0` and "Competed" | |

`Schedule`/`Scheduled`, `Reschedule`/`Rescheduled`, and the literal values `5`
and `0` are the same field. This is decided in the scraper
(`merc_adapter._hearing_status_note`) and recorded here so nobody later
"fixes" it by wiring it up.

## Finding 6 — `Public Communication & Outreach` never fired, because MERC's "Press Release" section is not press releases

0 of 100 in both runs. The sampled documents from MERC's own Press Release and
What's New feeds went to `Licensing`, and the single document that did get the
`Press Release` Instrument Type took `Tariff Determination` as its Subject.

Reading the real feed explains it: MERC's press releases are overwhelmingly
statutory public notices — "Inviting Suggestions / Objections on Application of
the Jalna Power Transmission Limited…", "Inviting Comments on Application of
Mindspace Business Parks Private Limited for amendment of its licence…". These
are notices in a licensing or tariff matter that happen to be published through
the press-release channel and as newspaper advertisements. They have real
operative content, so `Public Communication & Outreach` ("announcements with no
operative regulatory content of their own") correctly refuses them.

This is **not** a dead tag to delete — the classifier's behaviour was right and
the tag's definition is doing its job. It is a tag whose real population is
much smaller than the feed name suggests.

**Proposed:** keep the tag, and add a Tagging Guide rule stating that a
document published in MERC's Press Release section which invites
suggestions/objections on a specific licence or tariff application takes the
Subject of the underlying matter, not `Public Communication & Outreach`.

## Finding 7 — 4.4% of the corpus is Marathi-language versions of English documents

905 real rows (4.4%) are the Marathi version of a document also published in
English — hearing notices (385), press releases (243), draft regulations (77).
784 more rows are explicitly labelled English, most with a Marathi twin.

The v1.0 workbook says nothing about this, and it is a real decision with real
consequences: a Marathi PDF extracts as Devanagari text, which is why several
of the sample's lowest-confidence classifications are Marathi twins
(`Tata Power-T MTR 2025 Petition_Exec Summary-Marathi`, 0.75;
`MERC Marathi [Case No. 141 of 2024]`, 0.40).

**Proposed:** add a Tagging Guide rule — a Marathi-language version carries
the same Subject / Instrument Type / Status as its English original and is not
dropped, because it is the legally published version for a large part of
MERC's real audience. Where both exist, the English text is the one to
classify from.

## Finding 8 — Five Instrument Types and three Status values did not fire, for three different reasons

Not all silence is the same, and the workbook should not treat it as such.

**Genuinely rare, keep:** `Act` (1 document in a 20,740 corpus — the
Electricity Act, 2003) and `FAQ` (MERC publishes none through any scraped
feed). A 100-document sample cannot reach either. No change.

**Present in the corpus, not reached by a 100-document sample:**
`Corrigendum Order` (20 real rows carry MERC's own literal `CORRIGENDUM ORDER`
category, including the 28 April 2023 Corrigendum Order the workbook's own
Dataset sheet cites), `Draft Order`, `Superseded`, `Repealed` (82 real rows
sit in MERC's own "Repealed Regulations" and "Repealed Guidelines" sections),
`Amended`. At those corpus shares, expecting them in 100 documents would be
wrong. No change, but they remain **untested**, and this document should not
be read as having validated them.

`Annual Report` is a case of its own worth recording, because the two runs
disagreed about it. In the first run it fired exactly once — on a **quarterly**
Standards of Performance data file, at confidence 0.40, the lowest Instrument
Type assignment in the run. After the scraper's title fix gave that same
document its real title ("Q3 — SEZ Biotech – 1: Standards of Performance of
Distribution Licensees…"), the second run moved it to `Order` at 0.60. Both
are wrong, and the disagreement is the point: with no `Report` tag available
there is no stable answer for it to converge on. MERC's 47 real Annual Report
rows exist; none was drawn.

**On `Under Litigation / Stayed`:** it fired once, and wrongly — see Finding 4.
The workbook's Schema Note proposes building a real MERC→APTEL cross-reference
once both scrapers exist; **that remains unbuilt and untested**, and nothing in
this run supports it. What this run does show is that the tag is reachable by
accident before that infrastructure exists, which strengthens rather than
weakens the case for building it.

## Finding 9 — 7% of PDFs failed text extraction

7 of 100 documents were flagged `text_extraction_failed` and classified from
title alone. Two contributing causes are confirmed in the corpus: 149 rows
point at non-PDF files (89 `.zip`, 39 `.jpg`, 8 `.png`, 7 `.xlsx`, 6 `.jpeg`)
which `pdf-parse` cannot read by construction, and an unmeasured share of the
older PDFs are scans with no text layer. The adapter already passes a correct
`file_extension_hint`, so the non-PDF case is distinguishable downstream; the
scanned case would need OCR, which this pipeline does not have.

---

## What changed after applying v1.1, measured on the same 100 documents

The revised taxonomy (`MERC_Regulatory_Taxonomy_v1_1.xlsx`, seeded by
`prisma/seed-merc.ts`) was applied and **the identical 100 documents were
re-classified from scratch** — same seed, same sample file, MERC's rows deleted
in between so nothing was skipped as a duplicate. Two v1.1 passes are reported
because the first one surfaced Finding 10 and the second measures the fix for
it.

| | v1.0 | v1.1 first pass | v1.1 after the Finding 10 fix | **final v1.1, re-measured 2026-09-14** |
|---|---:|---:|---:|---:|
| **Flagged for review** | **40** | 18 | 17 | **21** |
| Auto-accepted | 60 | 82 | 83 | **79** |
| `low_confidence` flags | 39 | 17 | 13 | **21** |
| `text_extraction_failed` | 7 | 7 | 7 | **7** |
| Instrument Types firing | 5 of 10 | 10 of 18 | 10 of 18 | **9 of 18** |
| Largest single Instrument Type | `Order`, 47% | `Hearing Notice`, 37% | `Hearing Notice`, 40% | **`Hearing Notice`, 43%** |
| Two largest tags' combined share | **89%** | 64% | 65% | **68%** |
| Hearing notices given one consistent tag pair | no (3 ways) | yes (32/32) | yes (40/40) | **43 of 47 feed rows, all 43 `Not Applicable`** |
| Daily Orders given one consistent tag pair | no | no (3/12) | yes (14/14) | **yes (14/14)** |
| Wrong `Under Litigation / Stayed` | 1 | 0 | 0 | **0** |

**Why there is a fourth column.** The first three were measured on 2026-09-10
and 09-11. Finding 11 below then changed two Instrument Type definitions, and
those changes were seeded at ~16:00 on 09-11 — *after* the third-pass numbers
were recorded. The corpus in Postgres was therefore classified against a
taxonomy that the workbook no longer shipped, and the three-column table
described a state the code could not reproduce. The fourth column re-runs the
identical 100 documents (same seed, same sample file, MERC's rows deleted in
between) against the final wording, and it is the only column that describes
what this repository actually produces today.

Two things move in opposite directions and both are real. The section-naming
fix worked: hearing-feed rows landing on `Hearing Notice` went **35 → 43 of
47**, and `Order` fell 31 → 25, with the exact document Finding 11 names
("Petition of M/s Adani Power Maharashtra Limited for the assignment of
Transmission License…") back on `Hearing Notice`. But the flag count is **21,
not 17**, and `low_confidence` is **21, not 13** — the third-pass figures
understated it, and the honest reading is that naming the sections moved
documents onto the right tag while leaving the model appropriately unsure about
many of them. `Licence` also stopped firing, so it returns to the untested
list. The two tag-pair consistency claims both hold exactly: **Hearing Notice →
Not Applicable, 43 of 43**, and **Daily Order → In Force, 14 of 14**.

Confidence rose everywhere, which matters more than the flag count because it
is not a threshold artefact: `Hearing Notice` classifies at **0.82** mean
confidence against the 0.72 that the same documents scored when forced into
`Public Notice / Consultation Notice`, and every Subject tag now sits between
0.76 and 0.93 (v1.0's range was 0.64–0.86). Those two figures are from the
2026-09-14 re-run; the third pass had recorded 0.85 and a 0.79–0.91 range.

Every new tag the sample could reach did fire: `Hearing Notice` (43),
`Daily Order` (14), `Report` (1), `Minutes of Meeting` (1). The 5 documents
still on `Public Notice / Consultation Notice` are the ones that genuinely are
public consultation notices, which is now what that tag is for.

`Licence` is the one tag whose status changed between passes: it fired once in
the 09-11 pass, on a real transmission licence, and did not fire at all on
09-14. One document is too thin a basis to call a tag validated either way, so
it rejoins the untested list below rather than being counted as confirmed.

`text_extraction_failed` stayed at exactly 7 across all three passes, as it
should — that is a PDF problem, not a taxonomy problem, and no vocabulary
change can move it.

Four of the eight new Instrument Types (`Notification`, `Recruitment Notice`,
`Tender / RFP`, and — jointly with the pre-existing ones — `Act`, `Annual
Report`, `Corrigendum Order`, `Draft Order`, `FAQ`) still did not fire. For the
four new ones that is expected and was stated when they were proposed: their
corpus shares are 0.9%, 0.8% and 1.3%, below what 100 documents can reach.
They remain **untested**.

## Finding 10 — Tagging Guide rules never reach the classifier

Found by measuring the v1.1 pass rather than assuming it worked, and it is the
most transferable finding in this document.

The v1.1 Tagging Guide has one rule with two halves: a `Hearing Notice` takes
`Not Applicable`, and a `Daily Order` takes `In Force`. In the first v1.1 pass
the two halves behaved completely differently:

| | First v1.1 pass |
|---|---|
| Hearing Notice → Not Applicable | **32 of 32 correct** |
| Daily Order → In Force | **3 of 12 correct** (9 took `Not Applicable`) |

The reason is architectural, not statistical. `lib/ingest.ts` builds its prompt
from tag **names and definitions** only. **It never sees the Tagging Guide
sheet at all.** The Hearing Notice half worked because that rule had also been
written into the `Not Applicable` *definition*; the Daily Order half had no
such home, so the model never learned it.

**A taxonomy rule that lives only in the Tagging Guide is documentation for
humans and has zero effect on classification.** Any rule that must bind the
pipeline has to appear inside a tag definition.

**This finding got worse when the CPPP run tested it.** Writing a rule into a
*Subject* or *Instrument Type* definition turned out not to be enough either —
those definitions were not being sent to the classifier at all. See the CPPP
findings' own Finding 7, and the third pipeline change below.

The `In Force` definition was amended accordingly — "…or a Daily Order whose
interim directions bind the parties until the final Order is issued" — and the
third pass confirms it: **Daily Order → In Force, 14 of 14**, with
`low_confidence` flags falling a further 17 → 13.

This applies to every regulator in this project, not just MERC. Several
existing workbooks carry Tagging Guide rules that are, on this evidence,
currently inert.

## Three pipeline changes made during this run

All three are regulator-agnostic and change behaviour for every regulator on
future ingests, so they are called out here rather than buried in a diff. The
third is the largest and was found by the CPPP half of this work; it is
recorded in both documents because it explains which of the MERC fixes above
worked and why.

**1. `category_hint` is now read.** The field has existed since the
NormalizedDocument contract was written, and its own docstring calls it "a
real, useful weak signal for Instrument Type classification, pass it through,
don't discard it" — but **nothing downstream ever read it**. Every adapter in
this project had been faithfully populating a field the classifier never saw.
Confirmed by grep: the only consumer was a DoT test script using it to filter a
batch. `lib/ingest.ts` now renders it into the prompt as an explicitly weak
signal that loses to the document's own text. It matters most for the two
regulators that surfaced it — MERC's Orders feed carries the Commission's own
25-value subject vocabulary in that field, and for CPPP the issuing
organisation is often the only substantive signal that exists.

**2. The self-referential Status test now covers litigation.** The prompt
already had this discipline for `Amended`/`Superseded` ("applies ONLY when the
document ITSELF has been changed or replaced"). Finding 4 showed the same test
was missing for litigation statuses, so it was added: the appeal or stay must
concern *this* document, and a stay must have been granted rather than merely
sought.

**3. Subject and Instrument Type definitions now reach the classifier at all.**
They were being sent as a bare list of tag *names* —
`JSON.stringify(tags.map(t => t.name))` — while only Status sent its
definitions. Every regulator's Subject and Instrument Type definitions, which
are the entire substance of the taxonomy workbooks, were invisible to the model
for the whole life of this project.

It explains the pattern in the MERC results above precisely. `Hearing Notice`
worked immediately because the *tag name* says what it is. `Not Applicable` and
`In Force` worked because they are Status definitions, which were already being
sent. Every fix that landed, landed for one of those two reasons — none
depended on a Subject or Instrument Type definition, because none of those was
ever read. See the CPPP findings for how it was caught.

**4. A document with no text reads the category hint differently.** Added
2026-09-11 from Finding 11 below: with no text, the hint is strong evidence
for Instrument Type only, never for Subject, Status or confidence, and the
prompt says whether the text is missing because extraction failed.

## Finding 11 — Sending definitions regressed title-only hearing notices, and the obvious fix was unsafe elsewhere

Found by re-running the same 100 documents after pipeline change 3. Five
hearing rows that v1.1 had tagged `Hearing Notice` moved to `Order` (four) and
`Daily Order` (one). All five are title-only: four are scanned or non-PDF
attachments whose extraction failed, and one has no attachment at all. Their
titles describe the petition ("Petition of M/s Adani Power Maharashtra Limited
for the assignment of Transmission License No. 2 of 2009…"), and once the
`Order` definition was visible, a petition description read as the thing being
disposed of. The source's own label, `Hearings / Cause List`, was in the prompt
only as a *weak* hint, and lost.

**The obvious fix — "no text, so trust the category" — was tested before it
was applied, and rejected.** The category hint is shared machinery. CCI's
scanned pre-2015 Antitrust Orders reach the classifier the same way (a title
plus `antitrust_orders`), and `needs_review` exists for them because a
case-name title cannot tell Section 3 from Section 4. Run against all 27
documents CCI's original pipeline test flagged, twice each:

| | prompt before | blanket rule | adopted rule |
|---|---:|---:|---:|
| flagged `needs_review` | 54/54 | 54/54 | 54/54 |
| of which `low_confidence` | 46 | 47 | **54** |
| highest confidence on a title-only order | 0.75 | **0.85** | 0.60 |
| MERC's 5 regressions fixed | — | 2 | 3 |

`needs_review` never dropped under any variant, and that is structural rather
than lucky: CCI's adapter marks every no-text document `extraction_failed`, and
`text_extraction_failed` is added in code, independent of the model. But the
blanket rule pushed a title-only order to a confidence that would auto-accept
on its own merits, and a document with no text *and no extraction failure* —
MERC's hearing row with no attachment — has only `low_confidence` to flag it.
The adopted rule makes the hint strong for **Instrument Type only**, says it is
not evidence for Subject or Status and must not raise confidence, and tells the
model whether the text is missing because extraction failed.

That fixed 3 of 5. The other two went to `Daily Order`, because
`Hearings / Cause List` fits a definition about recording a hearing as well as
one about announcing it. **Naming each type's MERC section in its own
definition fixed 5 of 5**, on both runs, every one still flagged for review,
with no control document's Instrument Type changing (30 documents, the 5 plus
25 controls). One cost is worth recording: two Daily Orders that do have text
changed Subject — one moved from an auto-accept at 0.85 to a flag at 0.72 —
and both are documents whose Subject differed under every prompt tested.

## Scraper changes made during this run

Three real bugs were found by reading real output, and all three are fixed in
`scrapers/merc_watcher.py`:

1. **Hub-page discovery returned the navigation menu.** Discovery was scoped to
   the page's `<article>` element on the assumption that MERC's site-wide nav
   sits outside it. It does not — `nav#cssmenu` is inside `<article>` on every
   page, and its sub-menus match exactly the per-category URL shapes being
   looked for. All nine hub pages "discovered" the same 13 nav links, and the
   run emitted the same Tariff Policies / Annual Reports / Guidelines rows nine
   times under nine different feed names. Dedup did not catch it, because the
   rows carried different feed labels. Fixed by dropping the chrome and scoping
   to `div.container-box`.

2. **2,078 Daily Orders were titled with a bare case number.** The feed's
   attachment label is the case number, not a description — a title like
   "171 of 2025 and 201 of 2025" is neither classifiable nor readable. The real
   descriptive text is in the PDF's own filename, which MERC's staff type by
   hand. Fixed by deriving the title from the filename stem.

3. **1,445 rows (7.0%) lost their real title to a generic attachment label.**
   Attachments after the first used their own name, which is right for Orders
   (the second attachment is a real "Transmission Licence 06 of 2026") and
   wrong for Hearings (the second attachment is a re-listing slip labelled
   "Postponed Notice"). 979 hearing rows were titled just "Postponed Notice"
   and 192 SOP rows just "Q3"/"Q2"/"Q4", with the real petition description
   discarded. Fixed: a generic label now qualifies the parent title instead of
   replacing it. **Weak titles fell from 7.0% to 0.4%**, and the sample was
   re-run from scratch against the fixed data.

The scraper also answered a question the workbook explicitly asked. Its Schema
Note says: "worth checking during scraper-build research how far back
merc.gov.in's own online archive actually goes." **The answer is 2000** — six
real Orders from 2000, 21 from 2001, then continuous coverage through 2026.
Two years deeper than the workbook's research had confirmed.

## How to reproduce this

```bash
python scrapers/merc_watcher.py                 # 20,740 rows -> scrapers/data/merc_raw.json
python scrapers/run_merc_adapter.py             # -> merc_normalized.json
npx tsx prisma/seed-merc.ts                     # seeds the v1.1 taxonomy
npx tsx scripts/reset-regulator-documents.ts MERC

# Capture the classification log: it is not a convenience, it is the input
# scripts/.audit/build_merc_dataset.py parses the Dataset sheet out of. An
# uncaptured run cannot be turned back into a workbook.
npx tsx scripts/ingest-sample.ts MERC scrapers/data/merc_normalized.json 100 --seed 20260910 \
    | tee scripts/.audit/merc-run-v1_1-final.log

npx tsx scripts/analyze-taxonomy-run.ts MERC scripts/.audit/merc-sample-20260910.json
```

Run `analyze-taxonomy-run.ts` **before** `build_merc_dataset.py`, not after: the
builder joins the run logs to `merc-run-analysis.json` for each document's
category hint, and a stale analysis makes that join miss. It now exits
non-zero when too many rows fail to join, rather than emitting a quietly
shorter Dataset sheet — which is how the 09-11 build lost two rows without
anyone noticing.

To regenerate the workbook from its revision spec:

```bash
python scripts/.audit/build_merc_dataset.py     # real Dataset rows from the run
python scripts/revise_taxonomy_workbook.py     --source "MERC_Regulatory_Taxonomy_v1_0.xlsx"     --spec   scripts/.audit/merc-revision.json     --out    MERC_Regulatory_Taxonomy_v1_1.xlsx
```
