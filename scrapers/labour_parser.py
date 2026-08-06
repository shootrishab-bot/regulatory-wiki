"""
Labour Law HTML Parsers
Every parser validates its own selectors against real HTML before returning data.
"""

import json
import re
import sys
from datetime import datetime
from functools import partial
from urllib.parse import urljoin
from bs4 import BeautifulSoup


# --- Validation: minimum confidence to trust parser output ---
MIN_DOCUMENTS_EXPECTED = 1  # At least 1 doc or we flag as unverified


def parse_date(date_str: str):
    """Parse various Indian date formats into ISO 8601."""
    if not date_str:
        return None
    
    date_str = date_str.strip().replace(",", "")
    formats = [
        "%d.%m.%Y",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d %B %Y",
        "%d %b %Y",
        "%B %d %Y",
        "%Y-%m-%d",
    ]
    
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).date().isoformat()
        except ValueError:
            continue
    
    match = re.search(r'(\d{1,2})[./-](\d{1,2})[./-](\d{4})', date_str)
    if match:
        d, m, y = match.groups()
        try:
            return datetime(int(y), int(m), int(d)).date().isoformat()
        except ValueError:
            pass
    
    return None


def infer_document_type(title: str):
    lower = title.lower()
    if "draft" in lower and "rule" in lower:
        return "draft_rule"
    if "draft" in lower:
        return "draft"
    if "gazette" in lower:
        return "gazette_notification"
    if "corrigendum" in lower:
        return "corrigendum"
    if "circular" in lower:
        return "circular"
    if "notification" in lower:
        return "notification"
    if "order" in lower:
        return "order"
    if "press release" in lower or "press note" in lower:
        return "press_release"
    if "guideline" in lower:
        return "guideline"
    if "amendment" in lower:
        return "amendment"
    return "other"


def infer_labour_code(title: str):
    lower = title.lower()
    codes = []
    
    wage_keywords = ["wage", "minimum wage", "bonus", "equal remuneration"]
    ss_keywords = ["epf", "provident fund", "esi", "employees state insurance",
                   "gratuity", "maternity benefit", "social security", "pension"]
    ir_keywords = ["industrial relation", "trade union", "strike", "lockout",
                   "layoff", "retrenchment", "closure", "standing order", "tribunal"]
    osh_keywords = ["occupational safety", "osh", "factory", "mine", "dock",
                    "building worker", "hazardous", "safety", "health"]
    
    if any(k in lower for k in wage_keywords):
        codes.append("code_on_wages")
    if any(k in lower for k in ss_keywords):
        codes.append("social_security_code")
    if any(k in lower for k in ir_keywords):
        codes.append("industrial_relations_code")
    if any(k in lower for k in osh_keywords):
        codes.append("osh_code")
    
    return codes if codes else ["other"]


def validate_parser_result(documents: list, source_key: str, html: str) -> dict:
    """
    Wrap parser output with validation metadata.
    Flags if parser produced suspiciously few results.
    """
    validation = {
        "source_key": source_key,
        "document_count": len(documents),
        "validated": False,
        "validation_issue": None,
        "html_length": len(html),
        "has_tables": bool(BeautifulSoup(html, "html.parser").find_all("table")),
        "has_links": bool(BeautifulSoup(html, "html.parser").find_all("a", href=True)),
    }
    
    if len(documents) < MIN_DOCUMENTS_EXPECTED:
        validation["validation_issue"] = (
            f"Parser produced {len(documents)} documents; "
            f"expected at least {MIN_DOCUMENTS_EXPECTED}. "
            f"Selectors likely need adjustment for this page structure."
        )
    elif len(documents) > 0:
        # Basic sanity check: do documents have required fields?
        sample = documents[0]
        missing = [f for f in ["title", "source_url"] if not sample.get(f)]
        # Real bug found and fixed 2026-08-06 (parse_clc): a wrong column
        # index made every row's title come out as its own serial number
        # ("1", "2", "3"...) and its source_url silently fall back to the
        # LISTING page's own URL (base_url) instead of a real per-document
        # link. Both title and source_url were non-empty, so the check
        # above alone did not catch it -- "validated: True" was reported
        # for completely wrong data. This check catches that failure mode
        # even if a future column-index bug reintroduces it: if most real
        # rows resolve to the exact same source_url, that is not a real
        # site with 90% duplicate links, it is a parser reading the wrong
        # cell.
        url_counts = {}
        for d in documents:
            u = d.get("source_url")
            url_counts[u] = url_counts.get(u, 0) + 1
        dominant_url, dominant_count = max(url_counts.items(), key=lambda kv: kv[1])
        suspicious_duplicate_urls = (
            len(documents) >= 3 and dominant_count / len(documents) > 0.5
        )

        if missing:
            validation["validation_issue"] = (
                f"Parsed documents missing required fields: {missing}. "
                f"Selector extraction is broken."
            )
        elif suspicious_duplicate_urls:
            validation["validation_issue"] = (
                f"{dominant_count}/{len(documents)} documents resolved to the "
                f"identical source_url ('{dominant_url}'). This almost always "
                f"means the real per-row link column was not found and the "
                f"parser silently fell back to the listing page's own URL -- "
                f"same failure mode as the real parse_clc() bug found "
                f"2026-08-06. Treating as unvalidated rather than trusting it."
            )
        else:
            validation["validated"] = True
    
    return {
        "documents": documents,
        "validation": validation,
    }


