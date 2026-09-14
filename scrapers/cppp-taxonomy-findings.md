# CPPP Taxonomy Findings — v1.0 tested against a real 100-document random sample, 2026-09-10

Full real pipeline (scrape → normalize → classify → Postgres) built and run
against **eprocure.gov.in/cppp**. Nothing in
`CPPP_Tenders_Taxonomy_v1_0.xlsx` was edited; the revised workbook is a
separate file, generated from an explicit revision spec.

## The finding that reframes everything else: most of this taxonomy is unreachable

CPPP is not like the other sources in this project, and not in the way its
v1.0 Schema Note anticipated. The workbook correctly identified that CPPP's
real content is a **tender lifecycle** (Live → Corrigendum Issued → Cancelled
/ Retendered / Awarded) rather than a legal-instrument lifecycle, and
deliberately built a Status facet to match. That design judgement was right.

What research could not establish without building a scraper is that **most of
that lifecycle is not observable from the public portal at all.** Verified
live, twice, on 2026-09-10:

| Portal function | What it would give the taxonomy | Reachable? |
|---|---|---|
| `latestactivetendersnew` | Tender Notice (NIT), Status `Live / Open` | ✅ open, ~26,360 live tenders |
| `latestactivecorrigendumsnew` | Corrigendum, Status `Corrigendum Issued` | ✅ open, ~2,590 live corrigenda |
| `highvaluetenders`, `globaltenders` | Tender Notices (subsets) | ✅ open |
| Institutional pages (9 feeds) | Circular/OM, Manual, FAQ, Press Release | ✅ open, with real PDFs |
| `resultoftendersnew` (Result of Tenders) | **Award of Contract (AoC)**, Status `Awarded / Closed` | ❌ CAPTCHA |
| `cancelledtenders` | Status `Cancelled` | ❌ CAPTCHA |
| `tendersfullview/<token>` (tender detail) | **Tender Category: Goods / Services / Works** | ❌ CAPTCHA + expiring token |
| `corrigfullview/<token>` (corrigendum detail) | **Corrigendum subtype**: date change / cancellation / retender | ❌ CAPTCHA + expiring token |
| GePNIC `eprocure/app` (Bid Awards, Cancelled/Retendered, Tenders by Classification, Tenders in Archive) | all of the above, by another route | ❌ CAPTCHA |

The evidence for each, so this is checkable rather than asserted:

- The Result-of-Tenders form carries real `captcha_sid`, `captcha_token` and
  `captcha_response` fields, and an `aoc_status` select whose only two values
  are `Published` and `CANCEL`.
- A tender detail token embeds a unix timestamp — the segment
  `MTc4OTAzMzk4OQ==` decodes to `1789033989`. Replayed later it returns
  `Invalid Url.Please Check`; fetched live inside the same session it returns
  the CAPTCHA form instead of the tender.
- The GePNIC pages were checked specifically as an alternative route. Their
  `list_table` elements do render rows — but the rows are the search form
  itself (`Tender ID`, `Keyword`, `Enter Captcha`, `Refresh`), not data. That
  near-miss is why it is recorded here: a row count alone would have looked
  like success.

Solving those CAPTCHAs was not attempted.

### What this does to the v1.0 taxonomy

Three of the six Status values and one of the eight Instrument Types describe
states that **no scrapable document can ever be in**:

| Tag | Facet | Status |
|---|---|---|
| `Award of Contract (AoC)` | Instrument Type | unreachable |
| `Cancelled` | Status | unreachable |
| `Retendered` | Status | unreachable |
| `Awarded / Closed` | Status | unreachable |

This is **not** a reason to delete them. They describe real things CPPP really
publishes, and a change to the portal — or an authenticated feed, or the
GeM API — would make them reachable overnight. But a workbook that lists them
beside `Live / Open` with no distinction tells a reader that the pipeline
covers a tender's whole life, and it does not: it covers the front half.

**Proposed:** keep all four, and mark them in the workbook as *Active
(unreachable from the public portal)*, with the reason stated in Notes. A
taxonomy that says what it cannot see is more useful than one that quietly
implies it can.

### And it undercuts the Subject facet's own foundation

The v1.0 Tagging Guide's second rule says a tender is tagged "by its real GFR
procurement category (Goods / Works / Consultancy Services / Non-Consultancy
Services) as its Subject, based on what is actually being procured". That is
the right rule. The problem is where that category lives: **on the tender
detail page, behind the CAPTCHA.** The public listing publishes six fields —
e-Published Date, Bid Submission Closing Date, Tender Opening Date,
Title/Ref.No./Tender Id, Organisation Name, and a Corrigendum marker — and
none of them is the procurement category.

