"""EPFO watcher entrypoint.

REWRITTEN 2026-09-09 -- EPFO migrated its entire website and the old scraper
was silently dead.

What changed on the real site (all verified directly, not assumed):
  * The apex host `epfindia.gov.in` no longer accepts TCP connections at all
    (port 443 AND port 80 both time out; `www.epfindia.gov.in` answers and
    301-redirects to `www.epfo.gov.in`).
  * The two pages this watcher used to scrape --
    `epfindia.gov.in/site_en/Updates.php` and `/site_en/circulars.php` --
    both return HTTP 404 on the new site. So do the ~450 individual
    `site_docs/PDFs/...` document URLs the previous run captured: EPFO did
    not just move the listing, it re-hosted every document under a
    WordPress CDN (`pmvbry-cdn.epfindia.gov.in/wp-content/uploads/YYYY/MM/`)
    with entirely different filenames. There is no URL-rewrite rule that
    recovers the old links, which is why this is a re-scrape rather than a
    find-and-replace over the existing epfo_master.csv.
  * The replacement listing, `https://www.epfo.gov.in/circulars/`, carries
    1,884 real document cards on a SINGLE server-rendered page with no
    pagination -- roughly 4x what the old two-page setup yielded.

Why this no longer goes through labour_scrape.py/labour_watcher_common.py
like its ESIC and CLC siblings: those drive Playwright, which the shared
SOURCES config needs because ESIC's and CLC's listings are paginated and
JS-driven. EPFO's new page is plain server-rendered HTML -- a single
`requests` GET returns all 1,884 cards -- so a browser would be pure
overhead. This module therefore does its own fetch and parse, but
deliberately reuses everything else the labour family already standardises:
`labour_scrape.is_blocked()` for WAF detection, `labour_parser`'s
`infer_document_type`/`infer_labour_code`, and
`labour_watcher_common.write_master_csv()` for the exact same CSV contract
(`CSV_FIELDS`), so `run_epfo_adapter.py` and lib/sync.ts both keep working
unchanged.

The stale `epfo_updates`/`epfo_circulars` entries in labour_scrape.py's
SOURCES dict are left in place but marked dead in their own comments -- they
are no longer referenced from here.

Output: data/epfo_master.csv (unchanged path and columns).
"""

import re
import sys
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

import labour_parser as lp
import labour_scrape as ls
from labour_watcher_common import write_master_csv

CIRCULARS_URL = "https://www.epfo.gov.in/circulars/"
# The second real document listing on the new site, found from the homepage's
# own nav (a passive, standard lookup -- no evasion). Smaller and structurally
# DIFFERENT from /circulars/: it renders `div.pdf-card` with an `h5.pdf-title`
# and carries no date metadata at all, rather than /circulars/'s
# `div.download-box` + `.meta-row`. Hence two parsers rather than one shared
# selector -- see parse_archives().
#
# Its 24 documents are real regulatory content, not marketing collateral:
# ABRY scheme guidelines and their amendments, the gazette notification
# reducing the statutory EPF contribution rate from 12% to 10%, and the
# associated statutory FAQs.
ARCHIVES_URL = "https://www.epfo.gov.in/archives/"
OUTPUT_CSV = "data/epfo_master.csv"

REGULATOR = "EPFO"
REGULATOR_FULL = "Employees' Provident Fund Organisation"
DOMAIN = "employment_law"

# The site's own placeholder for a card whose PDF was never attached. 14 of
# the 1,884 real cards carry it. It is a real EPFO-side data gap, not a
# parse failure, so these are skipped with a count rather than silently
# dropped or written as documents with an unusable file_url.
DEAD_HREF = "http://false"

REQUEST_TIMEOUT = 60
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
}