# --- Parsers ---

def parse_mole_gazette(html: str, base_url: str):
    """
    Parse MoLE Gazette Notifications.
    VALIDATED: No -- requires real HTML sample to confirm selectors.
    """
    soup = BeautifulSoup(html, "html.parser")
    documents = []
    
    tables = soup.find_all("table")
    
    for table in tables:
        rows = table.find_all("tr")
        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            
            title_cell = cells[0]
            link_tag = title_cell.find("a")
            title = title_cell.get_text(strip=True)
            doc_url = link_tag["href"] if link_tag and link_tag.get("href") else None
            
            date_text = cells[1].get_text(strip=True) if len(cells) > 1 else ""
            size_text = cells[2].get_text(strip=True) if len(cells) > 2 else ""
            
            if not title or not doc_url:
                continue
            
            documents.append({
                "title": title,
                "published_date": parse_date(date_text),
                "source_url": urljoin(base_url, doc_url),
                "file_size": size_text,
                "regulator": "MoLE",
                "regulator_full": "Ministry of Labour and Employment",
                "domain": "employment_law",
                "document_type": infer_document_type(title),
                "labour_codes": infer_labour_code(title),
                "state": "central",
                "scraped_at": datetime.utcnow().isoformat(),
            })
    
    return validate_parser_result(documents, "mole_gazette", html)


def parse_mole_whatsnew(html: str, base_url: str):
    """
    Parse MoLE 'What's New' section.
    VALIDATED: No -- page structure unknown, likely different from gazette table.
    """
    soup = BeautifulSoup(html, "html.parser")
    documents = []
    
    # What's New is often a list/div structure, not a table
    # Try multiple strategies
    
    # Strategy 1: Drupal view rows
    view_content = soup.find("div", class_=re.compile("view-content|view-whats-new"))
    if view_content:
        for row in view_content.find_all("div", class_=re.compile("views-row|node")):
            title_tag = row.find("a") or row.find(["h2", "h3", "h4", "span"])
            if not title_tag:
                continue
            
            title = title_tag.get_text(strip=True)
            doc_url = title_tag["href"] if title_tag.name == "a" and title_tag.get("href") else None
            
            # Date often in a separate span or nearby text
            date_tag = row.find("span", class_=re.compile("date|created|posted"))
            date_text = date_tag.get_text(strip=True) if date_tag else ""
            
            if title:
                documents.append({
                    "title": title,
                    "published_date": parse_date(date_text),
                    "source_url": urljoin(base_url, doc_url) if doc_url else base_url,
                    "file_size": "",
                    "regulator": "MoLE",
                    "regulator_full": "Ministry of Labour and Employment",
                    "domain": "employment_law",
                    "document_type": infer_document_type(title),
                    "labour_codes": infer_labour_code(title),
                    "state": "central",
                    "scraped_at": datetime.utcnow().isoformat(),
                })
    
    # Strategy 2: UL/LI lists
    if not documents:
        for ul in soup.find_all("ul", class_=re.compile("whats-new|menu|list")):
            for li in ul.find_all("li"):
                link = li.find("a")
                if not link:
                    continue
                
                title = link.get_text(strip=True)
                doc_url = link.get("href", "")
                
                # Try to extract date from li text
                li_text = li.get_text(strip=True)
                date_match = re.search(r'(\d{1,2}[./-]\d{1,2}[./-]\d{4})', li_text)
                date_text = date_match.group(1) if date_match else ""
                
                if title:
                    documents.append({
                        "title": title,
                        "published_date": parse_date(date_text),
                        "source_url": urljoin(base_url, doc_url),
                        "file_size": "",
                        "regulator": "MoLE",
                        "regulator_full": "Ministry of Labour and Employment",
                        "domain": "employment_law",
                        "document_type": infer_document_type(title),
                        "labour_codes": infer_labour_code(title),
                        "state": "central",
                        "scraped_at": datetime.utcnow().isoformat(),
                    })
    
    return validate_parser_result(documents, "mole_whatsnew", html)