So Subject has to be inferred from the tender's title and its issuing
organisation. That turns out to be more workable than expected — CPPP tender
titles are mostly descriptive ("Restoration and rejuvenation of Pond 1, 2 in
main plant", "LED Light Fitting for Passenger Alarm Chain Coach Indication
Light"), and only **1.8%** (43 of 2,447) are pure reference numbers with no
descriptive content at all, almost all of them CPWD works tenders published
with the NIT number as the title.

There is a second, sharper problem with that facet, visible without
classifying anything. CPPP's own search form offers a **Tender Category**
select with exactly three values: **Goods, Services, Works.** CPPP does not
distinguish consultancy from non-consultancy services anywhere in its own
public vocabulary. The taxonomy's four-way Subject split therefore asks the
classifier to make a distinction the source itself does not make, from title
text alone.

**That turned out better than expected — see Finding 2**, which is the one
place in this document where the v1.0 workbook is vindicated against a
prediction made before the run.

## What was built and run

| Step | Artefact | Result |
|---|---|---|
| Scrape | `scrapers/cppp_watcher.py` | **6,097 real rows** across all 17 feeds |
| Sample | `scrapers/build_cppp_sample.py` | population-weighted over an estimated **30,279** live documents, seed 20260910 |
| Normalize | `scrapers/cppp_adapter.py` | 100 documents |
| Seed | `prisma/seed-cppp.ts` | 7 Subjects, 8 Instrument Types, 6 Status values |
| Classify | `scripts/ingest-sample.ts CPPP … --all` | 100 documents, 0 errors, **4 flagged (4%)** |
| Supplementary | all 89 institutional documents | see Finding 4 |
| Analyse | `scripts/analyze-taxonomy-run.ts` | see below |

### The corpus CPPP actually publishes

| Live documents | Share | Feed |
|---:|---:|---|
| 26,360 | 87.1% | Latest Active Tenders |
| 2,590 | 8.6% | Active Corrigendums |
| 650 | 2.1% | Newsletters & statistics |
| 460 | 1.5% | High Value Tenders |
| 130 | 0.4% | Global Tenders |
| 89 | 0.3% | All institutional content (O.M.s, rules, manuals, bidding docs, help, FAQ) |

So the population-weighted 100 is **87 tender notices, 9 corrigenda, 2
newsletters, 2 high-value tenders** — and, correctly, **zero** Circulars,
Manuals or FAQs. That is the honest picture: CPPP's real corpus is
overwhelmingly one document type. A supplementary pass over all 89
institutional documents is reported separately below, because the main sample
by construction cannot test the half of the vocabulary they belong to.

Two further real corpus facts, both relevant to the workbook:

**Two organisations publish 71% of live central tenders.** Ministry of
Railways alone accounts for **55.4%** (1,355 of 2,447 sampled) and the
Military Engineer Services for **15.9%**. The taxonomy's Tagging Guide is
right to classify by what is procured rather than by issuing ministry — with
this distribution, an issuer-based Subject facet would be a two-value facet.

**The "one tender, many documents" question in the workbook's Schema Note has
a real answer.** It asks whether a tender should be tracked as one evolving
record or as separate linked documents, and notes the Status values were
written assuming the former is at least tracked conceptually. Measured: **450
tender IDs appear in both the tender feed and the corrigendum feed** in a
single snapshot — the same real tender, present twice, as two documents with
two different Statuses (`Live / Open` and `Corrigendum Issued`) at the same
instant. The current schema stores them as two unrelated `SourceDocument`
rows with no edge between them, so "show me this tender's history" is not
answerable today. `EntryRelationship` already exists for exactly this kind of
link (`AMENDS`, with a `targetHint`), and the corrigendum row carries the
parent tender's own ID — so this is buildable, not blocked. It is simply not
built.

### Why the sample is population-weighted rather than uniform

`cppp_watcher.py` samples **pages**, not documents, and takes the same number
of pages from each listing feed. That is the right way to scrape — it spreads
the crawl across the whole of each feed instead of front-loading it on the last
few hours' publications — but it makes the scraped file a distorted picture of
the portal:

| feed | live pages | pages fetched | share of that feed |
|---|---:|---:|---:|
| `active_tenders` | 2,636 | 250 | 9.5% |
| `active_corrigendums` | 259 | 249 | ~100% |
| `high_value_tenders` | 45 | 45 | 100% |
| `global_tenders` | 13 | 13 | 100% |

A uniform random draw over that file would return a "random sample of CPPP" in
which corrigenda are over-represented more than tenfold, and every share
quoted from it would be wrong — in the direction that flatters the taxonomy's
corrigendum handling. `scrapers/build_cppp_sample.py` therefore draws in
proportion to each feed's **real live population**, taken from the page counts
the scraper itself observed and wrote to a sidecar metadata file. The counts
are not hardcoded anywhere: they move under you (`active_corrigendums`
advertised 249 pages at the start of one run and 259 an hour later, mid-run).

## Scraper findings worth recording

**Pagination is not what it looks like.** CPPP paginates only through a
base64-wrapped `url=` parameter. A plain `?page=500` returns **HTTP 200 with
page 1's rows** — no error, no redirect. A scraper written the obvious way
would fetch 2,636 pages, report complete success, and produce a corpus of the
same ten tenders repeated. `scrape_listing()` asserts against exactly this by
comparing each page's row ids against page 1's and refusing to finish if they
match.

**A transient network fault silently produced a partial corpus.** The first
full run hit a local DNS outage ~130 pages in. Because each feed caught and
logged its own network errors, the run then failed every remaining page and
all 13 institutional feeds, wrote 1,415 rows instead of the expected ~4,600,
and **exited 0 reporting success**. A partial corpus that looks complete is
worse than a crash, because it silently becomes the denominator of a taxonomy
finding. Fixed twice over: transient network errors now retry with backoff,
and the run exits non-zero if any configured feed produced no rows at all.

---

## Coverage against the real sample

| Facet | Fired | Total | Never fired |
|---|---:|---:|---|
| Subject | 5 | 7 | Procurement Policy & Framework, Platform Administration & Onboarding |
| Instrument Type | 3 | 8 | Award of Contract (AoC), Circular / Office Memorandum, FAQ, Manual / Guidelines, RTI Response / Disclosure |
| Status | 3 | 6 | Awarded / Closed, Cancelled, Retendered |

**4 of 100 flagged for review (4%)**, against MERC's 40% on its own v1.0
taxonomy and a project-wide range of 3.2% (DOS-ISRO) to 45.8% (DST). On the
face of it the CPPP v1.0 taxonomy performs better than almost any other in the
project. The rest of this document is largely about why that number is not the
compliment it looks like.

## Finding 1 — Every flagged document is a corrigendum, and the reason is the CAPTCHA

The 4% flag rate is not evenly spread. It is entirely concentrated:

| | Documents | Flagged | Mean confidence |
|---|---:|---:|---:|
| `Tender Notice (NIT)` | 89 | **0** (0%) | **0.894** |
| `Corrigendum` | 9 | **4** (44%) | **0.788** |

Tender notices classify essentially perfectly. Corrigenda are flagged at 44%
and score a full 0.1 lower — and every one of the run's four review flags is a
corrigendum.

The cause is structural, not statistical. **A corrigendum row on CPPP's public
listing shows the underlying tender's title, not the corrigendum's own
content.** The classifier can tell that a corrigendum exists — the feed says
so — but has nothing at all to say about what it changed. Its own reasons make
this explicit:

> "The listing is filed under Active Corrigendums for a tactile works tender by
> RBI, indicating an amended tender…"
> "The document is a corrigendum listing for a construction works tender
> (shopping complex) filed under Active Corrigendums…"

Note the word *listing* in both: the model is classifying a table row, not a
document, and it says so.

This lands directly on the workbook's **first Tagging Guide rule**, which is
the one rule the whole Status facet depends on:

> "A Corrigendum's Status is set by its real, named subtype, not defaulted to a
> generic 'amended' state: a critical-date-change corrigendum sets Status:
> Corrigendum Issued, a cancellation-type corrigendum sets Status: Cancelled,
> and a retender-type corrigendum sets Status: Retendered."

That rule is correct and well-reasoned. It is also **inapplicable in
practice**: the subtype lives on `corrigfullview`, behind the CAPTCHA. Every
corrigendum the pipeline can see defaults to `Corrigendum Issued`, and the
other two branches of the rule can never fire.

**Proposed:** keep the rule, and add to it an explicit statement that the
subtype is not observable from the public listing, so `Corrigendum Issued` is
the correct default *and* a known floor rather than a confident finding.

## Finding 2 — The four-way Subject split works, against expectation

This is the one place the v1.0 workbook is vindicated against a prediction made
before the run, so it is worth stating plainly rather than burying.

CPPP's own vocabulary has three procurement categories (Goods / Services /
Works). The taxonomy has four, splitting Services into Consultancy and
Non-Consultancy per GFR. Before classifying anything, the reasonable
expectation was that asking a classifier to make a distinction the source
itself does not make, from a title alone, would produce noise.

