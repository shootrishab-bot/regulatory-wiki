# CCI Taxonomy Findings — v1.1, real 350-document sample run 2026-08-18

Full real pipeline (scrape → download → extract → classify) run against a
random 350-document sample drawn from all 5 real, live-confirmed CCI sources
(pool: **1,321 real deduplicated documents** — antitrust_orders 1,218,
combination_notifications 23, homepage 36, market_studies 28, tenders 16).
345 kept, 5 dropped, 27 flagged `needs_review` (7.7%). `by_classification_method`:
348 `ai`, 2 `dropped_by_prefilter`, **0 `error_fallback`** — the DeepSeek
connection was healthy throughout, so every finding below is real taxonomy/
extraction signal, not a masked API problem. Nothing in
`CCI_Regulatory_Taxonomy_v1_1.xlsx` was edited — these are proposals for you
to apply.

## Read this first — the 7.7% `needs_review` rate is an extraction artifact, not taxonomy noise

All **27/27** `needs_review` records share the exact same root cause:
`extraction_method: "failed"`. Checked, not assumed — confirmed with `pypdf`
directly against the actual downloaded files (e.g. a 344KB, 4-page real order
PDF returning 0 extractable characters on every page). These are real,
non-empty, non-dead files — genuinely **scanned image PDFs**, not link rot.
29 of the 33 total extraction failures in the sample are Antitrust Orders
dated 2005–2014 (pre-digital-native CCI filing); the other 4 are one each
from homepage, combination_notifications, and two from tenders. The model
still classified all 27 from title alone (that's the intended prefilter/AI
design — a missing PDF text never blocks classification) but correctly
flagged low confidence on ambiguous case-citation-only titles like *"12/2009:
O.M. Debara vs Society of Indian Automobiles Manufacturers & Ors."*, where
the Subject (Anti-competitive Agreements vs. Abuse of Dominance) genuinely
can't be told apart from the title alone.

This is the environment's missing `tesseract`/`poppler` binaries (flagged in
the Step 1 report) surfacing as data, not a taxonomy defect — **don't read
Subject/Instrument Type/Status distributions among the `needs_review` set as
taxonomy signal.** Every real taxonomy finding below comes from the 323
cleanly-classified, non-`needs_review` records instead.

## Coverage check

| Facet | Fired | Total | Never fired |
|---|---:|---:|---|
| Subject | 9 | 13 | Combination Compliance & Enforcement, International Cooperation, Institutional Governance & Administration, Public Information & Transparency |
| Instrument Type | 8 | 12 | Act, Regulation, Annual Report, FAQ |
| Status | 4 | 6 | Superseded, Repealed |

Most of the Subject/Instrument Type gaps are **structural, not sample-size
luck** — see Finding 3. `Superseded`/`Repealed` never firing in a 350-sample
skewed 88% toward individual case Orders is plausible sampling noise (a
document being superseded/repealed is inherently a minority event even in
the full pool) — not flagging this as a new finding without more evidence.

## Finding 1 — Rules-shaped documents are consistently tagged `Notification`, not `Regulation`, because CCI publishes them exclusively via Gazette Notification

**CONFIRMED**, real example at 90% confidence (not a `needs_review` case):

> "Notification regarding The Competition (Criteria for Exemption of
> Combinations) Rules, 2024, G.S.R. 549(E)"
> → Instrument Type: `Notification`
> Rationale: *"This is a gazette notification introducing the Competition
> (Criteria for Exemption of Combinations) Rules, 2024, which sets out
> criteria for exempting certain combinations from filing requirements."*

The model's reasoning is defensible, not a bug: the document's *legal form*
is a Gazette Notification (it has a G.S.R. number, the standard citation for
a government notification), even though its *substance* is a set of Rules.
Checked across all 7 `combination_notifications` records in the sample: 6/7
are titled "Notification regarding [Rules/exemption]..." and all 6 landed on
`Notification`. This is very likely why `Regulation` never fires anywhere in
the sample — CCI may not publish anything through these 5 sources that is
formatted any other way.

**Proposed fix (Tagging Guide clarification, your call on direction):**
decide explicitly whether Instrument Type should track legal *form*
(publishing mechanism) or legal *substance* (what the document does), and
say so for this specific real pattern:

> A document published as a Gazette Notification that itself promulgates
> Rules or Regulations (identifiable by a title following the pattern
> "Notification regarding The Competition (...) Rules/Regulations, YYYY")
> is `Regulation`, not `Notification` — the G.S.R./gazette mechanism is
> just how CCI's subordinate legislation gets published, not evidence the
> document is a simple administrative notice. Reserve `Notification` for
> notifications that don't themselves promulgate a Rule/Regulation (e.g.
> individual bank/entity exemption notifications, corrigenda).

If you'd rather keep the current form-based reading, that's also a
legitimate call — just worth confirming deliberately, since `Regulation`
being permanently empty is otherwise indistinguishable from a dead tag.

## Finding 2 — "Call for Papers" outreach content gets forced into `Draft / Under Consultation`, a Status value that doesn't really describe it

**CONFIRMED**, real example, kept and auto-accepted at 85% confidence:

