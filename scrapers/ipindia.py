import requests
from bs4 import BeautifulSoup
import pandas as pd
from urllib.parse import urljoin
import time
import hashlib
import json
import re
import sys
from pathlib import Path


BASE = "https://ipindia.gov.in"
# ipindia.gov.in was rebuilt in 2026. The old listing this scraper read
# (/Home/Latestnews/1?CatID=1, #news-container li) now returns 404, so every
# run scraped 0 rows and printed "No data scraped" while exiting 0. The new
# site lists every news item, all categories, in one table here -- the same
# data its homepage pulls from /filter-news, which only returns the current
# handful per category. Verified live 2026-09-24: 59 rows, newest first,
# going back to December 2025.
BASE_LIST = "https://ipindia.gov.in/dynamic/news-updates"


DATA_DIR = Path("data")
CSV_FILE = DATA_DIR / "ipindia_master.csv"
NEW_JSON = DATA_DIR / "ipindia_new_entries.json"

HEADERS = {"User-Agent": "Mozilla/5.0"}


# -------------------------
# Stable ID (CCI style)
# -------------------------
def make_id(title, link):
    return hashlib.sha1(
        f"{title}|{link}".encode()
    ).hexdigest()[:16]


# -------------------------
# PDF filename from title
# first 5 real words only
# -------------------------
def make_pdf_filename(title, pdf_link):
    if not pdf_link:
        return ""

    words = re.findall(r"[A-Za-z0-9]+", title)[:5]
    base = "_".join(words)

    return base + ".pdf"


# -------------------------
# Clean breadcrumb text
# -------------------------
def clean_content(text):
    remove_lines = {"Home", "Media", "Latest News", "News Detail"}
    lines = text.splitlines()
    lines = [l.strip() for l in lines if l.strip() and l.strip() not in remove_lines]
    return "\n".join(lines)


# -------------------------
# Listing page
# -------------------------
def get_listing():
    """Every row of the news-updates table: S.No. / Category / Date /
    Title / File / View. Columns are found by header text, not position."""
    print("Listing:", BASE_LIST)
    r = requests.get(BASE_LIST, headers=HEADERS, timeout=60)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")

    table = soup.find("table")
    if table is None:
        return []
    headers = [th.get_text(" ", strip=True).lower() for th in table.find_all("th")]

    def col(name):
        return next((i for i, h in enumerate(headers) if name in h), None)

    cat_i, date_i, title_i, file_i = col("category"), col("date"), col("title"), col("file")
    if title_i is None:
        return []

    items = []
    for tr in (table.find("tbody") or table).find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) <= title_i:
            continue
        link = tds[title_i].find("a", href=True)
        if not link:
            continue
        file_tag = tds[file_i].find("a", href=True) if file_i is not None and file_i < len(tds) else None
        items.append({
            "title": link.get_text(" ", strip=True),
            "category": tds[cat_i].get_text(strip=True) if cat_i is not None else "",
            "date": tds[date_i].get_text(strip=True) if date_i is not None else "",
            "detail_link": urljoin(BASE, link["href"]),
            "file_link": urljoin(BASE, file_tag["href"]) if file_tag else "",
        })
    return items


# -------------------------
# Detail page
# -------------------------
def extract_detail(url):
    """(text, first PDF) from a news-details page's .aboutSectionArea."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        area = soup.select_one(".aboutSectionArea")
        if area is None:
            return "", ""
        content = clean_content(area.get_text("\n", strip=True))
        pdf = area.find("a", href=lambda h: h and h.lower().split("?")[0].endswith(".pdf"))
        return content, (urljoin(BASE, pdf["href"]) if pdf else "")
    except Exception as e:
        print("Detail error:", url, e)
        return "", ""


# -------------------------
# Scraper runner
# -------------------------
def run_scraper():
    results = []
    for item in get_listing():
        content, detail_pdf = extract_detail(item["detail_link"])
        # The listing's own File column is the primary document; the detail
        # page's first PDF covers items that only attach files there.
        pdf = item["file_link"] or detail_pdf

        results.append({
            "id": make_id(item["title"], item["detail_link"]),
            "title": item["title"],
            "date": item["date"],
            "category": item["category"],
            "detail_link": item["detail_link"],
            "pdf_link": pdf,
            "pdf_filename": make_pdf_filename(item["title"], pdf),
            "content": content,
        })
        time.sleep(0.6)

    print("TOTAL SCRAPED:", len(results))
    return results


# -------------------------
# CCI-STYLE SAVE LOGIC
# -------------------------
def save_outputs(data):

    DATA_DIR.mkdir(exist_ok=True)

    new_df = pd.DataFrame(data)

    if new_df.empty:
        # The site lists dozens of items; none means it changed or refused
        # us. Exiting 0 here is what hid the 2026 redesign.
        print("No data scraped -- blocked, unreachable, or the site layout changed", file=sys.stderr)
        sys.exit(2)

    # -------- FIRST RUN --------
    if not CSV_FILE.exists():
        new_df.to_csv(CSV_FILE, index=False)
        new_df.to_json(NEW_JSON, orient="records", indent=2)
        print("First run — all entries new:", len(new_df))
        return

    # -------- NORMAL RUN --------
    old_df = pd.read_csv(CSV_FILE)

    if "id" not in old_df.columns:
        old_ids = set()
    else:
        old_ids = set(old_df["id"].astype(str))

    new_entries = new_df[~new_df["id"].isin(old_ids)]

    # overwrite master CSV with full latest scrape
    new_df.to_csv(CSV_FILE, index=False)

    # write only delta to JSON
    new_entries.to_json(NEW_JSON, orient="records", indent=2)

    print("New entries:", len(new_entries))


# -------------------------
if __name__ == "__main__":

    scraped = run_scraper()
    save_outputs(scraped)

    print("\n✅ DONE")
    print("CSV:", CSV_FILE)
    print("JSON new:", NEW_JSON)
