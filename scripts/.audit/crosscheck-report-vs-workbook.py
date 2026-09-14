"""
Verifies taxonomy-canonical-concepts.md and taxonomy-canonical-concepts.xlsx
state the same facts. Both are generated from findings.json, so this should
always pass -- it exists to catch a generator bug, not a data disagreement.
"""
import json, re, sys
import openpyxl

sys.stdout.reconfigure(encoding="utf-8")
F = json.load(open("scripts/.audit/findings.json", encoding="utf-8"))
md = open("taxonomy-canonical-concepts.md", encoding="utf-8").read()
wb = openpyxl.load_workbook("taxonomy-canonical-concepts.xlsx")

fails = []

# --- 1. Every (concept -> regulator, tag) pair appears in BOTH artefacts ----
truth = set()
for c in F["concepts"]:
    for t in c["tags"]:
        truth.add((c["name"], t["regulator"], t["tag"]))

ws = wb["Canonical Concepts Matrix"]
codes = [ws.cell(row=4, column=i).value for i in range(4, ws.max_column + 1)]
xl = set()
for r in range(5, ws.max_row + 1):
    name = ws.cell(row=r, column=1).value
    if not name or ws.cell(row=r, column=1).font.bold:  # section header / blank
        continue
    for i, code in enumerate(codes, start=4):
        v = ws.cell(row=r, column=i).value
        if v:
            xl.add((name, code, v))

if xl != truth:
    for x in sorted(truth - xl):
        fails.append(f"in report/db but NOT in workbook matrix: {x}")
    for x in sorted(xl - truth):
        fails.append(f"in workbook matrix but NOT in report/db: {x}")

# The markdown lists each concept's tags in its own table.
for name, reg, tag in sorted(truth):
    sec = re.search(r"^#### " + re.escape(name) + r"$(.*?)(?=^#### |\Z)", md, re.M | re.S)
    if not sec:
        fails.append(f"concept missing from markdown: {name}")
        continue
    if f"| {reg} | {tag.replace('|', chr(92) + '|')} |" not in sec.group(1):
        fails.append(f"markdown concept '{name}' does not list {reg} / {tag}")

# --- 2. False cognates match ------------------------------------------------
ws = wb["False Cognates"]
xl_cog = {ws.cell(row=r, column=1).value for r in range(5, ws.max_row + 1) if ws.cell(row=r, column=1).value}
md_cog = {c["tagName"] for c in F["falseCognates"]}
if xl_cog != md_cog:
    fails.append(f"false cognate sets differ: workbook={sorted(xl_cog)} vs data={sorted(md_cog)}")
for c in F["falseCognates"]:
    if f"#### `{c['tagName']}`" not in md:
        fails.append(f"false cognate missing from markdown: {c['tagName']}")
# No false-cognate tag name may also be a canonical concept name.
for c in F["falseCognates"]:
    if any(x["name"] == c["tagName"] for x in F["concepts"]):
        fails.append(f"'{c['tagName']}' is BOTH a false cognate and a canonical concept")

# --- 3. Inventory: every tag present in the workbook, with matching usage ---
ws = wb["Full Tag Inventory"]
FL = {"SUBJECT": "Subject", "INSTRUMENT_TYPE": "Instrument Type", "STATUS": "Status"}
xl_tags = {}
for r in range(5, ws.max_row + 1):
    reg = ws.cell(row=r, column=1).value
    if not reg:
        continue
    xl_tags[(reg, ws.cell(row=r, column=2).value, ws.cell(row=r, column=3).value)] = (
        ws.cell(row=r, column=6).value,  # usage
        ws.cell(row=r, column=8).value,  # mapped concept (None if blank)
    )
for t in F["tags"]:
    k = (t["regulator"], FL[t["facet"]], t["tag"])
    if k not in xl_tags:
        fails.append(f"tag missing from workbook inventory: {k}")
        continue
    usage, concept = xl_tags[k]
    if usage != t["usage_count"]:
        fails.append(f"usage mismatch {k}: workbook={usage} findings={t['usage_count']}")
    if (concept or None) != (t["concept"] or None):
        fails.append(f"concept mismatch {k}: workbook={concept!r} findings={t['concept']!r}")
if len(xl_tags) != len(F["tags"]):
    fails.append(f"workbook inventory has {len(xl_tags)} rows, findings has {len(F['tags'])}")

# --- 4. Coverage totals agree with the markdown's own totals ----------------
ws = wb["Coverage Summary"]
xl_total = xl_mapped = None
for r in range(5, ws.max_row + 1):
    if ws.cell(row=r, column=1).value == "ALL":
        xl_total, xl_mapped = ws.cell(row=r, column=12).value, ws.cell(row=r, column=13).value
real_mapped = len([t for t in F["tags"] if t["concept"]])
if xl_total != len(F["tags"]) or xl_mapped != real_mapped:
    fails.append(f"coverage totals: workbook={xl_mapped}/{xl_total} vs findings={real_mapped}/{len(F['tags'])}")
if f"**{real_mapped}**" not in md or f"**{len(F['tags'])}**" not in md:
    fails.append(f"markdown does not state the {real_mapped}/{len(F['tags'])} coverage total")

# --- report ----------------------------------------------------------------
if fails:
    print(f"FAIL — {len(fails)} disagreement(s):")
    for f_ in fails[:40]:
        print("  - " + f_)
    sys.exit(1)
print(
    f"PASS — markdown and workbook agree.\n"
    f"  {len(truth)} concept->tag links, {len(md_cog)} false cognates, "
    f"{len(F['tags'])} inventory rows, coverage {real_mapped}/{len(F['tags'])}."
)
