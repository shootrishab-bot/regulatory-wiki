"""
Spot-check a regulator's normalized JSON before it is trusted.

Usage (from scrapers/):
    python verify_normalized.py data/mib_normalized.json
    python verify_normalized.py data/*_normalized.json --sample 10
    python verify_normalized.py dot/dot_normalized.json --no-fetch

Whole-file checks, on every record:
  * the NormalizedDocument fields are present (normalized_document.py)
  * source_id is unique -- a collision would make ingest.ts treat two real
    documents as one
  * published_date is ISO YYYY-MM-DD and not in the future
  * no empty titles

Sampled checks, on --sample random records (default 10, fixed --seed so a
re-run checks the same ones):
  * file_url (or source_url when there is no file) really answers: an HTTP
    GET that returns 2xx, and for a .pdf link, bytes that start with %PDF.
    A 200 that is actually an HTML error page is the failure this catches.

Exit code 1 if any check fails, so it can gate a script. Nothing is written
anywhere; it only reads the JSON and the regulators' own URLs.
"""

import argparse
import json
import random
import re
import sys
from datetime import date

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUIRED_FIELDS = [
    "regulator_code", "source_id", "title", "source_url", "published_date",
    "file_url", "category_hint", "needs_download",
]
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
}


def check_link(url: str) -> str | None:
    """None if the link really serves content, else a one-line reason."""
    try:
        # verify=False: several regulators (APTEL, CERC's apex host, some
        # NIC-hosted sites) serve incomplete certificate chains. The question
        # here is whether the document exists, not whether their TLS is tidy.
        resp = requests.get(url, headers=HEADERS, timeout=45, stream=True, verify=False, allow_redirects=True)
        head = next(resp.iter_content(1024), b"")
        resp.close()
    except requests.RequestException as e:
        return f"{type(e).__name__}: {str(e)[:120]}"
    if resp.status_code >= 400:
        return f"HTTP {resp.status_code}"
    # Anywhere in the first 1KB, not only at byte 0: some APTEL files really
    # are served with a few hundred bytes of stray HTML before "%PDF" (a
    # fault in their upload, 2026-09-24), and PDF readers skip that prefix.
    if url.lower().split("?")[0].endswith(".pdf") and b"%PDF" not in head:
        kind = resp.headers.get("Content-Type", "?")
        return f"not a PDF (HTTP {resp.status_code}, {kind}, starts {head[:40]!r})"
    return None


def verify(path: str, sample: int, seed: int, fetch: bool) -> bool:
    with open(path, encoding="utf-8") as f:
        docs = json.load(f)
    ok = True
    print(f"\n=== {path}: {len(docs)} records")
    if not docs:
        print("  FAIL  file is empty")
        return False

    missing = [(i, [k for k in REQUIRED_FIELDS if k not in d]) for i, d in enumerate(docs)]
    missing = [(i, m) for i, m in missing if m]
    if missing:
        ok = False
        print(f"  FAIL  {len(missing)} records missing fields, e.g. #{missing[0][0]}: {missing[0][1]}")

    ids = [d.get("source_id") for d in docs]
    dupes = len(ids) - len(set(ids))
    if dupes:
        ok = False
        print(f"  FAIL  {dupes} duplicate source_id values")

    today = date.today().isoformat()
    bad_dates = [d for d in docs if d.get("published_date") and not ISO_DATE.match(d["published_date"])]
    future = [d for d in docs if d.get("published_date") and ISO_DATE.match(d["published_date"]) and d["published_date"] > today]
    no_title = [d for d in docs if not (d.get("title") or "").strip()]
    if bad_dates:
        ok = False
        print(f"  FAIL  {len(bad_dates)} non-ISO published_date values, e.g. {bad_dates[0]['published_date']!r}")
    if future:
        ok = False
        print(f"  FAIL  {len(future)} future published_date values, e.g. {future[0]['published_date']} {future[0]['title'][:60]!r}")
    if no_title:
        ok = False
        print(f"  FAIL  {len(no_title)} records with an empty title")

    dated = sum(1 for d in docs if d.get("published_date"))
    with_file = sum(1 for d in docs if d.get("file_url"))
    print(f"  info  dated {dated}/{len(docs)}, with file_url {with_file}/{len(docs)}")

    if fetch:
        picked = random.Random(seed).sample(docs, min(sample, len(docs)))
        failures = 0
        for d in picked:
            url = d.get("file_url") or d.get("source_url")
            reason = check_link(url) if url else "no file_url or source_url"
            mark = "ok  " if reason is None else "FAIL"
            failures += reason is not None
            print(f"  {mark}  {(d.get('published_date') or '----------')}  {d['title'][:55]:<55}  {reason or url[:70]}")
        print(f"  links {len(picked) - failures}/{len(picked)} reachable")
        if failures:
            ok = False
    return ok


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--sample", type=int, default=10)
    parser.add_argument("--seed", type=int, default=20260924)
    parser.add_argument("--no-fetch", action="store_true", help="skip the network link checks")
    args = parser.parse_args()
    results = [verify(p, args.sample, args.seed, not args.no_fetch) for p in args.paths]
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
