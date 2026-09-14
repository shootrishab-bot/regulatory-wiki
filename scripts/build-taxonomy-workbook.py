"""
Builds taxonomy-canonical-concepts.xlsx for the team.

Reads scripts/.audit/findings.json and NOTHING else -- the same file
taxonomy-canonical-concepts.md is rendered from. Neither artefact re-derives
anything, so the workbook and the markdown report cannot disagree.

Visual conventions follow the project's existing taxonomy workbooks
(Regulator_Taxonomy_Facet_Comparison.xlsx, FIU_Regulatory_Taxonomy_v1_0.xlsx):
  row 1  bold 13pt title
  row 2  10pt subtitle note
  row 4  header row, bold white on dark slate 1F2937
  row 5  data starts, panes frozen above it
  present-value cells filled light green D1FAE5

Regenerate with:  python scripts/build-taxonomy-workbook.py
"""

import json
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

OUT = "taxonomy-canonical-concepts.xlsx"
SRC = "scripts/.audit/findings.json"

# --- project conventions ---------------------------------------------------
HEADER_FILL = PatternFill("solid", fgColor="1F2937")
HEADER_FONT = Font(bold=True, color="FFFFFF")
PRESENT_FILL = PatternFill("solid", fgColor="D1FAE5")   # mapped / present
SECTION_FILL = PatternFill("solid", fgColor="E5E7EB")   # facet group header
WARN_FILL = PatternFill("solid", fgColor="FEE2E2")      # false-cognate emphasis
TITLE_FONT = Font(bold=True, size=13)
SUB_FONT = Font(size=10)
SECTION_FONT = Font(bold=True, size=11)
TOP_WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")

FACET_ORDER = ["SUBJECT", "INSTRUMENT_TYPE", "STATUS"]
FACET_LABEL = {"SUBJECT": "Subject", "INSTRUMENT_TYPE": "Instrument Type", "STATUS": "Status"}

with open(SRC, encoding="utf-8") as fh:
    F = json.load(fh)

CODES = [r["code"] for r in F["regulators"]]
GEN = F["generatedAt"][:10]
TAGS = F["tags"]


def tag_row(reg, facet, name):
    for t in TAGS:
        if t["regulator"] == reg and t["facet"] == facet and t["tag"] == name:
            return t
    return None


def live_version(reg):
    vs = [v["version"] for v in F["liveVersions"] if v["regulator"] == reg]
    return ", ".join(vs) if vs else "(no entries)"


def head(ws, title, subtitle, headers, widths, freeze="A5", wrap_from=None):
    """Title / subtitle / header row in the project's house style."""
    ws["A1"] = title
    ws["A1"].font = TITLE_FONT
    ws["A2"] = subtitle
    ws["A2"].font = SUB_FONT
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=4, column=i, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = Alignment(wrap_text=True, vertical="bottom")
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = freeze
    ws.row_dimensions[2].height = 30
    ws.row_dimensions[4].height = 30
    return 5


wb = Workbook()

# ===========================================================================
# SHEET 1 -- Canonical Concepts Matrix
# ===========================================================================
ws = wb.active
ws.title = "Canonical Concepts Matrix"

headers = ["Canonical concept", "Definition", "Regulators"] + CODES
widths = [40, 62, 11] + [15] * len(CODES)
r = head(
    ws,
    "Canonical Concepts — regulator × concept matrix",
    "One row per shared concept confirmed across 2+ regulators. A cell holds that regulator's own real tag name where it maps to the "
    "concept, and is BLANK where that regulator has no equivalent. Blank means 'no confirmed equivalent', which is a normal and correct "
    f"answer — not missing data. Generated from the live database on {GEN}.",
    headers,
    widths,
    freeze="D5",
)

for facet in FACET_ORDER:
    rows = [c for c in F["concepts"] if c["facet"] == facet]
    # bold section header row between facet groups
    sc = ws.cell(row=r, column=1, value=f"{FACET_LABEL[facet]}  —  {len(rows)} concepts")
    sc.font = SECTION_FONT
    for col in range(1, len(headers) + 1):
        ws.cell(row=r, column=col).fill = SECTION_FILL
    r += 1

    for c in rows:
        by_reg = {t["regulator"]: t["tag"] for t in c["tags"]}
        ws.cell(row=r, column=1, value=c["name"]).alignment = TOP_WRAP
        ws.cell(row=r, column=2, value=c["definition"]).alignment = TOP_WRAP
        ws.cell(row=r, column=3, value=len(by_reg)).alignment = TOP
        for i, code in enumerate(CODES, start=4):
            if code in by_reg:
                cell = ws.cell(row=r, column=i, value=by_reg[code])
                cell.fill = PRESENT_FILL
                cell.alignment = TOP_WRAP
            # else: deliberately left blank -- no "N/A", no "-"
        r += 1
    r += 1  # blank spacer between facet groups

# ===========================================================================
# SHEET 2 -- False Cognates
# ===========================================================================
ws = wb.create_sheet("False Cognates")