It did not. All four fired, cleanly and at high confidence:

| Subject | Count | Mean confidence |
|---|---:|---:|
| Goods Procurement | 53 | 0.89 |
| Works Procurement | 32 | 0.89 |
| Non-Consultancy Services Procurement | 10 | 0.85 |
| Consultancy Services Procurement | 3 | 0.85 |
| Public Information & Transparency | 2 | 0.85 |

And the boundary is being drawn where GFR would draw it. Real examples:

- "REQUEST FOR PROPOSAL FOR PROJECT MANAGEMENT CONSULTANT - CUM - EXECUTION
  AGENCY" → **Consultancy**
- "Preparation of Detailed Feasibility Report (DFR) cum Detailed Project
  Report" → **Consultancy**
- "Annual Maintenance Work of STP of New Kenda Colliery" → **Non-Consultancy**
- "Plying of ferry service near to plant no.1 main gate" → **Non-Consultancy**
- "ESTABLISHMENT, OPERATION and MAINTENANCE OF CT SCAN AND MRI FACILITY" →
  **Non-Consultancy**

**One honest caveat, and it is not small.** None of this is verified against
ground truth, because CPPP's own Tender Category field is CAPTCHA-gated (see
the top of this document). What is demonstrated is that the four-way split is
applied *consistently and plausibly*; what is **not** demonstrated is that it
is applied *correctly*. Those are different claims and this document should
not be read as making the second. Verifying it would need either a CAPTCHA
route to the detail page or a hand-labelled sample, and neither exists yet.