def parse_epfo_updates(html: str, base_url: str):
    """
    Parse EPFO Updates page (site_en/Updates.php).

    VALIDATED: Yes -- confirmed against real live HTML 2026-08-06.

    REAL STRUCTURE (confirmed, not the structure this parser used to
    assume): a single table, ONE real page, no pagination (742 real <tr>
    elements checked directly for pager/pagination/"page=" markers --
    none found). Each real document is TWO rows:
      row N:   <td>{serial number}</td><td>{title}... <a aria-label="{title}"
                href="...">Read</a></td>
      row N+1: <td colspan="2">.......(visual dot separator, no data)</td>

    The dot-separator rows are already correctly skipped by the
    `len(cells) < 2` check. The real bug was the OTHER column: the old
    shared parse_epfo() read title/link from cells[0], which is only ever
    the serial number and never has a link -- doc_url was always None, and
    `if not title or not doc_url: continue` silently discarded every real
    row. Confirmed: this produced ZERO documents from a real page
    containing 371 real entries.

    The <a> tag's own `aria-label` carries the exact real title without
    the trailing "Read" link text, so it is used in preference to the
    cell's raw text (which would otherwise need "Read" stripped off the
    end unreliably).

    There is no separate real date column on this page -- dates that
    appear are embedded loosely in title text (e.g. "...July, 2026") and
    are not reliably a single clean date. published_date is left None
    here rather than guessing from partial text.
    """
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    tables = soup.find_all("table")
    for table in tables:
        for row in table.find_all("tr")[1:]:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue  # real dot-separator row, not a document

            title_cell = cells[1]
            link_tag = title_cell.find("a")
            if not link_tag or not link_tag.get("href"):
                continue

            # Real, confirmed 2026-08-06: at least one real EPFO title
            # contains its own literal double-quote character (a title
            # quoting another document's name), which breaks out of the
            # double-quoted aria-label attribute on the site's own page and
            # truncates it mid-word (a real row's aria-label came through
            # as just "Employees" instead of the real ~200-character
            # title). Not a parser bug -- the source HTML is malformed.
            # Guarded by preferring the cell's own visible text whenever
            # aria-label looks implausibly short relative to it, rather
            # than trusting aria-label unconditionally.
            cell_text = title_cell.get_text(" ", strip=True)
            aria_label = link_tag.get("aria-label")
            if aria_label and len(aria_label) >= 0.5 * len(cell_text):
                title = aria_label
            else:
                title = cell_text
            title = re.sub(r"\s*Read\s*$", "", title).strip()
            doc_url = link_tag["href"]

            if not title:
                continue

            documents.append({
                "title": title,
                "published_date": None,
                "source_url": urljoin(base_url, doc_url),
                "file_size": "",
                "regulator": "EPFO",
                "regulator_full": "Employees' Provident Fund Organisation",
                "domain": "employment_law",
                "document_type": infer_document_type(title),
                "labour_codes": infer_labour_code(title),
                "state": "central",
                "scraped_at": datetime.utcnow().isoformat(),
            })

    return validate_parser_result(documents, "epfo_updates", html)