# The definition columns are keyed by the label used in the findings file,
# which carries the regulator code plus its disposition. Build one column per
# distinct regulator code appearing across all false cognates.
def code_of(label):
    for code in sorted(CODES, key=len, reverse=True):
        if label == code or label.startswith(code + " ") or label.startswith(code + "("):
            return code
    return None


cog_codes = []
for c in F["falseCognates"]:
    for label in c["definitions"]:
        code = code_of(label)
        if code and code not in cog_codes:
            cog_codes.append(code)
cog_codes = [c for c in CODES if c in cog_codes]

headers = ["Tag name", "Facet", "Why these are NOT the same thing"] + cog_codes
widths = [30, 16, 70] + [52] * len(cog_codes)
r = head(
    ws,
    "False Cognates — SAME NAME, DIFFERENT MEANING. Do not treat these as equivalent.",
    "Each of these tag names is used by several regulators for genuinely DIFFERENT instruments. The cells below hold each regulator's own "
    "Tagging Guide definition text, verbatim — read them side by side and the divergence is obvious. None of these tag names gets a shared "
    "canonical concept, because a wrong shared concept is worse than none: it would silently merge two different scopes and make "
    "cross-regulator search return the wrong documents. Where a cell is marked MAPPED, that specific regulator's tag was confirmed to belong "
    "to a shared concept while its same-named siblings were not.",
    headers,
    widths,
    freeze="D5",
)
ws["A1"].font = Font(bold=True, size=13, color="991B1B")
ws.row_dimensions[2].height = 58

for c in F["falseCognates"]:
    ws.cell(row=r, column=1, value=c["tagName"]).alignment = TOP_WRAP
    ws.cell(row=r, column=1).font = Font(bold=True)
    ws.cell(row=r, column=1).fill = WARN_FILL
    ws.cell(row=r, column=2, value=FACET_LABEL[c["facet"]]).alignment = TOP_WRAP
    ws.cell(row=r, column=3, value=c["verdict"]).alignment = TOP_WRAP
    # A regulator can appear more than once for one tag name -- FIU has both a
    # mapped and an unmapped Subject in the procurement finding. Collect per
    # column and join, so the second entry never overwrites the first.
    per_col = {}
    all_mapped = {}
    for label, text in c["definitions"].items():
        code = code_of(label)
        if not code or code not in cog_codes:
            continue
        col = 4 + cog_codes.index(code)
        mapped = "MAPPED" in label
        # Preserve the disposition ("as 'Orders'", "NOT mapped") alongside the text.
        detail = label[len(code):].strip(" -—")
        per_col.setdefault(col, []).append((f"[{detail}]\n" if detail else "") + text)
        all_mapped[col] = all_mapped.get(col, True) and mapped
    for col, parts in per_col.items():
        cell = ws.cell(row=r, column=col, value="\n\n".join(parts))
        cell.alignment = TOP_WRAP
        # Only a column whose every entry is mapped reads as a confirmed match;
        # a mixed column is a divergence and must not look like a clean match.
        cell.fill = PRESENT_FILL if all_mapped[col] else WARN_FILL
    ws.row_dimensions[r].height = 118
    r += 1

# ===========================================================================
# SHEET 3 -- Full Tag Inventory (long format)
# ===========================================================================
ws = wb.create_sheet("Full Tag Inventory")

headers = [
    "Regulator", "Facet", "Tag name", "Short code", "Live taxonomy version",
    "Real usage count", "Tag status", "Mapped canonical concept", "Regulator's own definition",
]
widths = [14, 16, 52, 12, 20, 16, 15, 44, 82]
r = head(
    ws,
    "Full Tag Inventory — every real tag in the live database",
    "One row per (Regulator, Facet, Tag). This is the complete picture the other sheets are drawn from — sortable and filterable. "
    "'Live taxonomy version' is the value actually carried by that regulator's UpdateEntry rows, NOT what any taxonomy workbook says. "
    "'Real usage count' is how many entries actually carry the tag; a 0 is a genuine zero. 'Mapped canonical concept' is blank where the "
    f"tag maps to nothing, which is the case for most Subject tags and is correct. Generated on {GEN}.",
    headers,
    widths,
    freeze="D5",
)
ws.row_dimensions[2].height = 46

start = r
for reg in CODES:
    lv = live_version(reg)
    for facet in FACET_ORDER:
        for t in [x for x in TAGS if x["regulator"] == reg and x["facet"] == facet]:
            ws.cell(row=r, column=1, value=reg).alignment = TOP
            ws.cell(row=r, column=2, value=FACET_LABEL[facet]).alignment = TOP
            ws.cell(row=r, column=3, value=t["tag"]).alignment = TOP_WRAP
            ws.cell(row=r, column=4, value=t["short_code"]).alignment = TOP
            ws.cell(row=r, column=5, value=lv).alignment = TOP
            uc = ws.cell(row=r, column=6, value=t["usage_count"])
            uc.alignment = TOP
            if t["usage_count"] == 0:
                uc.fill = WARN_FILL
            ws.cell(row=r, column=7, value=t["tag_status"]).alignment = TOP
            if t["concept"]:
                cc = ws.cell(row=r, column=8, value=t["concept"])
                cc.fill = PRESENT_FILL
                cc.alignment = TOP_WRAP
            # else: blank, per spec
            ws.cell(row=r, column=9, value=t["definition"] or "").alignment = TOP_WRAP
            r += 1