## Finding 3 — 511 statistical reports and 14 annual reports are being filed as press releases

The `newsletterdisp` feed is not a newsletter feed. Its 650 real rows break
down as:

| Rows | Content |
|---:|---|
| 511 | **Monthly Tender Statistical Reports** |
| 121 | CPPP Newsletters |
| ~14 | **CPPP Annual Reports** (2016-17 through 2023-24) |

That is 2.1% of the live corpus, and 511 of those rows are periodic
statistical publications — real, structured, dated data releases about
procurement volumes. The taxonomy has no Instrument Type for a report of any
kind, so both sampled rows landed on `Press Release`, at 0.85:

> "This is a monthly statistical report on tender activity published as a press
> release/newsletter, providing transparency…"

The model reached the only tag available and said in its own reason that the
document is a statistical report. A CPPP Annual Report filed as a
`Press Release` is a plainer error still.

**Proposed:** add Instrument Type `Report / Statistics`, covering the monthly
tender statistical reports, the CPPP Annual Reports, and the newsletters'
statistical content. `Press Release` then keeps its real meaning — the award
and recognition announcements the v1.0 definition actually describes.

## Finding 4 — The institutional half of the taxonomy works, but the main sample cannot reach it

Two Subjects and five Instrument Types fired zero times in the 100-document
sample. That is **not** a defect: institutional content is 89 documents out of
an estimated 30,279 live — 0.3% — so a correct population-weighted sample of
100 should contain approximately zero of them, and did.

Because a sample that cannot reach half a vocabulary cannot test it, all 89
institutional documents were run as a separate supplementary pass. Results:

| Facet | Fired on the 89 | Total |
|---|---:|---:|
| Subject | 6 | 7 |
| Instrument Type | 3 (`Circular / Office Memorandum` 48, `Manual / Guidelines` 39, `FAQ` 2) | 8 |
| Status | 1 — `Not Applicable`, on **89 of 89** | 6 |

