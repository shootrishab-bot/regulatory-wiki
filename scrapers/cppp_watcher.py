"""
CPPP (Central Public Procurement Portal) watcher -- eprocure.gov.in/cppp.

STATUS (2026-09-10): every endpoint and every limitation below was verified
against the real live portal during this build, not assumed from
CPPP_Tenders_Taxonomy_v1_0.xlsx's research notes.

WHAT IS OPENLY SCRAPABLE
------------------------
Four tender-listing feeds render server-side HTML tables with no CAPTCHA and
no session token, paginated through a base64-wrapped `url=` parameter (see
`_page_url` -- a plain `?page=N` is silently IGNORED and re-serves page 1,
which is exactly the kind of bug that produces a "successful" run of 2,600
identical pages, so it is asserted against in `scrape_listing`):

    latestactivetendersnew     ~2,635 pages  (~26,350 live tenders)
    latestactivecorrigendumsnew  ~254 pages  (~2,540 live corrigenda)
    highvaluetenders              ~45 pages
    globaltenders                 ~13 pages

Real columns, confirmed: e-Published Date, Bid Submission Closing Date,
Tender Opening Date, Title/Ref.No./Tender Id, Organisation Name, Corrigendum.

Nine institutional pages render small static tables of real, directly
downloadable PDFs (Office Memoranda, GFR/manuals, standard bidding documents,
help guides, the CPPP FAQ, the Debarment Manual, MSME and Make-in-India
orders, newsletters).

WHAT IS CAPTCHA-GATED -- CONFIRMED, NOT ASSUMED
-----------------------------------------------
This matters directly to the taxonomy, so it is recorded here rather than
quietly worked around:

a. `resultoftendersnew` (Award of Contract) and `cancelledtenders` are behind
   a Drupal CAPTCHA form (`captcha_sid` + `captcha_token` + `captcha_response`
   hidden fields confirmed in the real form markup). Its `aoc_status` select
   offers exactly two real values, "Published" and "CANCEL".
   => The taxonomy's `Award of Contract (AoC)` Instrument Type and its
      `Cancelled` / `Awarded / Closed` Status values are NOT reachable from
      the open portal. No AoC row in this scrape is real; there are none.

b. `tendersfullview/<token>` (a tender's detail page) is BOTH session-scoped
   and CAPTCHA-gated. The token embeds a unix timestamp (confirmed: the
   segment `MTc4OTAzMzk4OQ==` decodes to `1789033989`); replaying it later
   returns "Invalid Url.Please Check", and fetching it live inside the same
   session returns the CAPTCHA form instead of the tender.
   => The tender's own **Tender Category** field is unreachable. That is the
      single field CPPP itself uses to classify a tender as Goods / Services /
      Works, i.e. the exact ground truth the taxonomy's Subject facet is built
      on. Subject must therefore be inferred from the tender title and
      organisation name alone. See cppp-taxonomy-findings.md.

c. `corrigfullview/<token>` behaves the same way.
   => A corrigendum's real subtype (date change / cancellation / retender) is
      unreachable, and the taxonomy's first Tagging Guide rule depends on
      precisely that subtype.

d. Every `eprocure.gov.in/eprocure/app?page=...` GePNIC page (Bid Awards,
   Cancelled/Retendered, Tenders by Classification, Tenders in Archive) is
   also CAPTCHA-gated -- checked as an alternative route to (a) and (b), and
   it is not one.

Solving those CAPTCHAs is deliberately not attempted. The honest result is a
scrape that covers Tender Notices, Corrigenda and institutional content in
full, and covers Awards/Cancellations not at all.

VOLUME
------
The taxonomy's Schema Note calls CPPP an "extreme volume" source. Confirmed:
~26k *simultaneously live* tenders, with the listing showing only currently
open ones (nothing historical). Because a full 26k sweep is 2,635 sequential
requests for a corpus that turns over continuously, the default here is a
seeded RANDOM SAMPLE OF PAGES spread across the whole range rather than a
front-loaded first-N-pages crawl -- taking pages 1..N would bias the corpus
to whatever was published in the last few hours.

Output: scrapers/data/cppp_raw.json. cppp_adapter.py converts it to the
NormalizedDocument contract.

Run:
    python scrapers/cppp_watcher.py                        # default sample
    python scrapers/cppp_watcher.py --tender-pages 300     # wider sample
    python scrapers/cppp_watcher.py --all-tender-pages     # full 26k sweep
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any

import requests
from bs4 import BeautifulSoup

BASE = "https://eprocure.gov.in/cppp"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
OUT_PATH = os.path.join(DATA_DIR, "cppp_raw.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

REQUEST_TIMEOUT = 120
POLITE_DELAY = 0.5

# (slug, feed name, human section label, instrument hint, status hint)
# The status hints here are REAL, source-provided lifecycle facts, not model
# guesses: everything in `latestactivetendersnew` is by definition a currently
# live tender, and everything in `latestactivecorrigendumsnew` is a tender that
# has had a corrigendum issued against it. Both are the portal's own framing.
LISTING_FEEDS = [
    ("latestactivetendersnew", "active_tenders", "Latest Active Tenders", "Tender Notice (NIT)", "Live"),
    ("latestactivecorrigendumsnew", "active_corrigendums", "Active Corrigendums", "Corrigendum", "Corrigendum Issued"),
    ("highvaluetenders", "high_value_tenders", "High Value Tenders", "Tender Notice (NIT)", "Live"),
    ("globaltenders", "global_tenders", "Global Tenders", "Tender Notice (NIT)", "Live"),
]

# (slug, feed name, human section label, instrument hint)
# All institutional content. Per the taxonomy's own Tagging Guide rule 3, none
# of it carries a tender-lifecycle Status -- the adapter emits no status_hint
# for these, and the classifier is expected to reach "Not Applicable".
DOC_FEEDS = [
    ("instruction_display", "policy_central", "Procurement Policy O.M.s (Central)", "Circular / Office Memorandum"),
    ("state_instructionsdisp", "policy_state", "Procurement Policy O.M.s (State)", "Circular / Office Memorandum"),
    ("rulesandprocs", "rules_central", "Rules and Procedures (Central)", "Manual / Guidelines"),
    ("staterulesandprocs", "rules_state", "Rules and Procedures (State)", "Manual / Guidelines"),
    ("msme_order", "msme_order", "MSME Order", "Circular / Office Memorandum"),
    ("india_order", "india_order", "Make In India Order", "Circular / Office Memorandum"),
    ("standard_biddingdocs", "bidding_docs", "Standard Bidding Documents", "Manual / Guidelines"),
    ("helpdocdisp", "help_docs", "Help Documents", "Manual / Guidelines"),
    ("debarment_manual", "debarment_manual", "Debarment Manual", "Manual / Guidelines"),
    ("bank_docs", "bank_docs", "Multilateral Development Bank Certification", "Manual / Guidelines"),
    ("trainingdisp", "training", "Capacity Building", "Manual / Guidelines"),
    ("newsletterdisp", "newsletter", "Newsletter & Statistics", "Press Release"),
    ("faq", "faq", "FAQ", "FAQ"),
]

# Feeds whose real page count is discovered from the pager on page 1.
_PAGE_RE = re.compile(r"page=(\d+)")

# feed name -> pages the live pager advertised at scrape time. Populated by
# scrape_listing() and written to <out>.meta.json; see scrapers/build_cppp_sample.py.
DISCOVERED_PAGE_COUNTS: dict[str, int] = {}


class Blocked(Exception):
    """The site refused us (403/WAF/CAPTCHA) -- a first-class recorded outcome."""


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    # eprocure.gov.in's chain has repeatedly failed strict verification from
    # this project's machines; the same allowance lib/system-ca.ts makes on the
    # Node side. Content here is public and unauthenticated.
    s.verify = False
    return s


# REAL FAILURE OBSERVED AND FIXED (2026-09-10): the first full run of this
# scraper hit a transient LOCAL DNS outage ~130 pages in ("Failed to resolve
# 'eprocure.gov.in' [Errno 11001] getaddrinfo failed"). Because every network
# error was caught and logged per-feed, the run then failed every remaining
# page and every one of the 13 institutional feeds, wrote a corpus of
# 1,415 rows instead of ~4,600, and STILL EXITED 0 reporting success. A
# partial corpus that looks complete is worse than a crash -- it silently
# becomes the denominator of a taxonomy finding. Two fixes: retry transient
# network errors here with backoff, and (see main()) exit non-zero when a
# configured feed produced nothing at all.
_RETRY_DELAYS_S = (2, 5, 12)


def _get(session: requests.Session, url: str) -> requests.Response:
    last_exc: Exception | None = None
    for attempt in range(len(_RETRY_DELAYS_S) + 1):
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT)
            if resp.status_code in (401, 403, 429):
                # A real refusal, not a transient fault -- do not retry it.
                raise Blocked(f"HTTP {resp.status_code} for {url}")
            resp.raise_for_status()
            return resp
        except (requests.ConnectionError, requests.Timeout) as exc:
            last_exc = exc
            if attempt == len(_RETRY_DELAYS_S):
                break
            delay = _RETRY_DELAYS_S[attempt]
            print(f"    [retry] {url.rsplit('/', 1)[-1][:40]} ({type(exc).__name__}), waiting {delay}s", file=sys.stderr)
            time.sleep(delay)
    raise last_exc if last_exc else RuntimeError(f"unreachable: {url}")


def _sha1(*parts: str) -> str:
    return hashlib.sha1("||".join(p or "" for p in parts).encode("utf-8")).hexdigest()[:20]


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _page_url(slug: str, page: int) -> str:
    """CPPP paginates ONLY through a base64 of the real target URL passed as
    `url=`. `?page=N` on its own is accepted with HTTP 200 and silently serves
    page 1 -- verified live against page 500."""
    target = f"{BASE}/{slug}/cpppdata?page={page}"
    encoded = base64.b64encode(target.encode()).decode().rstrip("=")
    return f"{BASE}/{slug}/cpppdata?url={urllib.parse.quote(encoded)}"


def discover_page_count(session: requests.Session, slug: str) -> int:
    """Largest page number the pager on page 1 links to."""
    resp = _get(session, f"{BASE}/{slug}/cpppdata")
    soup = BeautifulSoup(resp.text, "lxml")
    largest = 1
    for a in soup.select("a[href]"):
        query = urllib.parse.urlparse(a["href"]).query
        raw = urllib.parse.parse_qs(query).get("url", [None])[0]
        if not raw:
            continue
        try:
            decoded = base64.b64decode(raw + "==").decode()
        except Exception:
            continue
        match = _PAGE_RE.search(decoded)
        if match:
            largest = max(largest, int(match.group(1)))
    return largest


_DATE_RE = re.compile(r"(\d{2})-([A-Za-z]{3})-(\d{4})")


def _iso_date(raw: str | None) -> str | None:
    """CPPP renders dates as '10-Sep-2026 03:10 PM'. Only the date part is
    kept -- SourceDocument.publishedDate is a date, and the time of day is not
    something any downstream query asks about."""
    if not raw:
        return None
    match = _DATE_RE.search(raw)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(0), "%d-%b-%Y").date().isoformat()
    except ValueError:
        return None


def parse_listing_page(html: str, feed: str, section: str, page_url: str,
                       instrument_hint: str, status_hint: str) -> list[dict[str, Any]]:
    """Parse one `table#table.list_table` listing page.

    The Title cell packs three real fields into one: an anchor holding the
    tender TITLE, followed by bare text `/<ref no>/<tender id>`. Splitting on
    the anchor boundary rather than on '/' is what keeps a title containing a
    slash (real and common: 'AMC/Maintenance of ...') intact.
    """
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id="table") or soup.find("table", class_="list_table")
    if table is None:
        return []

    rows: list[dict[str, Any]] = []
    for tr in table.find_all("tr")[1:]:
        cells = tr.find_all("td")
        if len(cells) < 6:
            continue

        published = _iso_date(cells[1].get_text(" ", strip=True))
        closing = _iso_date(cells[2].get_text(" ", strip=True))
        opening = _iso_date(cells[3].get_text(" ", strip=True))

        title_cell = cells[4]
        anchor = title_cell.find("a")
        title = _clean(anchor.get_text(" ", strip=True)) if anchor else ""
        remainder = _clean(title_cell.get_text(" ", strip=True))
        if title and remainder.startswith(title):
            remainder = remainder[len(title):]
        ref_parts = [p for p in remainder.strip("/ ").split("/") if p.strip()]
        # Only the LAST segment is the Tender Id; everything before it is the
        # reference number, which itself often contains slashes.
        tender_id = _clean(ref_parts[-1]) if ref_parts else ""
        ref_no = _clean("/".join(ref_parts[:-1])) if len(ref_parts) > 1 else ""
        if not title:
            title = _clean(title_cell.get_text(" ", strip=True))

        organisation = _clean(cells[5].get_text(" ", strip=True))
        detail_url = anchor["href"] if anchor and anchor.get("href") else ""

        if not title:
            continue

        rows.append(
            {
                "feed": feed,
                "section": section,
                "source_url": page_url,
                "detail_url": detail_url,
                "title": title,
                "ref_no": ref_no,
                "tender_id": tender_id,
                "organisation": organisation,
                "published_date": published,
                "closing_date": closing,
                "opening_date": opening,
                "instrument_hint": instrument_hint,
                "status_hint": status_hint,
                # A tender id is CPPP's own stable identity for the tender; the
                # feed is part of the key because the same tender legitimately
                # appears in both the tenders and corrigenda feeds as two
                # different documents in its lifecycle.
                "source_id": _sha1(feed, tender_id or f"{ref_no}|{title}|{organisation}"),
            }
        )
    return rows


def scrape_listing(
    session: requests.Session,
    slug: str,
    feed: str,
    section: str,
    instrument_hint: str,
    status_hint: str,
    max_pages: int | None,
    rng: random.Random,
) -> list[dict[str, Any]]:
    total_pages = discover_page_count(session, slug)
    # Recorded so downstream sampling can weight by each feed's REAL live
    # population rather than by how much of it this run happened to fetch.
    # Written to the sidecar metadata file, never hardcoded downstream: the
    # counts move daily (active_corrigendums was 249 pages one hour and 259 the
    # next, mid-run), so a copied constant would silently go stale.
    DISCOVERED_PAGE_COUNTS[feed] = total_pages
    if max_pages is None or max_pages >= total_pages:
        pages = list(range(1, total_pages + 1))
    else:
        # Seeded random sample across the WHOLE range (page 1 always included
        # so a run is comparable against the live front page), sorted so the
        # request order stays monotonic and easy to follow in a log.
        pages = sorted({1, *rng.sample(range(1, total_pages + 1), max_pages - 1)})

    print(f"[cppp] {feed}: {total_pages} pages available, fetching {len(pages)}")
    rows: list[dict[str, Any]] = []
    first_page_ids: set[str] | None = None

    for index, page in enumerate(pages, start=1):
        url = _page_url(slug, page)
        try:
            resp = _get(session, url)
        except (Blocked, requests.RequestException) as exc:
            print(f"    [warn] {feed} page {page}: {exc}", file=sys.stderr)
            continue
        page_rows = parse_listing_page(resp.text, feed, section, url, instrument_hint, status_hint)

        # Guard against the silent-pagination failure described in the module
        # docstring: if a later page returns exactly page 1's rows again, the
        # pagination contract has changed and the run must not be reported as
        # a success.
        ids = {r["source_id"] for r in page_rows}
        if first_page_ids is None:
            first_page_ids = ids
        elif page != 1 and ids and ids == first_page_ids:
            raise RuntimeError(
                f"{feed}: page {page} returned the same rows as page 1 -- CPPP's "
                f"base64 `url=` pagination contract has changed, refusing to "
                f"report a bogus corpus."
            )

        rows.extend(page_rows)
        if index % 25 == 0:
            print(f"    ... {index}/{len(pages)} pages, {len(rows)} rows")
        time.sleep(POLITE_DELAY)

    return rows


# ---------------------------------------------------------------------------
# Institutional document pages
# ---------------------------------------------------------------------------
_DOC_HEADER_ALIASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^s\.?\s*no\.?$"), "serial"),
    (re.compile(r"^(subject|title)$"), "title"),
    (re.compile(r"^issued\s*by$"), "issued_by"),
    (re.compile(r"^issued\s*date$|^date$"), "date"),
    (re.compile(r"^language$"), "language"),
    (re.compile(r"^file\s*type$"), "file_type"),
    (re.compile(r"^size$"), "size"),
    (re.compile(r"^download"), "download"),
]

_DOC_DATE_FORMATS = ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y")


def _doc_date(raw: str) -> str | None:
    raw = _clean(raw)
    if not raw or raw == "-":
        return None
    for fmt in _DOC_DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


_EXTENSION_RE = re.compile(r"^(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|txt|csv)$", re.I)


def _extension_hint(raw: str | None) -> str | None:
    value = _clean(raw).lower()
    return value if _EXTENSION_RE.match(value) else None


def parse_doc_page(html: str, feed: str, section: str, page_url: str, instrument_hint: str) -> list[dict[str, Any]]:
    """Institutional pages use one shared 8-column shape across all 13 feeds,
    but split it into several sibling tables (rulesandprocs renders 4 of them,
    one per category) and repeat the header row inside each -- so every table
    is parsed independently rather than assuming one table per page."""
    soup = BeautifulSoup(html, "lxml")
    rows: list[dict[str, Any]] = []

    for table in soup.find_all("table"):
        all_tr = table.find_all("tr")
        if len(all_tr) < 2:
            continue
        header = [_clean(c.get_text(" ", strip=True)).lower() for c in all_tr[0].find_all(["th", "td"])]
        columns: dict[int, str] = {}
        for idx, label in enumerate(header):
            for pattern, name in _DOC_HEADER_ALIASES:
                if pattern.search(label):
                    columns.setdefault(idx, name)
                    break
        if "title" not in columns.values():
            continue

        for tr in all_tr[1:]:
            cells = tr.find_all("td")
            if not cells:
                continue
            values = {columns[i]: _clean(c.get_text(" ", strip=True)) for i, c in enumerate(cells) if i in columns}
            title = values.get("title", "")
            if not title:
                continue

            file_url = ""
            for a in tr.find_all("a", href=True):
                href = a["href"].strip()
                if href.startswith("/"):
                    href = "https://eprocure.gov.in" + href
                if href.startswith("http"):
                    file_url = href
                    break

            rows.append(
                {
                    "feed": feed,
                    "section": section,
                    "source_url": page_url,
                    "detail_url": "",
                    "title": title,
                    "ref_no": "",
                    "tender_id": "",
                    "organisation": values.get("issued_by", ""),
                    "published_date": _doc_date(values.get("date", "")),
                    "closing_date": None,
                    "opening_date": None,
                    "file_url": file_url or None,
                    # The File Type cell is not always a file type: rows whose
                    # "file" is really an outbound link to another ministry's
                    # site (real: "All Procurement Policy O.Ms Link" ->
                    # doe.gov.in) render a link glyph there instead. Keep only
                    # values that actually look like an extension.
                    "file_extension_hint": _extension_hint(values.get("file_type")),
                    "instrument_hint": instrument_hint,
                    # Deliberately no status_hint: institutional content has no
                    # tender lifecycle (taxonomy Tagging Guide rule 3).
                    "status_hint": "",
                    "source_id": _sha1(feed, file_url or title, values.get("issued_by", "")),
                }
            )
    return rows


def scrape_doc_feeds(session: requests.Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for slug, feed, section, instrument_hint in DOC_FEEDS:
        url = f"{BASE}/{slug}"
        print(f"[cppp] doc feed {feed} ({slug}) ...")
        try:
            resp = _get(session, url)
        except (Blocked, requests.RequestException) as exc:
            print(f"    [error] {feed}: {exc}", file=sys.stderr)
            continue
        page_rows = parse_doc_page(resp.text, feed, section, url, instrument_hint)
        print(f"  -> {len(page_rows)} rows")
        rows.extend(page_rows)
        time.sleep(POLITE_DELAY)
    return rows


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def scrape(tender_pages: int | None, seed: int, skip_listings: bool = False) -> list[dict[str, Any]]:
    session = _session()
    rng = random.Random(seed)
    scraped_at = datetime.now(timezone.utc).isoformat()
    all_rows: list[dict[str, Any]] = []

    if not skip_listings:
        for slug, feed, section, instrument_hint, status_hint in LISTING_FEEDS:
            try:
                all_rows.extend(
                    scrape_listing(
                        session, slug, feed, section, instrument_hint, status_hint, tender_pages, rng
                    )
                )
            except (Blocked, requests.RequestException) as exc:
                print(f"  [error] {feed}: {exc}", file=sys.stderr)

    all_rows.extend(scrape_doc_feeds(session))

    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for row in all_rows:
        if row["source_id"] in seen:
            continue
        seen.add(row["source_id"])
        row.setdefault("file_url", None)
        row.setdefault("file_extension_hint", None)
        row["scraped_at"] = scraped_at
        deduped.append(row)

    dropped = len(all_rows) - len(deduped)
    if dropped:
        print(f"[cppp] dropped {dropped} duplicate rows")
    return deduped


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape eprocure.gov.in/cppp")
    parser.add_argument(
        "--tender-pages",
        type=int,
        default=200,
        help="pages to sample per listing feed (default 200; see --all-tender-pages)",
    )
    parser.add_argument("--all-tender-pages", action="store_true", help="fetch every page of every listing feed")
    parser.add_argument("--skip-listings", action="store_true", help="institutional document feeds only")
    parser.add_argument("--seed", type=int, default=20260910, help="seed for the page sample")
    parser.add_argument("--out", default=OUT_PATH)
    args = parser.parse_args()

    try:
        rows = scrape(
            tender_pages=None if args.all_tender_pages else args.tender_pages,
            seed=args.seed,
            skip_listings=args.skip_listings,
        )
    except Blocked as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2, ensure_ascii=False)

    scraped_per_feed: dict[str, int] = {}
    for row in rows:
        scraped_per_feed[row["feed"]] = scraped_per_feed.get(row["feed"], 0) + 1
    meta_path = args.out.rsplit(".json", 1)[0] + ".meta.json"
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "scraped_at": rows[0]["scraped_at"] if rows else None,
                "rows_per_page": 10,
                "live_page_counts": DISCOVERED_PAGE_COUNTS,
                "scraped_rows_per_feed": scraped_per_feed,
                "tender_pages_requested": None if args.all_tender_pages else args.tender_pages,
                "seed": args.seed,
            },
            fh,
            indent=2,
        )
    print(f"[cppp] wrote scrape metadata to {meta_path}")

    by_feed: dict[str, int] = {}
    for row in rows:
        by_feed[row["feed"]] = by_feed.get(row["feed"], 0) + 1
    print(f"\n[cppp] wrote {len(rows)} rows to {args.out}")
    for feed, count in sorted(by_feed.items(), key=lambda kv: -kv[1]):
        print(f"   {count:6d}  {feed}")

    # Every configured feed is known to return rows (all 17 verified live), so
    # an empty one means this run degraded, not that the feed is empty. Say so
    # in the exit code -- see the comment on _get() for the run that made this
    # necessary.
    expected = {feed for _, feed, _, _ in DOC_FEEDS}
    if not args.skip_listings:
        expected |= {feed for _, feed, _, _, _ in LISTING_FEEDS}
    missing = sorted(expected - set(by_feed))
    if missing:
        print(
            f"\n[cppp] INCOMPLETE RUN -- {len(missing)} feed(s) produced no rows: "
            f"{', '.join(missing)}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    import urllib3

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    raise SystemExit(main())
