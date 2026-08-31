# CCI Taxonomy Findings v2 — stratified second-pass, real run 2026-08-19

## Methodology actually achieved

Full census of the 4 small sources (not sampled — every real item classified)
plus a stratified sample of Antitrust Orders, split evenly between pre-2015
and 2015-onward rather than one flat uniform draw:

| Source | Achieved | First-run reference | Match? |
|---|---:|---:|---|
| Combination Notifications | 23 | 23 | full census, exact |
| Tenders | 16 | 16 | full census, exact |
| Market Studies (current + archive) | 28 | 28 | full census, exact |
| Homepage | 36 | 36 | full census, exact |
| Antitrust Orders, pre-2015 | 100 | (pool: 408) | stratified sample |
| Antitrust Orders, 2015-onward | 100 | (pool: 810) | stratified sample |
| **Total** | **303** | | |

No source came back short — all four full-census counts matched the first
run exactly, so nothing below rests on a partial census. `by_classification_method`:
300 `ai`, 3 `dropped_by_prefilter`, **0 `error_fallback`** — DeepSeek was
healthy throughout, so the findings below are real signal.

**Before this run**, the two taxonomy fixes proposed in `taxonomy-findings.md`
(Regulation vs. Notification, and a `Not Applicable` Status value) did not
actually exist anywhere in the running system — not in the workbook, not in
`classifier.py`'s prompt, not in `cci_scraper/__init__.py`'s `STATUSES` list.
I flagged this before proceeding and, per your direction, implemented both:
added `"Not Applicable"` to `STATUSES`, added both rules to `classifier.py`'s
system prompt, and bumped `TAXONOMY_VERSION` to `v1_3` (the physical
`CCI_Regulatory_Taxonomy_v1_1.xlsx` workbook itself was **not** regenerated —
see `cci_scraper/__init__.py`'s note). This run is the first real test of
either fix.

**Also before this run**, a real deadlock bug was found and fixed in
`extractor.py`'s OCR fallback: `convert_from_path()` had no DPI cap or page
limit, and a real 87-page pre-2015 scanned order overflowed a subprocess
pipe-reader thread with a `MemoryError`, permanently hanging the batch (not
just that one document — `extract_pdf_text` runs synchronously, un-executor-
wrapped, directly on the pipeline's event loop). Fixed with a DPI cap (150),
a page cap (15 — plenty for the 8000-char classification budget), and a 90s
timeout. Verified against the exact file that triggered it before rerunning
at scale. `tesseract` and `poppler` were also installed (previously absent,
per the first run's flagged environment limitation).

Getting this run to actually complete took 5 attempts — 2 were killed with
no error partway through and no matching event in Windows' System/Application
logs (still not fully explained; possibly an idle-output timeout on this
session's background-task supervision reacting to a long silent OCR call, or
the same root cause as attempt 4 below), and one (attempt 4) hit a genuine
~16-hour overnight machine sleep that queued a kill signal the process only
received on wake. The successful run (attempt 5) completed in one shot once
the machine was confirmed to stay awake. Noting this since it may matter for
any future long-running batch in this environment — chunking into shorter
runs would be the resilient fix if it recurs.

## Question 1 — Regulation vs. Notification: does the rule hold across all 23 real Combination Notifications?

**CONFIRMED, rule is working correctly, no breaking pattern found.**

| Instrument Type | Count | Pattern |
|---|---:|---|
| Regulation | 3 | "Notification regarding The Competition (...) Rules, 2024, G.S.R. 54X(E)" |
| Notification | 20 | exemptions, threshold changes, corrigenda, commencement notices |

All 3 `Regulation` hits are the exact Rules-shaped pattern the fix targeted
(the 2024 Criteria-for-Exemption, Criteria-of-Combination, and Minimum-Value
Rules), each at 95% confidence with rationale directly citing "promulgating
... Rules ... which is a regulation in force." The other 20 are genuinely
different in kind — Central Government notifications exempting specific
entities (Regional Rural Banks, nationalized banks), extending or enhancing
asset/turnover thresholds, corrigenda amending earlier notifications, and
notifications appointing commencement dates for Act provisions. None of
these promulgate a new Rule or Regulation themselves; the model correctly
kept them as `Notification`. Across all 23 real records, not one looks
misclassified by the new rule — no document that should obviously be one
type landed on the other.

## Question 2 — `Not Applicable` status: real finding, and it's the opposite of what the question expected

**CONFIRMED, but the rule as written is significantly OVER-applied, not
under-applied.** 52/303 records (17%) got `Not Applicable` — far more than
the single `Call for Papers` case the rule was built for, and closer
inspection shows only 1 of those 52 is actually correct:

| Group | Count | Correct? |
|---|---:|---|
| Market Studies (research reports, all of `market_studies` feed) | 28 | **Debatable, unintended** |
| Tenders / procurement / contract awards (`tenders` + homepage procurement) | 23 | **Wrong** |
| Call for Papers (the original finding) | 1 | **Correct** |

**The procurement group is a clear, confirmed bug.** The model's own
rationale for these repeatedly says the document has "an operative
consequence" — e.g. *"This is a notice inviting tenders... a procurement
opportunity with an operative consequence"* — and then tags Status as `Not
Applicable` anyway, which the prompt defines as content with "no legal/
operative standing." That's a direct contradiction between the stated
reasoning and the chosen tag. Real examples: "Notice inviting Tender for
empanelment of Digital Forensic Services CCI - Last Date: 12.02.2025" (a live
tender with a real deadline), "Notice of award of contract to M/s Super-Ads
Creative Media..." (a completed, operative award), "Cancellation of Tender
for Providing House Keeping Services" (an operative cancellation). All of
these should almost certainly be `In Force` — the first run tagged
comparable content that way, and nothing about the new rule was meant to
change tender/procurement handling.

**The Market Studies group is a real behavior change, not obviously wrong,
but unevidenced.** In the first run, all 14 sampled Market Studies documents
landed on `In Force` (the only status In Force use for a research report:
"this published document is the current, standing version"). In this run,
27 of 28 real Market Studies documents got `Not Applicable` instead, with
rationale like *"a research document with no legal/regulatory standing."*
That's a defensible reading — a study genuinely isn't a legal instrument —
but it's a full reclassification of an entire Subject's Status behavior that
Finding 2 never asked for or evidenced; the original finding was specifically
about outreach/conference content, not the Market Studies corpus.

**Root cause:** the rule I wrote — *"content that is not itself a legal/
regulatory instrument and has no legal/operative standing"* — is worded too
broadly. It correctly excludes the Call for Papers case but also matches any
non-instrument Instrument Type (`Tender / RFP`, `Award of Work / Institutional
Notice`, `Market Study / Research Report`) almost by definition, since none
of those are "legal instruments" in the way a Regulation or CCI Order is.

**Proposed fix (not yet applied):** narrow the rule to explicitly exclude
procurement/tender content (which has a real deadline/award/cancellation and
should stay `In Force` regardless of not being a "legal instrument" in the
Regulation/Order sense) and to make an explicit, separate call on Market
Studies rather than let it fall out of the same broad wording:

> Use "Not Applicable" only for outreach, advocacy, or event-driven content
> with no operative deadline, award, or administrative consequence of its
> own — a Call for Papers, a conference announcement, a training/workshop
> notice. Do NOT use it for tenders, RFPs, contract awards, or tender
> cancellations, even though these are not "legal instruments" in the
> Regulation/Order sense — these have a real operative deadline or
> consequence and should be "In Force" (or, for a cancellation, judge
> whether the cancellation itself is the operative event). For Market Study
> / Research Report content specifically: [needs an explicit decision —
> either keep the first run's "In Force" treatment (a published study is the
> current standing version) or deliberately adopt "Not Applicable" for the
> whole Subject — but decide this on purpose, not as a side effect of the
> outreach-content wording.]

I did not re-edit the prompt a third time mid-analysis — this fix needs your
call on the Market Studies question specifically before I touch it again.

## Question 3 — OCR failure rate at scale, with tesseract/poppler actually installed

**0/100 (0%) pre-2015 Antitrust Orders failed extraction.** 72/100 extracted
directly; the other 28/100 needed OCR, and **all 28 OCR attempts succeeded**
(0 timeouts, 0 failures). This is a real, comparable improvement over the
first run's antitrust-orders extraction-failure rate (29 of 350 sampled
records failed, concentrated in pre-2015 orders, entirely attributable to
`tesseract`/`poppler` not being installed at all). With the binaries
installed and the deadlock fixed, OCR isn't just theoretically wired up
correctly — it works at real scale against the actual population it was
built for. 0/303 records in this run were flagged `needs_review` (vs. 7.7%
in the first run), and that drop traces directly to this: the first run's
`needs_review` rate was, per that report's own finding, entirely an
extraction artifact — fixing extraction removed essentially all of it.

## Anything new outside the three questions

**Coverage improved with the larger, stratified sample**: 11/13 Subjects
fired (up from 9/13), 9/12 Instrument Types (up from 8/12), 5/7 Statuses
(counting `Not Applicable`, up from 4/6). Two Subjects fired for the first
time, each once, both plausible: `Combination Compliance & Enforcement`
("Notice for extended time for inviting public comments in case No.
42-2022") and `Institutional Governance & Administration` ("Public Interest
Disclosure and Protection of Informers (PIDPI) Resolution"). Neither is a
volume finding — one real document each — just confirmation these tags are
reachable, not dead.

Still never fired: Subjects `International Cooperation` and `Public
Information & Transparency`; Instrument Types `Act`, `Annual Report`, `FAQ`.
Consistent with the first report's Finding 3 — these are outside the 5
scraped sources' natural content, not evidence they're unnecessary.

`Amended` fired 4 times (up from 1), all real extension/corrigendum
notifications with clear self-referential-revision rationale — no new
concern there.

## What I did NOT change

`CCI_Regulatory_Taxonomy_v1_1.xlsx` itself. Did not touch `classifier.py`'s
`_validate_and_build()`, and did not change `CLASSIFICATION_MAX_TOKENS` or
`CLASSIFICATION_TEMPERATURE` in `config.py`. Did not re-edit the `Not
Applicable` prompt rule a third time — Question 2's proposed fix is written
up above for you to decide on (specifically the Market Studies question)
before I apply it.
