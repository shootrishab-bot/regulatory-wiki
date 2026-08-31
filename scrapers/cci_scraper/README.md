# CCI Regulatory Scraper & Watcher

Scrapes `cci.gov.in` and classifies documents against `CCI_Regulatory_Taxonomy_v1_1.xlsx`
(Subject / Instrument Type / Status), using the same AI-first, DeepSeek-based
classification approach as the rest of the regulatory wiki.

This is a rewrite of two earlier drafts that were reviewed and found to have
real problems: no actual AI classification (v1, keyword-matching pretending to
be a classifier), and a classification prompt that invented a `"PR Content"`
tag not in the taxonomy (v2). Both are fixed here structurally, not patched --
see `cci_scraper/__init__.py`'s docstring for the three fixes and why they
needed to be architectural rather than incremental.

## What's actually been verified vs. what needs a live check

**Verified in this environment** (no network route to cci.gov.in from here,
so anything requiring live HTTP is necessarily unverified):

- `source_id` generation is stable across re-runs (`sha1(regulator|url|title)`).
- The `Database` layer: save/update round-trips correctly, and a Status change
  is correctly written to `change_log`.
- `quick_prefilter` against the **exact real titles** that broke both prior
  drafts -- "chaired the Plenary Session", "chaired Technical Session II",
  "judged the Semi-Finals Round of Antitrust Moot Court Competition" all
  correctly drop; real regulatory titles (merger approvals, recruitment
  notices, Call for Papers) all correctly pass through.
- `classifier._validate_and_build`: a valid response parses correctly; a
  response containing the exact hallucinated `"PR Content"` tag from the
  reviewed v2 draft gets nulled out and flagged `needs_review`, not silently
  stored; a `keep: false` response is handled as a drop, not forced into a
  fake tag; malformed JSON is caught and flagged rather than crashing.

**NOT verified -- needs a live check before trusting in production:**

- Every CSS selector in `scraper.py` (`FEED_SELECTORS`, `ITEM_SELECTOR`, the
  tenders/market-studies selectors). These are best-effort reconstructions
  from *rendered text* seen during taxonomy research, not from inspecting the
  real DOM. If `extract_homepage_feed` (or any other extractor) logs
  `0 items found`, open the real page and update the selectors -- don't guess
  further.
- Whether the two AJAX search pages (Antitrust Orders, Combination
  Notifications) actually have a JSON API underneath, or render results via a
  full-page form POST. **Run `discover` before anything else** -- see below.
- `ANTITRUST_PRESS_RELEASE_URL` is confirmed (singular, per real research).
  `COMBINATION_PRESS_RELEASES_URL` and `RTI_URL` in `config.py` are marked
  unverified in a comment -- check them before relying on them.

## Setup

```bash
pip install -r requirements.txt --break-system-packages
playwright install chromium
```

Set environment variables:

```bash
export DEEPSEEK_API_KEY=sk-...
# Optional, for watcher email alerts:
export SMTP_HOST=smtp.example.com
export SMTP_USER=you@example.com
export SMTP_PASSWORD=...
export ALERT_EMAIL_FROM=cci-watcher@example.com
export ALERT_EMAIL_TO=you@example.com
```

## Commands

```bash
# 1. ALWAYS run this first -- discovers (or rules out) a JSON API behind the
#    two AJAX search pages, writes data/cci/api_discovery.json
python -m cci_scraper.cli discover

# 2. The taxonomy pressure-test you asked for: scrapes everything reachable,
#    randomly samples 350 items, runs the full pipeline, writes results +
#    a tag-count summary to ./output/
python -m cci_scraper.cli test-sample --n 350

# 3. Ordinary scrape + classify + save to SQLite (what the watcher calls each cycle)
python -m cci_scraper.cli scrape

# 4. Runs `scrape` on a loop (config.CHECK_INTERVAL_HOURS, default 6h) and
#    emails an alert whenever a tracked document's Status changes
python -m cci_scraper.cli watch
```

## Reading the test-sample output

`output/test-sample-<timestamp>.json` has the full per-document pipeline
output. `output/test-sample-summary-<timestamp>.json` has:

```json
{
  "total": 350, "kept": ..., "dropped": ...,
  "needs_review": ..., "needs_review_pct": ...,
  "by_subject": {...}, "by_instrument_type": {...}, "by_status": {...},
  "by_classification_method": {"ai": ..., "error_fallback": ..., "dropped_by_prefilter": ...}
}
```

Read this the same way the DST taxonomy test run was read: a Subject or
Instrument Type that never fires is a candidate for pruning; a real document
that keeps landing in `needs_review` with an out-of-vocabulary reason is a
candidate for a new tag or a Tagging Guide clarification; a high
`error_fallback` count means something is wrong with the DeepSeek connection,
not the taxonomy, and should be fixed before drawing any taxonomy conclusions
from that run.

`classification_method: "dropped_by_prefilter"` records are the ones the
regex pre-filter rejected before ever reaching the model -- worth spot-checking
a sample of these specifically, since a bad pre-filter pattern is the one
failure mode that's invisible in the `needs_review` numbers (a wrongly-dropped
document never gets the chance to be flagged).

## File map

```
cci_scraper/
  __init__.py        -- taxonomy constants (Subjects/Instrument Types/Statuses), fix rationale
  config.py            -- all URLs, secrets from env vars, verified/unverified marked in comments
  source_id.py          -- sha1(regulator|url|title), matches project convention
  database.py            -- SQLite: documents, change_log, scrape_runs
  extractor.py             -- HTML->Markdown w/ boilerplate stripping, PDF extraction w/ OCR fallback
  classifier.py             -- quick_prefilter + DeepSeek classification + strict vocab validation
  api_discovery.py           -- Playwright network-listener API discovery for the AJAX pages
  scraper.py                  -- raw scraping for all 5 sources, rate-limited + retried
  pipeline.py                   -- per-item orchestration: prefilter -> extract -> classify
  alerts.py                      -- email alerts for Status changes (was referenced but missing before)
  cli.py                          -- discover / scrape / watch / test-sample commands
```

## Regenerating taxonomy constants after editing the workbook

`cci_scraper/__init__.py`'s `SUBJECTS` / `INSTRUMENT_TYPES` / `STATUSES` lists
are currently hand-copied from `CCI_Regulatory_Taxonomy_v1_1.xlsx`. If you'd
rather they be generated automatically (recommended, so they can never drift
from the workbook), the same pattern used in the Saral Sanchar/DST scrapers
applies -- export the Taxonomy sheet's three facets to a JSON file and load it
at import time instead of hardcoding the lists.
