"""Fills the CPPP revision spec's Dataset sheet from the REAL runs.

Unlike MERC, CPPP has no before/after pair to compare: its v1.1 changes are one
added tag, four labelled unreachable, and six definitions tightened, and the
added tag did not exist when these documents were classified. So each Dataset
row records what the v1.0 taxonomy actually assigned, and the Notes column says
whether v1.1 keeps that answer or corrects it -- with the correction stated
explicitly rather than implied.

Inputs, both kept alongside this script:
    scripts/.audit/cppp-run-v1_0.log                -- the population-weighted 100
    scripts/.audit/cppp-run-v1_0-institutional.log  -- all 89 institutional documents

Run:
    python scripts/.audit/build_cppp_dataset.py
"""

from __future__ import annotations

import json
import re

AUDIT = "scripts/.audit"
MAIN_LOG = f"{AUDIT}/cppp-run-v1_0.log"
INST_LOG = f"{AUDIT}/cppp-run-v1_0-institutional.log"
SPEC = f"{AUDIT}/cppp-revision.json"

LINE_RE = re.compile(
    r"^\[(?P<flag>[^\]]+)\]\s+(?P<title>.*?)\s+->\s+"
    r"subject=(?P<subject>[^|]+?)\s*\|\s*"
    r"instrument=(?P<instrument>[^|]+?)\s*\|\s*"
    r"status=(?P<status>[^|]+?)\s*\|\s*"
    r"confidence=(?P<confidence>[0-9.]+)\s*$"
)


def parse_log(path: str, pass_name: str) -> list[dict]:
    rows: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            match = LINE_RE.match(line.strip())
            if not match:
                continue
            row = match.groupdict()
            row["confidence"] = float(row["confidence"])
            row["flagged"] = row["flag"] == "FLAGGED"
            row["pass"] = pass_name
            rows.append(row)
    return rows


