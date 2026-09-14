"""Fills the MERC revision spec's Dataset and Change Log from the REAL runs.

The Dataset sheet shows, for each of a set of real merc.gov.in documents, what
v1.0 assigned it and what v1.1 assigns the SAME document. Showing only the
v1.1 answer would hide the evidence; showing only v1.0 would hide the fix.

Inputs are the classification logs, kept alongside this script:
    scripts/.audit/merc-run-v1_0.log        -- the v1.0 pass over the 100-doc sample
    scripts/.audit/merc-run-v1_1-final.log  -- the FINAL v1.1 pass over the SAME 100
    scripts/.audit/merc-run-v1_1.log        -- the earlier 09-11 v1.1 pass, kept for history
plus scripts/.audit/merc-run-analysis.json for each document's source-side
category hint and published date.

WHICH v1.1 LOG THIS READS, AND WHY IT MATTERS. The 09-11 log is the REGRESSED
pass Finding 11 diagnoses: hearing rows titled with the petition had drifted to
Order, and the Hearing Notice / Daily Order definitions had not yet been given
their section-naming sentences. Building the Dataset from it produced a sheet
that documented a taxonomy this repository does not ship -- and, because the
Licence pick found nothing in it, a sheet two rows shorter than the spec
claimed. This now reads merc-run-v1_1-final.log (2026-09-14), which is the same
100 documents against the wording actually seeded.

Nothing here is written from memory: every tag, confidence and date is parsed
back out of a real run.

Run:
    python scripts/.audit/build_merc_dataset.py
"""

from __future__ import annotations

import json
import re

AUDIT = "scripts/.audit"
V1_0_LOG = f"{AUDIT}/merc-run-v1_0.log"
# The final pass, not the 09-11 one -- see the module docstring.
V1_1_LOG = f"{AUDIT}/merc-run-v1_1-final.log"
ANALYSIS = f"{AUDIT}/merc-run-analysis.json"
SPEC = f"{AUDIT}/merc-revision.json"

# [auto-accepted] <title, truncated to 70> -> subject=X | instrument=Y | status=Z | confidence=0.85
LINE_RE = re.compile(
    r"^\[(?P<flag>[^\]]+)\]\s+(?P<title>.*?)\s+->\s+"
    r"subject=(?P<subject>[^|]+?)\s*\|\s*"
    r"instrument=(?P<instrument>[^|]+?)\s*\|\s*"
    r"status=(?P<status>[^|]+?)\s*\|\s*"
    r"confidence=(?P<confidence>[0-9.]+)\s*$"
)


def parse_log(path: str) -> dict[str, dict]:
    """Keyed by the log's own 70-character title prefix, which is what both
    logs share -- the sourceId is not printed, and joining on the prefix is
    exact because both runs processed the identical sample in the same order."""
    out: dict[str, dict] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            match = LINE_RE.match(line.strip())
            if not match:
                continue
            row = match.groupdict()
            row["confidence"] = float(row["confidence"])
            row["flagged"] = row["flag"] == "FLAGGED"
            out[row["title"]] = row
    return out