def parse_epfo_circulars(html: str, base_url: str):
    """
    Parse EPFO Circulars page (site_en/circulars.php).

    VALIDATED: Yes -- confirmed against real live HTML 2026-08-06.

    REAL STRUCTURE -- genuinely different from epfo_updates, which is why
    this is now a separate function rather than the two sharing one
    parser with one (wrong) column assumption:
      A single table, ONE real page (91 real data rows checked directly,
      no pager/pagination markers found -- same "no real pagination"
      finding as Updates). Real header row: SR.NO / SUBJECT / HINDI
      VERSION / ENGLISH VERSION (4 real <td> per data row):
        cells[0] = serial number
        cells[1] = real subject text, then a real "<br/>File No. ...
                   dated DD/MM/YYYY<br/>" reference line for the
                   underlying instrument
        cells[2] = Hindi-version link (often empty)
        cells[3] = English-version link (real PDF) -- some real rows carry
                   MORE THAN ONE real link here (e.g. separate Annexure
                   I/II PDFs on the same row)

    The real bug was the same shape as Updates: the old parser read
    title/link from cells[0] (the serial number, no link) and treated
    cells[1] as a date string. Same silent-discard result: zero real
    documents from a real page containing 91 real entries.

    The real "dated DD/MM/YYYY" reference embedded in cells[1] is a
    genuine, usable date signal (unlike Updates, which has none) and is
    extracted via regex rather than parsing the whole cell as a date.

    When a row has more than one real link, the first is kept as
    source_url and the rest are kept in additional_urls rather than
    silently dropped.
    """
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    DATED_RE = re.compile(r"dated\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})", re.IGNORECASE)

    tables = soup.find_all("table")
    for table in tables:
        for row in table.find_all("tr")[1:]:
            cells = row.find_all("td")
            if len(cells) != 4:
                continue

            subject_cell = cells[1]
            full_text = subject_cell.get_text(" ", strip=True)
            # The real subject line is everything before the "File No. ...
            # dated ..." reference line (split at the first <br>).
            first_line = subject_cell.decode_contents().split("<br", 1)[0]
            title = BeautifulSoup(first_line, "html.parser").get_text(" ", strip=True)
            title = title or full_text
            if not title:
                continue

            date_match = DATED_RE.search(full_text)
            published_date = parse_date(date_match.group(1)) if date_match else None

            links = cells[3].find_all("a", href=True) or cells[2].find_all("a", href=True)
            if not links:
                continue
            doc_url = urljoin(base_url, links[0]["href"])
            additional_urls = [urljoin(base_url, a["href"]) for a in links[1:]]

            documents.append({
                "title": title,
                "published_date": published_date,
                "source_url": doc_url,
                "additional_urls": additional_urls,
                "file_size": "",
                "regulator": "EPFO",
                "regulator_full": "Employees' Provident Fund Organisation",
                "domain": "employment_law",
                "document_type": infer_document_type(title),
                "labour_codes": infer_labour_code(title),
                "state": "central",
                "scraped_at": datetime.utcnow().isoformat(),
            })

    return validate_parser_result(documents, "epfo_circulars", html)


def parse_esic(html: str, base_url: str):
    """
    Parse ESIC Circulars page.

    VALIDATED: Yes -- confirmed against real live HTML 2026-08-06.

    REAL, CONFIRMED (2026-08-06): the site this parser was written for,
    www.esic.nic.in, is dead -- its TLS certificate is issued for
    *.esic.gov.in, a DIFFERENT domain, and the bare .nic.in host does not
    respond over plain HTTP either. The real live site is esic.gov.in.
    /notifications (the old configured path) is a genuine 404 there; there
    is no single "notifications" page in the real nav at all. The real
    equivalent, and what this parser now targets, is /circulars
    ("Instructions/Circular/Orders").

    It is also NOT a Drupal views-row site (0 real "views-row" divs found
    on the real page) -- the old selectors (div.view-content,
    div[class*=views-row]) were built for the wrong CMS pattern on top of
    being pointed at the wrong domain. Real structure is a plain 6-column
    table:
      S.No | Branch | Circular/Instn./O.O. No. Dated | Subject | Publish
      Date | Console Sl. No.

    The Subject cell holds the real link and title together with UI
    decoration text appended ("- PDF [icon] size:(224.77 KB) ."), which is
    stripped here rather than left in the title.

    Two real, distinct dates exist and are both kept rather than
    collapsing to one: the reference/instrument date in the "Circular/
    Instn./O.O. No. Dated" column (document_date) and the site's own
    "Publish Date" column, already close to ISO format (published_date).

    Real pagination is confirmed via /circulars/index/page:N (a
    colon-separated path segment) -- a real, distinct style that
    discover_archives()'s existing patterns in labour_scrape.py did not
    match (fixed there too; see that file's ARCHIVE_PATTERNS comment).
    """
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    SIZE_SUFFIX_RE = re.compile(r"\s*-\s*PDF\b.*$", re.IGNORECASE | re.DOTALL)

    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for row in rows[1:]:
            cells = row.find_all("td")
            if len(cells) != 6:
                continue

            subject_cell = cells[3]
            link_tag = subject_cell.find("a", href=True)
            if not link_tag:
                continue

            raw_title = link_tag.get_text(" ", strip=True)
            title = SIZE_SUFFIX_RE.sub("", raw_title).strip()
            if not title:
                continue

            doc_url = urljoin(base_url, link_tag["href"])
            reference_date_text = cells[2].get_text(strip=True)
            publish_date_text = cells[4].get_text(strip=True)

            documents.append({
                "title": title,
                "published_date": parse_date(publish_date_text) or parse_date(reference_date_text),
                "document_date": parse_date(reference_date_text),
                "branch": cells[1].get_text(strip=True),
                "source_url": doc_url,
                "file_size": "",
                "regulator": "ESIC",
                "regulator_full": "Employees' State Insurance Corporation",
                "domain": "employment_law",
                "document_type": infer_document_type(title),
                "labour_codes": infer_labour_code(title),
                "state": "central",
                "scraped_at": datetime.utcnow().isoformat(),
            })

    return validate_parser_result(documents, "esic", html)