def _parse_card_date(card) -> str | None:
    """EPFO renders the date as a bare DD/MM/YYYY `.meta-item`, alongside a
    non-date `.meta-item` holding the issuing division (e.g. "C&PR"), so the
    date is identified by shape rather than by position.

    199 of the 1,884 real cards genuinely carry no date at all (their
    `.meta-row` is empty and their own `data-year`/`data-month` attributes
    are empty strings too). That is real missing source metadata, not a
    parse failure -- returning None here lets lib/ingest.ts store a null
    publishedDate, which it already handles. Note it does NOT set the
    unparseable_published_date review flag, and shouldn't: that flag means
    "the source gave us a date we couldn't read", which is a different and
    more suspicious condition than "the source has no date".
    """
    for meta in card.select(".meta-item"):
        text = meta.get_text(" ", strip=True)
        if re.fullmatch(r"\d{2}/\d{2}/\d{4}", text):
            day, month, year = text.split("/")
            try:
                return datetime(int(year), int(month), int(day)).strftime("%Y-%m-%d")
            except ValueError:
                # A real but impossible date (e.g. 31/02/2020). Fall through
                # to the next meta-item rather than crashing the whole run.
                continue
    return None


def _parse_division(card) -> str | None:
    """The issuing division ("Pension", "Legal", "HRD", ...). Preferred from
    the card's own data-division attribute; falls back to the first non-date
    meta-item, since the attribute is empty on the same 199 undated cards."""
    division = (card.get("data-division") or "").strip()
    if division:
        return division
    for meta in card.select(".meta-item"):
        text = meta.get_text(" ", strip=True)
        if text and not re.fullmatch(r"\d{2}/\d{2}/\d{4}", text):
            return text
    return None


def parse_circulars(html: str) -> list[dict]:
    """Parses EPFO's real circulars listing into the shared labour CSV row
    shape. One `div.download-box` per real document."""
    soup = BeautifulSoup(html, "lxml")
    cards = soup.find_all("div", class_="download-box")
    scraped_at = datetime.now(timezone.utc).astimezone().isoformat()

    documents: list[dict] = []
    skipped_dead = 0
    skipped_no_title = 0
    seen_urls: set[str] = set()

    for card in cards:
        anchor = card.find("a", href=True)
        href = anchor["href"].strip() if anchor else ""
        if not href or href == DEAD_HREF:
            skipped_dead += 1
            continue

        title_el = card.select_one(".download-title")
        title = title_el.get_text(" ", strip=True) if title_el else ""
        if not title:
            skipped_no_title += 1
            continue

        # Same discipline as run_epfo_adapter.py's own duplicate check:
        # source_url is the dedup key for this family, because
        # labour_adapter.py derives source_id from it.
        if href in seen_urls:
            continue
        seen_urls.add(href)

        documents.append(
            {
                "title": title,
                "published_date": _parse_card_date(card),
                "source_url": href,
                "file_size": None,
                "regulator": REGULATOR,
                "regulator_full": REGULATOR_FULL,
                "domain": DOMAIN,
                "document_type": lp.infer_document_type(title),
                "labour_codes": lp.infer_labour_code(title),
                "state": "central",
                "scraped_at": scraped_at,
                # Not part of CSV_FIELDS (write_master_csv uses
                # extrasaction="ignore"), kept for the run summary below.
                "_division": _parse_division(card),
            }
        )

    print(
        f"[epfo_circulars] {len(cards)} cards on page -> {len(documents)} real documents "
        f"({skipped_dead} skipped: no/dead PDF link, {skipped_no_title} skipped: no title)",
        file=sys.stderr,
    )
    return documents


def parse_archives(html: str) -> list[dict]:
    """Parses EPFO's real /archives/ listing. Same output row shape as
    parse_circulars(), different markup: `div.pdf-card` holding an
    `h5.pdf-title` and an `a.pdf-link`.

    Every card here genuinely lacks a date -- there is no `.meta-row`, no
    data-year/data-month, nothing. Several titles embed one in prose
    ("(Amended 02-07-2021)", "(dated 12 May 2020)"), but those are NOT parsed
    into published_date: a date appearing inside a title is frequently the
    date of the thing being amended rather than of this document, and
    guessing wrong writes a plausible-looking but false date that nothing
    downstream would ever flag. Left null instead, which
    scripts/backfill-missing-dates.ts can later fill from the real PDF
    content -- the same treatment every other undated document in this
    corpus gets.
    """
    soup = BeautifulSoup(html, "lxml")
    cards = soup.select("div.pdf-card")
    scraped_at = datetime.now(timezone.utc).astimezone().isoformat()

    documents: list[dict] = []
    skipped = 0
    seen_urls: set[str] = set()

    for card in cards:
        anchor = card.select_one("a.pdf-link[href]")
        title_el = card.select_one(".pdf-title")
        href = anchor["href"].strip() if anchor else ""
        title = title_el.get_text(" ", strip=True) if title_el else ""
        if not href or href == DEAD_HREF or not title or href in seen_urls:
            skipped += 1
            continue
        seen_urls.add(href)

        documents.append(
            {
                "title": title,
                "published_date": None,
                "source_url": href,
                "file_size": None,
                "regulator": REGULATOR,
                "regulator_full": REGULATOR_FULL,
                "domain": DOMAIN,
                "document_type": lp.infer_document_type(title),
                "labour_codes": lp.infer_labour_code(title),
                "state": "central",
                "scraped_at": scraped_at,
            }
        )

    print(
        f"[epfo_archives] {len(cards)} cards on page -> {len(documents)} real documents "
        f"({skipped} skipped: no/dead PDF link, no title, or duplicate)",
        file=sys.stderr,
    )
    return documents


