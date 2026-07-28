"""
Normalized Document Contract — the single shape every watcher script's
adapter must produce, regardless of what CSV/JSON schema that script uses
internally.

WHY THIS EXISTS
Across 13 scripts we found exactly 3 real patterns (see the docstrings on
each field below for which scripts fall into which). Rather than writing
13 bespoke ingestion paths, every adapter converts its own script's output
into ONE shape, and exactly one downstream ingestion pipeline (in
TypeScript, using Prisma — see ARCHITECTURE note below) consumes it.

ARCHITECTURE
Python's job stops here. This module's output (a JSON file per regulator
run) is read by a Node/TypeScript ingestion script inside the
regulatory-wiki project itself, which owns all Prisma/Postgres writes,
PDF download + extraction for documents that still need it, and the
classification API call. Python never touches the database directly —
this avoids running two different DB clients (Prisma in Node, something
else in Python) against the same schema.

Run each adapter, then write its output list as JSON:
    documents = [pfrda_adapter.normalize(row) for row in load_pfrda_csv()]
    write_normalized_json("pfrda_normalized.json", documents)
"""

from dataclasses import dataclass, asdict, field
from typing import Optional
import json


@dataclass
class NormalizedDocument:
    # ---- always required ----
    regulator_code: str          # e.g. "PFRDA", "CERC", "SEBI" — must match
                                  # a Regulator.code already seeded in Postgres
    source_id: str               # the ORIGINAL scraper's own dedup id/hash —
                                  # kept as a stable fingerprint alongside our
                                  # own documentCode, not replaced by it
    title: str
    source_url: str              # the listing/detail page this was found on

    # ---- usually present, but genuinely optional depending on the source site ----
    published_date: Optional[str] = None   # ISO 8601 (YYYY-MM-DD) if parseable,
                                            # raw string otherwise — normalize
                                            # format differences HERE, in the
                                            # adapter, not downstream
    file_url: Optional[str] = None         # direct PDF/doc link, if one exists
    file_extension_hint: Optional[str] = None  # "pdf" | "xlsx" | "doc" | etc —
                                                # MIB and MTCTE both surface
                                                # non-PDF formats; don't assume PDF

    category_hint: Optional[str] = None    # the scraper's own section/category
                                            # label (e.g. "Master_Circular",
                                            # "GENERAL_ORDER") — a real, useful
                                            # weak signal for Instrument Type
                                            # classification, pass it through,
                                            # don't discard it

    status_hint: Optional[str] = None      # the scraper's own REAL status label
                                            # for this document, when the source
                                            # site actually tracks one (e.g.
                                            # MTCTE's archive table has a genuine
                                            # Active/Expired column). This is
                                            # ground truth from the regulator
                                            # itself, not a model guess — the
                                            # ingestion pipeline should let it
                                            # override the classifier's own
                                            # DocumentStatus determination when
                                            # present. None for every regulator
                                            # that doesn't track this (DoT and
                                            # everything else so far).

    # ---- content, when the scraper already has some ----
    raw_text: Optional[str] = None
    raw_text_source: Optional[str] = None
    # One of: None | "html_page" | "pdf_full" | "pdf_excerpt"
    #   None        = no content yet, downstream must download + extract
    #                 (Pattern A: SEBI, MIB, IRDAI, CCI, DOT, FIU, MTCTE, PFRDA)
    #   "html_page" = extracted from the detail page's own HTML, not a PDF
    #                 (Pattern B: ipindia, rbi_faq — when no PDF link exists)
    #   "pdf_excerpt" = extracted from a PDF but SEMANTICALLY FILTERED to a
    #                 relevance-ranked digest, NOT the full document
    #                 (Pattern C: aptel, cerc — classification should treat
    #                 this as lower-confidence/partial and flag accordingly,
    #                 same caution we applied to any partial-text case in
    #                 the IFSCA project)

    needs_download: bool = True   # False only when raw_text is already
                                   # complete enough to classify from as-is
                                   # (Pattern B html_page case, generally)

    scraped_at: Optional[str] = None  # ISO timestamp from the original scraper


def write_normalized_json(path: str, documents: list[NormalizedDocument]):
    with open(path, "w", encoding="utf-8") as f:
        json.dump([asdict(d) for d in documents], f, indent=2, ensure_ascii=False)