ws.auto_filter.ref = f"A4:{get_column_letter(len(headers))}{r - 1}"

# ===========================================================================
# SHEET 4 -- Coverage Summary
# ===========================================================================
ws = wb.create_sheet("Coverage Summary")

headers = [
    "Regulator", "Full name", "Domain", "Live taxonomy version", "Entries",
    "Subject tags", "Subject mapped", "Instrument Type tags", "Instrument Type mapped",
    "Status tags", "Status mapped", "Total tags", "Total mapped", "% mapped", "Unused tags (0 entries)",
]
widths = [14, 44, 22, 20, 10, 13, 15, 18, 20, 12, 14, 12, 13, 11, 18]
r = head(
    ws,
    "Coverage Summary — the shape of things, one row per regulator",
    "How many tags each regulator has per facet, and how many of them map to a shared canonical concept. Note the pattern: Status is almost "
    "fully mapped everywhere (the vocabularies genuinely converged), while Subject is barely mapped (subjects are irreducibly "
    f"regulator-specific). Low Subject coverage is the expected result, not a gap to close. Generated on {GEN}.",
    headers,
    widths,
    freeze="B5",
)
ws.row_dimensions[2].height = 44

totals = {"SUBJECT": [0, 0], "INSTRUMENT_TYPE": [0, 0], "STATUS": [0, 0]}
grand = [0, 0, 0, 0]
for reg in F["regulators"]:
    code = reg["code"]
    mine = [t for t in TAGS if t["regulator"] == code]
    entries = sum(v["entries"] for v in F["liveVersions"] if v["regulator"] == code)
    ws.cell(row=r, column=1, value=code).font = Font(bold=True)
    ws.cell(row=r, column=2, value=reg["name"]).alignment = TOP_WRAP
    ws.cell(row=r, column=3, value=reg["domain"]).alignment = TOP_WRAP
    ws.cell(row=r, column=4, value=live_version(code)).alignment = TOP
    ws.cell(row=r, column=5, value=entries).alignment = TOP
    col = 6
    for facet in FACET_ORDER:
        fx = [t for t in mine if t["facet"] == facet]
        mp = [t for t in fx if t["concept"]]
        ws.cell(row=r, column=col, value=len(fx)).alignment = TOP
        mc = ws.cell(row=r, column=col + 1, value=len(mp))
        mc.alignment = TOP
        if mp:
            mc.fill = PRESENT_FILL
        totals[facet][0] += len(fx)
        totals[facet][1] += len(mp)
        col += 2
    tm = len([t for t in mine if t["concept"]])
    ws.cell(row=r, column=12, value=len(mine)).alignment = TOP
    ws.cell(row=r, column=13, value=tm).alignment = TOP
    pc = ws.cell(row=r, column=14, value=round(tm / len(mine), 3) if mine else 0)
    pc.number_format = "0%"
    pc.alignment = TOP
    unused = len([t for t in mine if t["usage_count"] == 0])
    uc = ws.cell(row=r, column=15, value=unused)
    uc.alignment = TOP
    if unused == len(mine) and mine:
        uc.fill = WARN_FILL
    grand[0] += len(mine)
    grand[1] += tm
    grand[2] += entries
    grand[3] += unused
    r += 1

ws.cell(row=r, column=1, value="ALL").font = Font(bold=True)
ws.cell(row=r, column=5, value=grand[2]).font = Font(bold=True)
col = 6
for facet in FACET_ORDER:
    ws.cell(row=r, column=col, value=totals[facet][0]).font = Font(bold=True)
    ws.cell(row=r, column=col + 1, value=totals[facet][1]).font = Font(bold=True)
    col += 2
ws.cell(row=r, column=12, value=grand[0]).font = Font(bold=True)
ws.cell(row=r, column=13, value=grand[1]).font = Font(bold=True)
tc = ws.cell(row=r, column=14, value=round(grand[1] / grand[0], 3))
tc.number_format = "0%"
tc.font = Font(bold=True)
ws.cell(row=r, column=15, value=grand[3]).font = Font(bold=True)
for c_ in range(1, len(headers) + 1):
    ws.cell(row=r, column=c_).fill = SECTION_FILL

r += 2
ws.cell(row=r, column=1, value="ESIC has a complete seeded taxonomy and zero documents — every ESIC usage count is a genuine zero.").font = SUB_FONT
r += 1
ws.cell(row=r, column=1, value="Every regulator's live taxonomy version is v1.0, including regulators whose tags are marked versionAdded v1.3 or v2.0. See the markdown report, Finding A.").font = SUB_FONT

wb.save(OUT)
print(
    f"{OUT}: {len(wb.sheetnames)} sheets {wb.sheetnames} | "
    f"{len(F['concepts'])} concepts, {len(TAGS)} tags, {len(F['falseCognates'])} false cognates"
)