def main() -> int:
    v1_0 = parse_log(V1_0_LOG)
    v1_1 = parse_log(V1_1_LOG)
    analysis = json.load(open(ANALYSIS, encoding="utf-8"))
    spec = json.load(open(SPEC, encoding="utf-8"))

    # The analysis JSON holds the full title; the logs hold a truncated prefix
    # that .strip() can shorten further. Keying on an exact title[:70] therefore
    # misses rows -- measured, it joined only 84 of 100 -- and every miss
    # yielded hint="" rather than an error, which silently disables all the
    # hint-dependent picks below and shrinks the Dataset sheet without saying
    # so. Normalising both sides to the same short, whitespace-collapsed,
    # case-folded key removes the whole class of near-miss.
    def key(title: str) -> str:
        return re.sub(r"\s+", " ", title).strip()[:55].casefold()

    meta_by_key = {key(a["title"]): a for a in analysis}

    def joined(prefix: str) -> dict | None:
        if prefix not in v1_0 or prefix not in v1_1:
            return None
        meta = meta_by_key.get(key(prefix), {})
        return {
            "prefix": prefix,
            "old": v1_0[prefix],
            "new": v1_1[prefix],
            "hint": meta.get("categoryHint") or "",
            "date": (meta.get("publishedDate") or "")[:10],
            "joined_meta": bool(meta),
        }

    rows = [r for r in (joined(p) for p in v1_0) if r]

    # Fail loudly rather than emitting a quietly-degraded Dataset sheet.
    unjoined = [r for r in rows if not r["joined_meta"]]
    if len(unjoined) > max(2, len(rows) // 10):
        raise SystemExit(
            f"{len(unjoined)} of {len(rows)} rows did not join to {ANALYSIS}.\n"
            "Each unjoined row loses its category hint silently, which disables the\n"
            "hint-dependent picks and produces a shorter Dataset sheet with no error.\n"
            "Regenerate the analysis for THIS run first:\n"
            "  npx tsx scripts/analyze-taxonomy-run.ts MERC scripts/.audit/merc-sample-20260910.json"
        )

    def pick(predicate):
        for row in rows:
            if predicate(row):
                return row
        return None

    def emit(row: dict, note: str) -> dict:
        old, new = row["old"], row["new"]
        changed = (old["instrument"], old["status"]) != (new["instrument"], new["status"])
        verdict = "CHANGED by v1.1" if changed else "unchanged in v1.1"
        return {
            "date": row["date"] or "(no date on source)",
            "title": row["prefix"],
            "instrument": new["instrument"],
            "subject": new["subject"],
            "status": new["status"],
            "notes": (
                f"{note} v1.0 assigned: {old['instrument']} / {old['subject']} / {old['status']} "
                f"(confidence {old['confidence']:.2f}{', FLAGGED' if old['flagged'] else ''}). "
                f"v1.1 assigns: {new['instrument']} / {new['subject']} / {new['status']} "
                f"(confidence {new['confidence']:.2f}{', FLAGGED' if new['flagged'] else ''}). "
                f"[{verdict}]"
            ),
        }

    picks = [
        (
            lambda r: "Hearings" in r["hint"] and r["new"]["instrument"] == "Hearing Notice"
            and r["old"]["instrument"] == "Public Notice / Consultation Notice",
            "REAL hearing notice, the largest document class MERC publishes (48.2% of the corpus). "
            "v1.0 had no tag for it.",
        ),
        (
            lambda r: "Hearings" in r["hint"] and r["new"]["instrument"] == "Hearing Notice"
            and r["old"]["instrument"] == "Order",
            "REAL hearing notice of the SAME class as the row above -- but v1.0 sent this one to "
            "Order instead. The two rows together are the evidence that v1.0 split one document "
            "class across two Instrument Types and two Statuses.",
        ),
        (
            lambda r: r["hint"] == "Daily Orders" and r["old"]["status"] == "Under Litigation / Stayed",
            "REAL FAILURE, and the sharpest one in the run. The PDF states 'no stay has been granted "
            "by the Supreme Court', and the appeal it recounts concerns the ATE's judgment, not this "
            "document -- yet v1.0 auto-accepted Under Litigation / Stayed with no review flag. Drove "
            "the new self-referential litigation rule.",
        ),
        (
            lambda r: r["hint"] == "Daily Orders" and r["new"]["instrument"] == "Daily Order"
            and r["old"]["status"] != "Under Litigation / Stayed",
            "REAL Daily Order (11.8% of the corpus). v1.0 tagged it Order, unflagged -- a SILENT "
            "misfit, since Order is defined as disposing of a petition and a Daily Order does not.",
        ),
        (
            lambda r: "Standards of Performance Data" in r["hint"],
            "REAL quarterly Standards of Performance compliance data filed by a licensee. With only "
            "Annual Report available, v1.0 had nowhere correct to put it.",
        ),
        (
            lambda r: r["new"]["instrument"] == "Minutes of Meeting",
            "REAL minutes of a State Advisory Committee meeting. v1.0 tagged them Order -- minutes "
            "decide nothing.",
        ),
        (
            lambda r: r["new"]["instrument"] == "Licence",
            # This pick MATCHES NOTHING against the final log, deliberately, and is
            # kept so that fact is recorded rather than looking like an oversight.
            # The 09-11 pass assigned Licence to the Fifth-Amendment-of-Transmission-
            # Licence document; the 2026-09-14 re-run assigned it Order at 0.55, and
            # Licence fired zero times across all 100. So no Dataset row claims the
            # tag works. If a future run does produce one, this pick emits it again.
            "REAL licence, attached to the Order that granted it. Without a Licence tag the two are "
            "indistinguishable.",
        ),
        (
            lambda r: r["new"]["instrument"] == "Order" and r["new"]["confidence"] >= 0.9,
            "REAL final Order, correctly tagged by BOTH versions at high confidence. Included so the "
            "Dataset shows what v1.0 gets right, not only where it fails: the Order/Subject core of "
            "the taxonomy always worked.",
        ),
        (
            lambda r: r["new"]["instrument"] == "RTI Response / Disclosure",
            "REAL RTI reply, correctly tagged by both versions -- the highest-confidence Instrument "
            "Type in the run. v1.0's RTI handling needed no change.",
        ),
        (
            lambda r: r["new"]["instrument"] == "Regulations",
            "REAL Regulations, correctly tagged by both versions.",
        ),
        (
            lambda r: "Press Release" in r["hint"] and r["new"]["subject"] == "Licensing",
            "REAL statutory notice published through MERC's Press Release channel. Both versions "
            "correctly refused Public Communication & Outreach (the document has real operative "
            "content) and took the underlying matter's Subject. Drove the new press-release rule.",
        ),
        (
            lambda r: "Marathi" in r["prefix"],
            "REAL Marathi-language version of an English document -- 4.4% of the corpus, classified "
            "from extracted Devanagari text. Drove the new bilingual rule.",
        ),
    ]

    used: set[str] = set()
    dataset = []
    for predicate, note in picks:
        hit = pick(lambda r: predicate(r) and r["prefix"] not in used)
        if hit:
            used.add(hit["prefix"])
            dataset.append(emit(hit, note))

    spec["dataset"] = dataset
    spec["dataset_note"] = (
        "REAL classified documents from the 2026-09-10 runs. Each row is an actual merc.gov.in "
        "document that went through scrape -> normalize -> classify -> Postgres, and the Notes "
        "column gives BOTH what v1.0 assigned it and what v1.1 assigns the same document, with the "
        "real confidences. Unlike the v1.0 Dataset sheet, which listed documents confirmed by "
        "research, nothing here is asserted from research -- it is parsed back out of the run logs."
    )

    spec["changelog"] = CHANGELOG
    json.dump(spec, open(SPEC, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    print(f"dataset rows: {len(dataset)}, changelog entries: {len(CHANGELOG)}")
    for item in dataset:
        print(f"  - {item['date']:<20} {item['title'][:58]:58} -> {item['instrument']}")
    return 0


# WARNING: this constant is AUTHORITATIVE and main() assigns it straight over
# spec["changelog"], discarding whatever the spec held. So a correction made by
# hand in merc-revision.json is silently reverted the next time this script
# runs -- and the findings doc's own reproduce block tells you to run it before
# revise_taxonomy_workbook.py. Any changelog correction has to be made HERE as
# well as in the spec, or the documented procedure regenerates the old numbers.
# The 2026-09-14 re-measurement below was applied in both places for exactly
# this reason.
CHANGELOG = [
    {
        "change": "ADDED Instrument Type: Hearing Notice",
        "evidence": "48.2% of the real 20,740-document corpus (9,995 rows) and 47 of the 100 sampled "
        "documents. Under v1.0 all 47 were forced into a tag that does not describe them and split "
        "three ways, mean confidence 0.715, 62% flagged. Under the final v1.1 (re-measured "
        "2026-09-14): 43 of the 47 hearing-feed rows take Hearing Notice, every one of them with "
        "Status Not Applicable, at 0.82 mean confidence.",
    },
    {
        "change": "ADDED Instrument Type: Daily Order",
        "evidence": "11.8% of the corpus (2,448 rows), 13 of 100 sampled. Under v1.0 all 13 were "
        "tagged Order, mostly unflagged -- a silent misfit against v1.0's own 'disposing of a "
        "petition' wording. Real PDFs confirm a coram-signed procedural order in a still-pending "
        "case. The corpus also contains real 'Draft Daily Order' documents v1.0 cannot express.",
    },
    {
        "change": "ADDED Instrument Type: Report",
        "evidence": "416 SOP compliance-data rows plus 94 sector-report rows. The one sampled SOP row "
        "was tagged Annual Report (0.40) in one v1.0 pass and Order (0.60) in the next -- the "
        "disagreement between passes is the evidence that no stable answer existed.",
    },
    {
        "change": "ADDED Instrument Types: Licence, Tender / RFP, Notification, Minutes of Meeting, "
        "Recruitment Notice",
        "evidence": "84 / 279 / 189 / 43+ / 158 real rows respectively. Minutes of Meeting was drawn "
        "into the sample and fires correctly under v1.1 (v1.0 had tagged the SAC minutes as an "
        "Order). Licence fired once in the 09-11 pass but NOT in the 2026-09-14 re-run, where that "
        "same document reclassified to Order at 0.55 -- one document is too thin to call the tag "
        "validated, so it joins Notification, Recruitment Notice and Tender / RFP as proposed from "
        "confirmed corpus presence but untested, and says so in its Notes.",
    },
    {
        "change": "REVISED Status: Not Applicable -- now names procedural case-management communications",
        "evidence": "50 of 100 sampled documents took Not Applicable under a v1.0 definition naming "
        "only press releases, FAQs and 'other non-instrument content', while only 4 of the 100 were "
        "press releases or FAQs.",
    },
    {
        "change": "REVISED Status: In Force -- now names Daily Orders explicitly",
        "evidence": "Not a wording preference. The first v1.1 pass split Daily Orders 9 Not Applicable "
        "/ 3 In Force even though the new Tagging Guide rule pins them to In Force, because "
        "lib/ingest.ts builds its prompt from tag names and definitions only and NEVER reads the "
        "Tagging Guide sheet. After the rule was moved into this definition: Daily Order -> In Force, "
        "14 of 14.",
    },
    {
        "change": "REVISED Status: Under Litigation / Stayed -- the litigation must concern THIS "
        "document, and the stay must be granted",
        "evidence": "The single time it fired in 100 real documents it was wrong: a Daily Order whose "
        "own text reads 'no stay has been granted by the Supreme Court', about an appeal against the "
        "ATE's judgment rather than against itself. Confidence 0.85, auto-accepted, unflagged. Under "
        "v1.1 it fires zero times.",
    },
    {
        "change": "REVISED Instrument Type: Public Notice / Consultation Notice -- boundary against "
        "Hearing Notice stated, and widened to cover notices on specific pending applications",
        "evidence": "Absorbed 42 of 100 sampled documents under v1.0, 37 of them hearing notices. "
        "Under v1.1 it holds 7 -- the documents that genuinely are public consultation notices.",
    },
    {
        "change": "REVISED Instrument Type: Order -- Daily Order exclusion made explicit",
        "evidence": "v1.0 already said 'disposing of a petition', but with no alternative tag "
        "available all 13 sampled Daily Orders landed here regardless.",
    },
    {
        "change": "REVISED Instrument Type: Annual Report -- quarterly and periodic data excluded",
        "evidence": "Became the classifier's fallback for a quarterly SOP data file at confidence 0.40.",
    },
    {
        "change": "REVISED Subject: Institutional Governance & Administration -- widened to cover "
        "MERC's own procurement and recruitment",
        "evidence": "279 tender rows plus 158 recruitment rows (2.1% of the corpus) had no Subject "
        "that admitted them. Widening this Subject was preferred over adding one: MERC's own "
        "procurement is vehicle hire and office contracts, not a regulatory function.",
    },
    {
        "change": "REVISED Subject: Public Communication & Outreach -- kept, with its real (much "
        "smaller) population stated",
        "evidence": "Fired 0 of 100 in every pass. It correctly refused MERC's press-release feed, "
        "which is really statutory notices with operative content. The definition was doing its job; "
        "the feed name was misleading. Not deprecated.",
    },
    {
        "change": "ADDED 6 Tagging Guide rules",
        "evidence": "Hearing Notice tagging; Daily Order vs final Order; press-release-channel "
        "Subject; Marathi bilingual versions (4.4% of the corpus); do NOT map the site's own 91-value "
        "free-text hearing status column; self-referential litigation.",
    },
    {
        "change": "ADDED 8 Schema Notes",
        "evidence": "Corpus is ~60% procedural; archive depth is 2000 not 2002 (answering v1.0's own "
        "open question); three admin-ajax endpoints return 13,500 records in three requests; 4.4% "
        "bilingual duplication; the APTEL cross-reference is still unbuilt; 7% PDF extraction failure "
        "and 149 non-PDF files; a Tagging Guide rule is inert unless it is also in a tag definition; "
        "an explicit list of what v1.1 still has NOT tested.",
    },
    {
        "change": "MEASURED RESULT of applying v1.1 to the same 100 documents",
        "evidence": "RE-MEASURED 2026-09-14 against the final v1.1 wording, re-classifying the same "
        "100 documents from scratch. Flagged for review 40 -> 21 (-48%). low_confidence flags 39 -> "
        "21 (-46%). Instrument Types firing 5 of 10 -> 9 of 18. The two largest tags' combined share "
        "89% -> 68%. Hearing notices went from three inconsistent tag pairs to one: 43 of the 47 "
        "hearing-feed rows take Hearing Notice and all 43 of those take Not Applicable. Daily Orders "
        "went from three tag pairs to one, 14 of 14 In Force. Mean confidence rose on every Subject "
        "tag (v1.0 range 0.64-0.86, final v1.1 range 0.76-0.93). text_extraction_failed stayed at "
        "exactly 7 across every pass, as it should -- that is a PDF problem, not a taxonomy problem. "
        "EARLIER DRAFTS OF THIS ROW quoted 17 flags, 13 low_confidence, 10 of 18 types and 40/40 "
        "hearing notices; those came from a pass made BEFORE the 2026-09-11 definition changes were "
        "seeded, and are superseded by the numbers above.",
    },
]


if __name__ == "__main__":
    raise SystemExit(main())