**The Status result is a clean validation of the workbook's third Tagging
Guide rule** ("Institutional content … always gets Status: Not Applicable,
never one of the tender-lifecycle Status values"). 89 of 89, no exceptions, no
drift. That rule works exactly as written.

Everything else on this pass went considerably worse than the tender sample:
**37 of 89 flagged (42%)**, against 4% on the tenders. Two distinct causes,
both real taxonomy problems rather than model noise.

### 4a — Documents *about* a procurement category are being tagged *as* that category

Seven of the 89 took a procurement-category Subject. Every one of them is a
framework document — the GFR manuals and the model tender documents:

| Document | Subject assigned | Confidence |
|---|---|---:|
| Manual for Procurement of Goods 2017 | Goods Procurement | **0.97** |
| Model Tender Document for Procurement of Goods (pdf) | Goods Procurement | 0.95 |
| Model Tender Document for Procurement of Goods (Word) | Goods Procurement | 0.90 |
| Model Tender Document for Procurement of Consultancy Services | Consultancy Services Procurement | 0.95 |
| Model Tender Document for Procurement of Non Consultancy Services (pdf) | Non-Consultancy Services Procurement | 0.95 |
| Model Tender Document for Procurement of Non Consultancy Services (Word) | Non-Consultancy Services Procurement | 0.90 |
| Manual for Procurement of Consultancy and Other Services 2017 | Consultancy Services Procurement | 0.90 |

The GFR *Manual for Procurement of Goods* is not procuring any goods. It is the
rulebook for how everyone else procures goods — the single clearest possible
instance of `Procurement Policy & Framework`, which the taxonomy defines as
"the rules governing procurement itself — GFR 2017, the Manual for Procurement
of Goods/Works/Services…" **naming this exact document.**

Note the confidences: 0.90 to 0.97. This is not uncertainty, it is confident
error, and five of the seven were auto-accepted with no review flag. The cause
is the second Tagging Guide rule, which says to tag "based on what is actually
being procured" — sound advice for a tender, and actively misleading for a
manual, where the procurement category in the title is the document's *topic*
rather than its transaction.

This is structurally the same failure as MERC's, where a Daily Order that
*recounted* litigation about another instrument was tagged as being under
litigation itself: **a document about X classified as an instance of X.**

**Proposed:** add a Tagging Guide rule stating that the procurement-category
Subjects apply only to an actual procurement transaction — a Tender Notice,
Corrigendum, or Award of Contract. Institutional content takes
`Procurement Policy & Framework` or `Platform Administration & Onboarding`
however prominently a category appears in its title. And, because Finding 10
of the MERC run showed Tagging Guide rules never reach the classifier, put the
same sentence in the four category Subjects' own definitions.

### 4b — `Circular / Office Memorandum` vs `Manual / Guidelines` is not a decidable boundary

The other 30 flags are spread almost evenly across the two institutional
Instrument Types — 18 `Circular / Office Memorandum`, 19 `Manual / Guidelines`
— which is what an undecidable boundary looks like rather than a problem with
one tag.

Real cases from the run: "Amendment in General Financial Rule 2017" was tagged
`Manual / Guidelines` at 0.60, and "Revised Application Format for Registration
of bidders under Rule 144(xi)" also `Manual / Guidelines` at 0.75, while
structurally identical Department of Expenditure issuances went to
`Circular / Office Memorandum`. An amendment to the GFR is *both*: it is issued
as an O.M. and it amends a manual.

Both tags are real and both should stay — CPPP's own site separates
"Procurement Policy O.M.s" from "Rules and Procedures", and that separation is
what the two tags encode. What is missing is a tie-break. **Proposed:** a
Tagging Guide rule deciding it by *form*, not topic — a numbered, dated
issuance addressed to ministries is a `Circular / Office Memorandum` even when
its subject is a manual; a standalone reference document intended to be
consulted rather than circulated is a `Manual / Guidelines`. And since the
scraper already knows which CPPP section each document came from, that section
is passed through as the `category_hint` the classifier now reads.

### 4c — `RTI Response / Disclosure` fired zero times across all 189 documents

CPPP publishes no RTI content through any scrapable feed. This is a genuine
structural absence, not a tagging failure. No change proposed; the tag costs
nothing and a future RTI section would need it.


## Finding 5 — The unreachable tags were NOT wrongly reached for, which matters

`Award of Contract (AoC)`, `Cancelled`, `Retendered` and `Awarded / Closed`
fired zero times across all 189 classified documents. Given the CAPTCHA gating
described at the top of this document, that is the *correct* result — but it
was not guaranteed.

The comparison is with MERC, where a structurally similar tag
(`Under Litigation / Stayed`) was reachable-but-inapplicable and the classifier
grabbed it wrongly at 0.85 confidence on a document that explicitly said no
stay had been granted. CPPP's four unreachable tags carry no such risk in
practice: the `status_hint` mechanism pins every tender-feed document to
`Live / Open` and every corrigendum-feed document to `Corrigendum Issued`
before the classifier's own answer is consulted, so there is no room to guess.

This is real evidence that the four tags are safe to keep as Active rather than
being deprecated to prevent false positives. They should be **labelled**
unreachable, not removed.

## Finding 6 — `status_hint` carried the entire Status facet, and that is worth recording

Every one of the 189 documents took its Status from the scraper's
`status_hint`, not from the classifier: `Live / Open` for tender-feed rows,
`Corrigendum Issued` for corrigendum-feed rows, and nothing (falling through to
the classifier, which correctly chose `Not Applicable`) for institutional
content.

That is by design and it is the right design — CPPP's feed structure *is* a
status assertion, in the same way MTCTE's Active/Expired column is — but it
means **the Status facet was not tested by this run**. It was asserted. A
future portal change that altered feed semantics would break Status silently,
with the classifier never consulted. Recorded so nobody reads "89 documents
correctly tagged Live / Open" as a validation of the Status vocabulary.


## Finding 7 — Subject and Instrument Type definitions were never sent to the classifier

This is the most consequential finding of the whole exercise, it applies to
every regulator in the project rather than to CPPP, and it was found by
measurement rather than by reading code.

Finding 4a's fix was to tighten four Subject definitions so that a document
merely *about* a procurement category stops being classified *as* one. The
change was made, the taxonomy re-seeded, and the same 89 documents re-run. The
result:

| Document | Before | After the definition change |
|---|---|---|
| Manual for Procurement of Goods 2017 | Goods Procurement, 0.97 | Goods Procurement, **0.97** |
| Model Tender Document for Procurement of Goods (pdf) | Goods Procurement, 0.95 | Goods Procurement, **0.95** |
| Model Tender Document for Procurement of Goods (Word) | Goods Procurement, 0.90 | Goods Procurement, **0.90** |
| Manual for Procurement of Consultancy and Other Services 2017 | Consultancy, 0.90 | Consultancy, **0.90** |
| …and the other three | | **all identical** |

**Byte-identical output on all seven, with identical confidences to two decimal
places.** A definition change that alters nothing at all is not a weak signal.
It is a signal that never arrived.

It hadn't. `lib/ingest.ts` built its prompt like this:

```ts
const subjectList = subjectTags.map((t) => t.name).sort();
const instrumentList = instrumentTags.map((t) => t.name).sort();
```

…and rendered `JSON.stringify(subjectList)` — a bare list of **names**. Only
Status sent definitions, via a `renderStatusSection()` helper written later for
DST's Subject-scoped vocabulary.

**Every regulator's Subject and Instrument Type definitions — the substance of
every taxonomy workbook in this project, and the thing a human spends their
time getting right — had never been seen by the classifier.** The model was
choosing from a list of bare labels and inferring their meaning from the words
in them.

It also explains, retrospectively, exactly which of this exercise's earlier
fixes worked and why:

| Fix | Worked? | Why |
|---|---|---|
| MERC: new `Hearing Notice` tag | ✅ | The tag **name** is self-describing |
| MERC: new `Daily Order` tag | ✅ | Same |
| MERC: `Not Applicable` definition names procedural documents | ✅ | It is a **Status** definition — already being sent |
| MERC: `In Force` definition names Daily Orders | ✅ | Same |
| CPPP: four Subject definitions exclude non-transactions | ❌ | A **Subject** definition — never sent |

Every fix that landed, landed for one of those two reasons. Not one of them
depended on a Subject or Instrument Type definition, because no such definition
had ever been read.

### The fix, and what it changed

`renderTagSection()` now renders Subject and Instrument Type as value + meaning
pairs, symmetrically with Status. Re-running the same 89 documents a third
time:

| | names only | with definitions | **re-measured 2026-09-14** |
|---|---:|---:|---:|
| Institutional documents given a procurement-category Subject | **7** | **0** | **0** |
| Subject distribution | 71 Policy / 10 Platform / 7 category / 1 Transparency | **77 Policy / 12 Platform** | **75 Policy / 12 Platform / 2 Transparency** |
| Documents whose Subject changed | — | 11 of 82 | — |
| Flagged for review | 37 | 43 | **35** |
| `text_extraction_failed` | 6 | 10 | **6** |

The Subject result is unambiguous: **all seven leaks closed, none reopened**,
and the institutional Subject distribution is now exactly what it should be —
policy and platform documents only.

**The flag count going up needs stating honestly, not spun.** Four of the six
extra flags are `text_extraction_failed`, which is network flakiness on
externally-hosted PDFs (cpwd.gov.in, cgda.nic.in) and has nothing to do with
the prompt. The remaining rise is `low_confidence`, and mean confidence fell
slightly on both institutional Instrument Types (Circular/O.M. 0.759 → 0.733,
Manual 0.776 → 0.756).

**Re-measured on 2026-09-14, that rise turns out to have been mostly the
network.** Running the same 89 documents against the final wording gives **35
flags, not 43**, with `text_extraction_failed` back down to 6 — the four
transient failures did not recur — and mean confidence recovering to 0.77 on
Circular/O.M. and 0.75 on Manual / Guidelines. So the durable cost of sending
definitions is roughly two flags, not six, and the calibration argument above
holds in a weaker and more honest form than the 43 suggested. This is exactly
why the number was worth re-deriving rather than quoting: a one-off network
fault had been absorbed into a finding about prompt design.

That is what should happen. Those two tags now carry the explicit
form-not-topic tie-break from Finding 4b, and the form of a document is often
genuinely undeterminable from a title and a possibly-failed extraction. The
model is now *appropriately* less certain about a boundary that is really
uncertain, instead of confidently guessing. A taxonomy test that only ever
drove the flag count down would be measuring the wrong thing: the goal is
calibration, not silence.

### What this implies beyond CPPP

Every regulator in this project has been classified against tag names alone.
Their Subject and Instrument Type definitions — some of them long, carefully
argued, and full of exactly the boundary rules that would have prevented
misclassifications — have never had any effect. Re-classifying an existing
regulator's corpus under the fixed prompt is out of scope here, but it is now a
known, testable question rather than an unknown one, and the two runs above
suggest the answer is not "no change".


## What changed after applying v1.1, measured on the same documents

Both document sets were re-classified from scratch against the revised
taxonomy and the fixed prompt — same seed, same sample files, CPPP's rows
deleted in between so nothing was skipped as a duplicate.

### The population-weighted 100

| | v1.0 | v1.1 (09-11) | **final v1.1, re-measured 2026-09-14** |
|---|---:|---:|---:|
| Flagged for review | 4 | 10 | **7** |
| `Report / Statistics` fired | — (tag did not exist) | 2 | **2** |
| Statistical reports filed as `Press Release` | 2 | **0** | **0** |
| `Tender Notice (NIT)` | 89 | 89 | **89** |
| `Corrigendum` | 9 | 9 | **9** |
| Subject: Goods / Works / Non-Consultancy / Consultancy | 53 / 32 / 10 / 3 | 53 / 29 / 13 / 3 | **53 / 27 / 15 / 3** |

The third column re-runs the same documents against the final wording seeded on
2026-09-11, for the reason given in the MERC findings' own results table: the
middle column was measured before that wording was in the database. The
Instrument Type distribution is identical across all three, which is the right
outcome — v1.0 was already correct about tenders and corrigenda. Two further
Works tenders moved to Non-Consultancy Services, the same Works/Non-Consultancy
boundary that was already moving in the middle column.

The tag added in Finding 3 works: both statistical reports moved off
`Press Release`. The Instrument Type distribution is otherwise unchanged, which
is the right outcome — v1.0 was already correct about tenders and corrigenda.

**The flag count went from 4 to 10 on 09-11, and settled at 7 when the same
documents were re-run against the final wording on 09-14. Both numbers need
breaking down rather than excusing.** By instrument:

| | v1.0 flags | v1.1 flags (09-11) | **final v1.1 (09-14)** |
|---|---:|---:|---:|
| Corrigendum (of 9) | 4 | 6 | **4** |
| Tender Notice (of 89) | 0 | 3 | **3** |
| Report / Statistics (of 2) | — | 1 | **0** |

Two things are happening, and only one of them is a taxonomy question.

The corrigendum and tender-notice flags are **calibration moving in the right
direction**. With definitions now reaching the classifier (Finding 7), the
`Corrigendum` definition explicitly tells the model that the public listing
does not show what the corrigendum changed — so it is now less confident about
corrigenda, which is exactly correct, because it genuinely does not know. Three
tender notices dropped below the 0.75 auto-accept threshold for the same
reason: they are genuinely ambiguous between Works and Non-Consultancy Services
(the Works count fell 32 → 29 → 27 and Non-Consultancy rose 10 → 13 → 15 across
the three passes, which is the same handful of documents moving back and forth
across one boundary), and the sharpened Subject definitions made that ambiguity
visible instead of papering over it. A run that only ever drove flags down would
be measuring confidence, not correctness.

On the 09-14 re-run the corrigendum flags fell back to 4 of 9 — the same count
v1.0 produced — while the three tender-notice flags persisted. That is the more
informative half of the result: the corrigendum uncertainty was partly a
wording artefact and partly real, whereas the Works/Non-Consultancy boundary
flags are stable across every pass and are the genuine ambiguity.

The third is a real, if minor, defect introduced by v1.1.

## Finding 8 — The new `Report / Statistics` tag was once returned as a *Subject*

One document in the v1.1 run flagged as `model_returned_invalid_subject_tag`:

> `Monthly Tender Statistics for Organisation Using own portal Non-NIC…`
> → subject=**Report / Statistics** | instrument=Report / Statistics | status=Not Applicable | confidence=0.95

`Report / Statistics` is an Instrument Type. The model put it in the Subject
slot as well, at 0.95 confidence. The correct Subject was already available and
correct in the v1.0 run: `Public Information & Transparency`.

The likely cause is the new tag's own definition — "a periodic or annual data
publication **about procurement activity**" — which reads like a topic, and so
competes for the Subject slot now that definitions actually reach the prompt.
This is a small, specific cost of Finding 7's fix, and worth recording as one.

**The pipeline caught it.** `ingestDocument()` validates the model's Subject
against the regulator's real SUBJECT tags and refuses a value that is not one,
writing `subjectId: null` with a `model_returned_invalid_subject_tag` flag
rather than a wrong tag. That safeguard has existed since the ingestion service
was written and this is the first time in this exercise it has fired — the one
instance where the system's own defences, not a human reading output, caught
the error.

**Fixed before release, in v1.1 itself, and measured.** Two definitions were
rewritten, not a Tagging Guide line added, since Tagging Guide rules never
reach the classifier (MERC Finding 10):

- `Report / Statistics` now opens *"A document FORM, not a topic"* and states
  that it is an Instrument Type value only, never a Subject, whose Subject is
  `Public Information & Transparency`.
- `Public Information & Transparency` was defined as RTI content only, so a
  statistics report had no Subject that described it. It now names the monthly
  Tender Statistical Reports, the Annual Reports and the newsletters.

Measured on **30 real newsletter-feed documents** (the 2 from the weighted
sample, 14 statistical reports, 8 Annual Reports, 6 newsletters), each
classified twice: **28 of 60 classifications flagged before, 10 after**, and
every one of the remaining 10 is `text_extraction_failed` — a PDF problem, not
a vocabulary one. Re-validated on 14 further documents that were not in that
set; see "Re-validation on fresh documents" below. The tag was not renamed.

### The 89 institutional documents

Reported in full under Finding 7. Headline: seven confidently-wrong Subject
assignments went to zero, and the institutional Subject distribution became a
clean 77 `Procurement Policy & Framework` / 12 `Platform Administration &
Onboarding`.

## What was NOT changed, and why

Unlike MERC, whose v1.0 needed eight new Instrument Types, **CPPP's v1.0
vocabulary is close to right.** Its Subject facet works, its Instrument Types
match what the portal publishes, and its deliberate departure from the standard
Status vocabulary — flagged in its own Schema Note as a design choice rather
than an oversight — is vindicated: a tender lifecycle really is the right model
for this source.

The changes proposed here are one added Instrument Type (`Report /
Statistics`), six definitions tightened, four tags labelled as unreachable, and
three Tagging Guide rules that record what the portal will and will not give
you. Nothing is deprecated and nothing is renamed.

The largest thing this run produced is not a CPPP change at all — it is
Finding 7.

## How to reproduce this

Two document sets were classified, and both passes are reproduced here: the
population-weighted 100, and the 89 institutional documents that the weighted
sample cannot reach by construction (Finding 4).

```bash
# the listing scrape, and the population-weighted draw from it
python scrapers/cppp_watcher.py --tender-pages 250 --seed 20260910
python scrapers/build_cppp_sample.py --size 100 --seed 20260910

# the institutional scrape -- a separate run, and the input behind Finding 7
python scrapers/cppp_watcher.py --skip-listings \
    --out scrapers/data/cppp_institutional_raw.json
python scrapers/run_cppp_adapter.py \
    --raw scrapers/data/cppp_institutional_raw.json \
    --out scrapers/data/cppp_institutional_normalized.json

npx tsx prisma/seed-cppp.ts
npx tsx scripts/reset-regulator-documents.ts CPPP

# pass 1: the weighted 100. Analyse BEFORE running pass 2 -- see the note below.
npx tsx scripts/ingest-sample.ts CPPP scrapers/data/cppp_sample_normalized.json --all
npx tsx scripts/analyze-taxonomy-run.ts CPPP scripts/.audit/cppp-sample-all.json

# pass 2: all 89 institutional documents
npx tsx scripts/ingest-sample.ts CPPP scrapers/data/cppp_institutional_normalized.json --all
npx tsx scripts/analyze-taxonomy-run.ts CPPP scripts/.audit/cppp-sample-all.json
```

**Run order matters, and it is a sharp edge rather than a preference.**
`ingest-sample.ts` names its audit copy `<code>-sample-<all|seed>.json` from the
*flags*, not from the input file, so both `--all` passes above write
`scripts/.audit/cppp-sample-all.json` and the second silently overwrites the
first. Analyse each pass before starting the next, or the analysis will be read
against the wrong document set. (`reset-regulator-documents.ts` is deliberately
run only once, before pass 1: the two passes are disjoint document sets, so
pass 2 adds to pass 1 rather than colliding with it in Postgres.)

To regenerate the workbook from its revision spec:

```bash
python scripts/.audit/build_cppp_dataset.py
python scripts/revise_taxonomy_workbook.py \
    --source "CPPP_Tenders_Taxonomy_v1_0.xlsx" \
    --spec   scripts/.audit/cppp-revision.json \
    --out    CPPP_Tenders_Taxonomy_v1_1.xlsx
```
