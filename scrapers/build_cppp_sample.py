"""
Draws a POPULATION-WEIGHTED random sample of CPPP documents and normalizes it.

WHY THIS EXISTS, AND WHY A PLAIN RANDOM DRAW WOULD BE WRONG HERE
cppp_watcher.py samples PAGES, not documents, and it samples the same number
of pages from each listing feed. That is the right way to scrape (it spreads
the crawl across the whole of each feed instead of front-loading it), but it
makes the scraped file a badly distorted picture of the live portal:

    feed                     live pages   pages scraped   share of live feed
    active_tenders                2,636             250                 9.5%
    active_corrigendums             249             249                  100%
    high_value_tenders               45              45                  100%
    global_tenders                   13              13                  100%

A uniform random draw over the scraped file would therefore hand back a
"random sample of CPPP" in which corrigenda are over-represented by more than
ten to one. Every share quoted from it -- how often a Subject fires, how often
Status is Corrigendum Issued -- would be wrong, and wrong in a direction that
flatters the taxonomy's corrigendum handling.

So the sample is drawn in proportion to each feed's REAL population on the
live portal, taken from the page counts the scraper itself discovered, not
from how much of it happened to be scraped. Within a stratum the draw is
uniform and seeded.

Run:
    python scrapers/build_cppp_sample.py --size 100 --seed 20260910
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cppp_adapter  # noqa: E402
from normalized_document import write_normalized_json  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
RAW_PATH = os.path.join(DATA_DIR, "cppp_raw.json")
OUT_PATH = os.path.join(DATA_DIR, "cppp_sample_normalized.json")

def load_meta(raw_path: str) -> dict:
    """The page counts the scraper actually observed, from its sidecar file.

    Deliberately NOT a constant in this file. The live counts move under you --
    `active_corrigendums` advertised 249 pages at the start of one run and 259
    an hour later, mid-run -- so a hardcoded table would quietly go stale and
    skew every weight computed from it. If the sidecar is missing, this refuses
    to guess.
    """
    meta_path = raw_path.rsplit(".json", 1)[0] + ".meta.json"
    if not os.path.exists(meta_path):
        raise SystemExit(
            f"{meta_path} not found. Re-run scrapers/cppp_watcher.py -- it writes the "
            f"page counts this weighting depends on, and they cannot be recovered "
            f"from the scraped rows alone."
        )
    with open(meta_path, encoding="utf-8") as fh:
        return json.load(fh)


def population_weights(rows: list[dict], meta: dict) -> dict[str, int]:
    """Real live population per feed.

    For a paginated listing feed that is page-count x rows-per-page, because
    only a fraction of it was fetched. For the institutional feeds, which are
    fetched in full, the scraped row count IS the population.
    """
    live_pages = meta.get("live_page_counts", {})
    per_page = meta.get("rows_per_page", 10)
    weights: dict[str, int] = {}
    for row in rows:
        feed = row["feed"]
        if feed in live_pages:
            weights[feed] = live_pages[feed] * per_page
        else:
            weights[feed] = weights.get(feed, 0) + 1
    return weights


def draw(
    rows: list[dict], meta: dict, size: int, seed: int
) -> tuple[list[dict], list[tuple[str, int, int, int]]]:
    by_feed: dict[str, list[dict]] = {}
    for row in rows:
        by_feed.setdefault(row["feed"], []).append(row)

    weights = population_weights(rows, meta)
    total = sum(weights.values())
    rng = random.Random(seed)

    # Largest-remainder allocation, so the quotas sum to exactly `size` instead
    # of drifting by a document or two through repeated rounding.
    exact = {feed: size * weights[feed] / total for feed in by_feed}
    quota = {feed: int(value) for feed, value in exact.items()}
    remaining = size - sum(quota.values())
    for feed, _ in sorted(exact.items(), key=lambda kv: kv[1] - int(kv[1]), reverse=True):
        if remaining <= 0:
            break
        quota[feed] += 1
        remaining -= 1

    sample: list[dict] = []
    report: list[tuple[str, int, int, int]] = []
    for feed, pool in sorted(by_feed.items()):
        want = min(quota.get(feed, 0), len(pool))
        picked = rng.sample(pool, want) if want else []
        sample.extend(picked)
        report.append((feed, weights[feed], len(pool), len(picked)))

    rng.shuffle(sample)
    return sample, report


def main() -> int:
    parser = argparse.ArgumentParser(description="Population-weighted CPPP sample")
    parser.add_argument("--size", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20260910)
    parser.add_argument("--raw", default=RAW_PATH)
    parser.add_argument("--out", default=OUT_PATH)
    args = parser.parse_args()

    with open(args.raw, encoding="utf-8") as fh:
        rows = json.load(fh)

    meta = load_meta(args.raw)
    sample, report = draw(rows, meta, args.size, args.seed)
    documents = cppp_adapter.normalize_all(sample)
    write_normalized_json(args.out, documents)

    total_population = sum(w for _, w, _, _ in report)
    print(f"Population-weighted sample of {len(documents)} from {len(rows)} scraped rows")
    print(f"(estimated live CPPP population across the scraped feeds: {total_population:,})\n")
    print(f"{'feed':<24}{'live pop':>10}{'scraped':>10}{'sampled':>9}{'live share':>12}")
    for feed, weight, scraped, picked in sorted(report, key=lambda r: -r[1]):
        share = f"{100 * weight / total_population:.1f}%"
        print(f"{feed:<24}{weight:>10,}{scraped:>10,}{picked:>9}{share:>12}")
    print(f"\nWrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