> "Call for Papers: 12th National Conference on Economics of Competition Law
> 2027"
> → Subject: `Competition Advocacy & Outreach`, Instrument Type: `Public
> Notice / Consultation Notice`, Status: `Draft / Under Consultation`
> Rationale: *"This is a call for papers for an academic conference, which
> is an outreach activity with a submission deadline, not a regulatory
> action."*

The model's own rationale contradicts the tags it assigned: it explicitly
says this is *not a regulatory action*, yet had to pick a real Instrument
Type and Status from the controlled vocabulary anyway, landing on the two
closest-sounding values. `Draft / Under Consultation` normally means *this
instrument itself is unfinalized and pending*, but a Call for Papers isn't a
draft of anything — it's a time-bound open invitation with its own
submission deadline, structurally closer to the `Tender / RFP` treatment
already in the vocabulary than to a draft regulatory instrument.

**Proposed fix:** either (a) add a Tagging Guide rule + example carving out
outreach/conference calls as not requiring a formal Status tag at all (mirrors
how DST scoped Status applicability by Subject for its own hybrid vocabulary
— `Competition Advocacy & Outreach` may be a natural candidate for a
"Status doesn't meaningfully apply" carve-out), or (b) if Status should stay
mandatory across all Subjects, clarify explicitly that `Draft / Under
Consultation` is reserved for instruments (Regulations, Rules, Regulations-
in-progress) and that outreach/conference/event content should default to
`In Force` (i.e. "the announcement is live") instead. Only one real example
surfaced this run — worth confirming against a couple more real Advocacy &
Outreach documents before locking in either fix.

## Finding 3 — 4 Subjects and 4 Instrument Types are structurally absent from these 5 sources, not evidence they're unnecessary

**Not proposing a taxonomy change** — flagging so it isn't misread as a
pruning candidate. `Act`, `Annual Report`, and `FAQ` describe content types
that live on separate CCI pages this scraper doesn't cover (primary
legislation text, the Annual Report archive, and static FAQ pages
respectively) — none of the 5 scraped sources (homepage, tenders, market
studies, antitrust orders, combination notifications) would ever naturally
produce one. Same logic likely applies to the Subjects
`Institutional Governance & Administration` and `Public Information &
Transparency`. `International Cooperation` is a partial exception: one real
near-miss existed in this sample —

> "Competition Commission of India hosted the meeting of the BRICS Heads of
> Competition Authorities 2026" → **dropped** (`keep: false`), rationale:
> *"...an event attendance mention with no operative consequence."*

— correctly dropped per the classifier's own PR-content rule, not a
misclassification. Its absence from `by_subject` this run reflects one
correctly-filtered PR mention, not proof the tag is dead; a real cooperation
MOU or joint statement would still need it. Recommend leaving all of these
tags as-is; they're outside this scraper's current source coverage, not
outside the taxonomy's real scope.

## Volume observation (not proposing a change)

| Subject | Count | Share |
|---|---:|---:|
| Anti-competitive Agreements & Cartel Enforcement | 171 | 49% |
| Abuse of Dominant Position | 139 | 40% |
| Market Studies & Economic Research | 14 | 4% |
| Recruitment, Procurement & Institutional Opportunities | 8 | 2% |
| Combination Filing & Procedure | 5 | 1% |
| Combination Review & Approval | 4 | 1% |
| Competition Law Framework | 2 | <1% |
| Rulemaking & Public Consultation | 1 | <1% |
| Competition Advocacy & Outreach | 1 | <1% |

Antitrust Orders alone are 88% of this sample (308/350), closely tracking
its 92.2% share of the real underlying pool (1,218/1,321) — the sample is
proportionate, not skewed by a bug. The two antitrust Subjects combined are
89% of the sample. This is a genuine characteristic of cci.gov.in's content
mix (over a thousand individual case orders vs. a few dozen notifications/
studies/tenders combined), same shape as DST's Funding-Calls dominance —
flagging only in case the wiki's UI assumes a more even Subject spread.

## Data-quality note (not a taxonomy issue) — pre-2015 Antitrust Orders are scanned images, real OCR still needed

29 of 1,218 real Antitrust Orders sampled (and likely a similar share across
the full pool, concentrated in 2005–2014 filings) are scanned-image PDFs
with zero embedded text — confirmed directly against the real downloaded
files, not assumed from a log message. `extractor.py`'s OCR fallback
(`pytesseract` + `pdf2image`) is correctly wired but the underlying
`tesseract`/`poppler` binaries aren't installed in this Windows environment,
so OCR degrades gracefully (`(None, "failed")`) rather than actually running
— all 29 were still ingested and correctly flagged rather than silently
dropped. Recommend installing both binaries before a production ingestion
run; happy to do it once you confirm, per the earlier check-in on this.

## What I did NOT change

`CCI_Regulatory_Taxonomy_v1_1.xlsx` itself — all fixes above are Tagging
Guide clarifications for you to apply. Also did not touch `classifier.py`'s
`_system_prompt()`/`_validate_and_build()`, and did not change
`CLASSIFICATION_MAX_TOKENS`/`CLASSIFICATION_TEMPERATURE` in `config.py`.