def parse_clc(html: str, base_url: str, source_key: str = "clc"):
    """
    Parse a Chief Labour Commissioner (Central) Views-table page:
    Circulars/Orders (source_key="clc") or Minimum Wages
    (source_key="clc_min_wages") -- both real, confirmed 2026-08-06 to
    share the same Drupal Views-field table shape, just with a different
    column ORDER and a different real "download" field class, which is
    why one parser now serves both rather than duplicating it.

    VALIDATED: Yes -- confirmed against real live HTML 2026-08-06.

    /clc/circulars: real semantic "views-field-*" classes stamped on each
    <th> AND each real <td>: S.No (views-field-counter) / Title
    (views-field-title) / Download (views-field-field-file-circular) /
    Date (views-field-created).

    /clc/min-wages: same four real fields, same class names for title/
    date/S.No, but column ORDER is Title, Date, Download (not Title,
    Download, Date), and the real download field class is
    views-field-field-file-upload-wages, not views-field-field-file-
    circular. Column extraction below reads by semantic class name, not
    position, and matches the download column by any "field-file*"
    prefix, so both real variants resolve without a second function.

    REAL BUG FOUND AND FIXED (circulars, 2026-08-06): the old code assumed
    cells[0] held the title and a link -- on this real page cells[0] is
    only the serial number and never has a link. Because this parser's
    only guard was `if not title: continue` (not requiring a real link
    too, unlike parse_epfo's stricter check), it did NOT skip these rows
    -- it silently emitted title="1", "2", "3"... for every real row, with
    source_url falling back to the listing page's own base_url every
    time. This was NOT caught by validate_parser_result's old
    field-presence check, since both fields were technically non-empty,
    just wrong -- see that function's real duplicate-source_url check,
    added specifically because of this bug.

    Real pagination confirmed via ?page=N (query-param style, distinct
    from ESIC's colon style), 2 real pages each for circulars (10+8) and
    min-wages (10+8) -- see labour_scrape.py's fetch_all_pages() for the
    real crawler that now walks both to their real last page.
    """
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    def field_key(td) -> str:
        classes = td.get("class") or []
        for c in classes:
            if c.startswith("views-field-") and c != "views-field":
                return c[len("views-field-"):]
        return ""

    for table in soup.find_all("table"):
        for row in table.find_all("tr")[1:]:
            cells = row.find_all("td")
            if not cells:
                continue

            fields = {field_key(td): td for td in cells}
            title_td = fields.get("title")
            link_td = next(
                (td for key, td in fields.items() if key.startswith("field-file")),
                None,
            )
            date_td = fields.get("created")

            if title_td is None or link_td is None:
                continue  # real column layout not recognised; do not guess

            title = title_td.get_text(" ", strip=True)
            link_tag = link_td.find("a", href=True)
            if not title or not link_tag:
                continue

            doc_url = urljoin(base_url, link_tag["href"])
            date_text = date_td.get_text(strip=True) if date_td is not None else ""

            documents.append({
                "title": title,
                "published_date": parse_date(date_text),
                "source_url": doc_url,
                "file_size": "",
                "regulator": "CLC",
                "regulator_full": "Chief Labour Commissioner (Central)",
                "domain": "employment_law",
                "document_type": infer_document_type(title),
                "labour_codes": infer_labour_code(title),
                "state": "central",
                "scraped_at": datetime.utcnow().isoformat(),
            })

    return validate_parser_result(documents, source_key, html)