def _fetch(url: str, label: str) -> str | None:
    """One GET with the labour family's shared block handling. Returns the
    HTML, or None after printing the appropriate marker."""
    try:
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        print(f"[FAILED] {label}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return None

    if response.status_code != 200:
        blocked, reason = ls.is_blocked(response.status_code, response.text)
        marker = "[BLOCKED]" if blocked else "[FAILED]"
        print(
            f"{marker} {label}: HTTP {response.status_code}"
            f"{' -- ' + reason if blocked else ''}",
            file=sys.stderr,
        )
        return None

    return response.text


def main() -> int:
    print(f"Scraping EPFO ({CIRCULARS_URL}, {ARCHIVES_URL}) ...", file=sys.stderr)

    # /circulars/ is the primary listing and the one this watcher exists for.
    # A failure there is fatal for the run.
    circulars_html = _fetch(CIRCULARS_URL, "epfo_circulars")
    if circulars_html is None:
        return 1

    documents = parse_circulars(circulars_html)

    # Block detection runs only when the parse came back EMPTY, which is the
    # only case where the two outcomes are actually confusable. Running it
    # eagerly on every 200 was tried first and is wrong here:
    # labour_scrape.BLOCK_SIGNATURES matches the bare substring "cloudflare"
    # anywhere in the first 5KB, and EPFO's real page loads Font Awesome from
    # cdnjs.cloudflare.com in its <head> -- so a perfectly good 200 carrying
    # all 1,884 real documents was reported as "[BLOCKED] Block signature:
    # 'cloudflare'". A page that yields real document cards is by definition
    # not a WAF interstitial, so parsing first removes the false positive
    # without weakening real detection: a genuine block yields no cards and
    # still lands here, still printing the "[BLOCKED]" marker lib/sync.ts
    # greps for on EPFO. The shared is_blocked() is deliberately left
    # untouched -- ESIC and CLC depend on its current behavior.
    if not documents:
        blocked, reason = ls.is_blocked(200, circulars_html)
        if blocked:
            print(f"[BLOCKED] epfo_circulars: {reason}", file=sys.stderr)
        else:
            print(
                "[FAILED] epfo_circulars: page fetched cleanly and shows no block "
                "signature, but yielded 0 documents -- the site's markup has "
                "probably changed again; re-check div.download-box before "
                "trusting a zero here.",
                file=sys.stderr,
            )
        return 1

    # /archives/ is supplementary (24 documents against /circulars/'s ~1,868).
    # A failure there is reported but NOT fatal: losing the ABRY archive is
    # not a reason to throw away a good primary scrape, and writing a CSV
    # missing 1,868 rows would look to lib/sync.ts like EPFO genuinely lost
    # its corpus.
    archives_html = _fetch(ARCHIVES_URL, "epfo_archives")
    if archives_html is None:
        print(
            "[WARN] epfo_archives unavailable this run -- continuing with "
            "circulars only.",
            file=sys.stderr,
        )
    else:
        seen = {d["source_url"] for d in documents}
        for doc in parse_archives(archives_html):
            if doc["source_url"] not in seen:
                seen.add(doc["source_url"])
                documents.append(doc)

    write_master_csv(OUTPUT_CSV, documents)

    dated = sum(1 for d in documents if d["published_date"])
    print(f"Wrote {len(documents)} documents to {OUTPUT_CSV}", file=sys.stderr)
    print(f"  with published_date: {dated}", file=sys.stderr)
    print(f"  without:             {len(documents) - dated}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