def main() -> int:
    rows = parse_log(MAIN_LOG, "weighted-100") + parse_log(INST_LOG, "institutional-89")
    spec = json.load(open(SPEC, encoding="utf-8"))

    used: set[str] = set()

    def pick(predicate):
        for row in rows:
            if row["title"] not in used and predicate(row):
                used.add(row["title"])
                return row
        return None

    def emit(row: dict, verdict: str, note: str) -> dict:
        return {
            "date": "",  # the logs do not print dates; SourceDocument holds them
            "title": row["title"],
            "instrument": row["instrument"],
            "subject": row["subject"],
            "status": row["status"],
            "notes": (
                f"[{row['pass']}] {note} v1.0 assigned this at confidence "
                f"{row['confidence']:.2f}"
                f"{', FLAGGED for review' if row['flagged'] else ', auto-accepted'}. "
                f"v1.1 verdict: {verdict}"
            ),
        }

    picks = [
        (
            lambda r: r["instrument"] == "Tender Notice (NIT)" and r["subject"] == "Goods Procurement",
            "CORRECT, unchanged.",
            "REAL live tender notice -- 87% of CPPP's corpus is this one shape. Tender notices "
            "classify essentially perfectly: 0 of 89 flagged, 0.894 mean confidence.",
        ),
        (
            lambda r: r["instrument"] == "Tender Notice (NIT)" and r["subject"] == "Works Procurement",
            "CORRECT, unchanged.",
            "REAL works tender. The Goods/Works boundary was never in doubt in this run.",
        ),
        (
            lambda r: r["instrument"] == "Tender Notice (NIT)"
            and r["subject"] == "Consultancy Services Procurement",
            "CORRECT, unchanged -- and notable.",
            "REAL consultancy tender. CPPP's OWN vocabulary has no consultancy/non-consultancy "
            "split (its search offers only Goods/Services/Works), so this is the taxonomy making a "
            "distinction finer than the source's, from the title alone -- and getting it right. "
            "Caveat: consistent and plausible, NOT verified against ground truth, which is "
            "CAPTCHA-gated.",
        ),
        (
            lambda r: r["instrument"] == "Tender Notice (NIT)"
            and r["subject"] == "Non-Consultancy Services Procurement",
            "CORRECT, unchanged.",
            "REAL non-consultancy service tender, correctly separated from consultancy on title "
            "evidence alone.",
        ),
        (
            lambda r: r["instrument"] == "Corrigendum" and r["flagged"],
            "KEPT, with the rule's real limit now stated.",
            "REAL corrigendum, and the run's characteristic failure: every one of the four review "
            "flags in the 100-document sample was a corrigendum (4 of 9, 44%, at 0.788 mean "
            "confidence against 0.894 for tender notices). The listing shows the underlying "
            "TENDER's title, not what the corrigendum changed -- the subtype the taxonomy's first "
            "Tagging Guide rule depends on is behind the CAPTCHA.",
        ),
        (
            lambda r: r["instrument"] == "Corrigendum" and not r["flagged"],
            "KEPT, with the rule's real limit now stated.",
            "REAL corrigendum that classified cleanly -- included so the Dataset does not imply "
            "every corrigendum is uncertain. Status defaulted to Corrigendum Issued because that "
            "is the only subtype the public feed can support.",
        ),
        (
            lambda r: r["instrument"] == "Press Release",
            "CORRECTED -- v1.1 moves this to Report / Statistics.",
            "REAL monthly statistical report. v1.0 had no report-shaped Instrument Type, so this "
            "landed on Press Release; the classifier's own reason called it 'a monthly statistical "
            "report on tender activity'. 511 real rows are this shape.",
        ),
        (
            lambda r: "Manual for Procurement of Goods" in r["title"],
            "CORRECTED -- v1.1 Subject is Procurement Policy & Framework.",
            "REAL FAILURE, and the sharpest of the run. The GFR Manual for Procurement of Goods "
            "procures no goods; it is the rulebook, and it is named verbatim in the Procurement "
            "Policy & Framework definition. Tagged Goods Procurement at 0.97 and auto-accepted -- "
            "confident error, not uncertainty. Drove the new transaction-only rule.",
        ),
        (
            lambda r: "Model Tender Document" in r["title"],
            "CORRECTED -- v1.1 Subject is Procurement Policy & Framework.",
            "REAL FAILURE of the same shape: a model document showing how to draft a tender, "
            "tagged as though it were one.",
        ),
        (
            lambda r: r["instrument"] == "Circular / Office Memorandum"
            and r["subject"] == "Procurement Policy & Framework"
            and not r["flagged"],
            "CORRECT, unchanged.",
            "REAL procurement-policy O.M., correctly tagged. Included so the Dataset shows the "
            "institutional half of the taxonomy working, not only where it fails.",
        ),
        (
            lambda r: "General Financial Rule" in r["title"],
            "KEPT both tags; v1.1 adds a form-based tie-break rule.",
            "REAL boundary case, and the lowest-confidence institutional classification in the "
            "run. An amendment to the GFR is genuinely BOTH: issued as an O.M., amending a manual. "
            "37 of 89 institutional documents were flagged, split almost evenly between the two "
            "tags (18 and 19) -- the signature of an undecidable boundary.",
        ),
        (
            lambda r: r["instrument"] == "FAQ",
            "CORRECT, unchanged.",
            "REAL CPPP FAQ document -- the one the v1.0 Dataset sheet cites (CPPP-FAQs.pdf), now "
            "confirmed by an actual classified run rather than by research.",
        ),
        (
            lambda r: r["subject"] == "Platform Administration & Onboarding",
            "CORRECT, unchanged.",
            "REAL platform-operations document. This Subject fired 10 times on the institutional "
            "pass and 0 times on the weighted 100 -- correctly, since institutional content is "
            "0.3% of the live corpus.",
        ),
    ]

    dataset = []
    for predicate, verdict, note in picks:
        hit = pick(predicate)
        if hit:
            dataset.append(emit(hit, verdict, note))

    spec["dataset"] = dataset
    json.dump(spec, open(SPEC, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    print(f"dataset rows: {len(dataset)} (from {len(rows)} real classified documents)")
    for item in dataset:
        print(f"  - {item['title'][:60]:60} -> {item['instrument']} / {item['subject']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