def parse_clc_acts_rules(html: str, base_url: str):
    """
    Parse CLC "Acts and Rules" page (/clc/acts-rules/acts-and-rules-0).

    VALIDATED: Yes -- confirmed against real live HTML 2026-08-06.

    REAL STRUCTURE -- genuinely different from parse_clc()'s Views table,
    which is why this is a separate function rather than a third
    field-key variant: a single-column <table> with NO header row at all
    (every real <tr> is a data row, unlike circulars/min-wages which have
    a header row plus Views field-class scaffolding). Each real row has
    one <a> naming an Act; a handful of real rows carry a SECOND <a> for
    a companion "Rules" document, and at least one carries a real,
    useless empty-text placeholder <a> pointing at a duplicate PDF --
    filtered out here by requiring non-empty link text.

    Real hrefs are a genuine mix: some are absolute PDF paths
    (/clc/sites/default/files/...), most are bare relative slugs (e.g.
    "industrial-disputes-act") that resolve to a real detail page -- but
    ONLY when joined against this LISTING page's own URL, not the site
    root. Confirmed live: urljoin(".../clc/acts-rules/acts-and-rules-0",
    "industrial-disputes-act") -> ".../clc/acts-rules/industrial-disputes-act",
    a real HTTP 200. labour_scrape.py's SOURCES["clc_acts_rules"]["base_url"]
    is therefore set to this listing page's own URL, not
    "https://clc.gov.in".

    No date or S.No column exists on this real page at all -- both are
    left None/absent by design, not a parsing gap.

    Real, CONFIRMED 2026-08-06: unlike circulars/min-wages, this view's
    ?page=1 is a genuine site bug -- its pager claims a real "last page"
    marker but returns byte-for-byte identical content to page 0. Real
    total is 15 documents on ONE real page; labour_scrape.fetch_all_pages()
    catches this via its wrap-around guard rather than trusting the
    pager's own "last" claim. See that function and SOURCES["clc_acts_rules"]
    for the full real evidence.
    """
    soup = BeautifulSoup(html, "html.parser")
    documents = []

    for row in soup.find_all("tr"):
        cell = row.find("td")
        if cell is None:
            continue

        links = [a for a in cell.find_all("a", href=True) if a.get_text(strip=True)]
        if not links:
            continue  # real placeholder-only row (empty-text <a>)

        primary = links[0]
        title = primary.get_text(strip=True)
        doc_url = urljoin(base_url, primary["href"])
        additional_urls = [urljoin(base_url, a["href"]) for a in links[1:]]

        documents.append({
            "title": title,
            "published_date": None,
            "source_url": doc_url,
            "additional_urls": additional_urls,
            "file_size": "",
            "regulator": "CLC",
            "regulator_full": "Chief Labour Commissioner (Central)",
            "domain": "employment_law",
            "document_type": infer_document_type(title),
            "labour_codes": infer_labour_code(title),
            "state": "central",
            "scraped_at": datetime.utcnow().isoformat(),
        })

    return validate_parser_result(documents, "clc_acts_rules", html)


# --- Router ---
PARSERS = {
    "mole_gazette": parse_mole_gazette,
    "mole_whatsnew": parse_mole_whatsnew,
    # Real, confirmed 2026-08-06: epfo_updates and epfo_circulars have
    # genuinely different column structures (2 real columns vs 4), so they
    # are now two dedicated parsers rather than one shared parse_epfo()
    # with a single column-index assumption that was wrong for both.
    "epfo_updates": parse_epfo_updates,
    "epfo_circulars": parse_epfo_circulars,
    "esic": parse_esic,
    "clc": parse_clc,
    "clc_min_wages": partial(parse_clc, source_key="clc_min_wages"),
    "clc_acts_rules": parse_clc_acts_rules,
}


def parse_source(source_key: str, html: str, base_url: str) -> dict:
    """Route to correct parser and return validated result."""
    parser = PARSERS.get(source_key)
    if not parser:
        raise ValueError(f"No parser found for source: {source_key}")
    
    result = parser(html, base_url)
    
    # If validation failed, still return what we have but flag it
    if not result["validation"]["validated"]:
        print(
            f"[VALIDATION WARNING] {source_key}: {result['validation']['validation_issue']}",
            file=sys.stderr,
        )
    
    return result


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Parse scraped labour law HTML")
    parser.add_argument("html_file", help="Path to HTML file")
    parser.add_argument("--source", required=True, choices=list(PARSERS.keys()))
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output", default="-")
    
    args = parser.parse_args()
    
    with open(args.html_file, "r", encoding="utf-8") as f:
        html = f.read()
    
    result = parse_source(args.source, html, args.base_url)
    output = json.dumps(result, ensure_ascii=False, indent=2)
    
    if args.output == "-":
        print(output)
    else:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)