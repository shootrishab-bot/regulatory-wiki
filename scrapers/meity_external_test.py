import os
import re
import json
import time
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.meity.gov.in"

# Base categories in the Documents section
DOCUMENT_CATEGORIES = {
    "Reports": "/documents/reports",
    "Act and Policies": "/documents/act-and-policies",
    "Orders and Notices": "/documents/orders-and-notices",
    "Publications": "/documents/publications",
    "Press Release": "/documents/press-release",
    "Gazettes and Notifications": "/documents/gazettes-notifications",
    "Guidelines": "/documents/guidelines",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

OUTPUT_DIR = "meity_documents"
DATA_FILE = os.path.join(OUTPUT_DIR, "meity_metadata.json")


def find_archive_urls(soup, current_page_url):
    """
    Locates any 'View Archive', 'Archived', or historical repository links
    present on the main category page.
    """
    archive_urls = set()

    # 1. Search anchor tags explicitly mentioning 'Archive' in text or href
    for a_tag in soup.find_all("a", href=True):
        text = a_tag.get_text(strip=True).lower()
        href = a_tag["href"].lower()

        if "archive" in text or "archive" in href or "archives" in text:
            full_url = urljoin(BASE_URL, a_tag["href"])
            # Prevent circular loops to root pages or self
            if full_url != current_page_url and BASE_URL in full_url:
                archive_urls.add(full_url)

    # 2. Check for button / input elements with archive actions
    for elem in soup.find_all(["button", "input"], text=re.compile(r'archive', re.I)):
        parent_a = elem.find_parent("a", href=True)
        if parent_a:
            archive_urls.add(urljoin(BASE_URL, parent_a["href"]))

    return list(archive_urls)


def parse_documents_from_page(html_content, category_name, is_archived=False):
    """
    Extracts document titles, publication dates, file sizes, and download URLs.
    """
    soup = BeautifulSoup(html_content, "html.parser")
    documents = []

    # MeitY listings typically reside in view tables or div grid views
    rows = soup.find_all(["tr", "div"], class_=re.compile(r"views-row|document-item|field-content|row", re.I))

    if not rows:
        # Fallback for plain direct links on unstructured sub-pages
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if ".pdf" in href.lower() or "/documents/" in href.lower():
                title = a.get_text(strip=True)
                if title and len(title) > 3:
                    documents.append({
                        "title": title,
                        "category": category_name,
                        "is_archived": is_archived,
                        "url": urljoin(BASE_URL, href),
                        "published_date": None,
                        "file_size": None
                    })
        return documents, soup

    for row in rows:
        text = row.get_text(" ", strip=True)
        link_tag = row.find("a", href=True)

        if not link_tag:
            continue

        doc_url = urljoin(BASE_URL, link_tag["href"])
        title = link_tag.get_text(strip=True) or "Untitled Document"

        # Match DD.MM.YYYY or DD-MM-YYYY dates
        date_match = re.search(r'\b\d{2}[\./\-]\d{2}[\./\-]\d{4}\b', text)
        pub_date = date_match.group(0) if date_match else "N/A"

        # Match sizes like 1.5 MB or 450 KB
        size_match = re.search(r'\b\d+(\.\d+)?\s*(KB|MB|GB)\b', text, re.I)
        file_size = size_match.group(0) if size_match else "N/A"

        documents.append({
            "title": title,
            "category": category_name,
            "is_archived": is_archived,
            "url": doc_url,
            "published_date": pub_date,
            "file_size": file_size
        })

    return documents, soup


def crawl_endpoint_pages(endpoint_url, category_name, is_archived=False, max_pages=10):
    """
    Iterates through pagination for a specific endpoint (Active or Archive).
    """
    all_docs = []
    discovered_archives = []

    for page in range(0, max_pages):
        # Format query string appropriately for page numbers
        join_char = "&" if "?" in endpoint_url else "?"
        page_url = f"{endpoint_url}{join_char}page={page}" if page > 0 else endpoint_url

        print(f"   [{'Archive' if is_archived else 'Active'}] Fetching Page {page}: {page_url}")

        try:
            res = requests.get(page_url, headers=HEADERS, timeout=20)
            if res.status_code != 200:
                print(f"   Status {res.status_code}. Stopping pagination for this endpoint.")
                break

            docs, soup = parse_documents_from_page(res.text, category_name, is_archived=is_archived)

            # Discover "View Archive" links on the first active page scan
            if page == 0 and not is_archived:
                archives_found = find_archive_urls(soup, page_url)
                discovered_archives.extend(archives_found)

            if not docs:
                print(f"   No documents found on page {page}. Ending sequence.")
                break

            all_docs.extend(docs)
            time.sleep(1.2)  # Respectful rate-limiting

        except Exception as err:
            print(f"   Request error at {page_url}: {err}")
            break

    return all_docs, list(set(discovered_archives))


def run_full_crawler(max_pages_per_section=10):
    """
    Main orchestration loop covering active categories and discovered archive routes.
    """
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    master_records = []

    for category_name, path in DOCUMENT_CATEGORIES.items():
        print(f"\n==========================================")
        print(f"Processing Category: {category_name}")
        print(f"==========================================")

        initial_url = f"{BASE_URL}{path}"

        # 1. Scrape Active Section Documents
        active_docs, archive_urls = crawl_endpoint_pages(
            initial_url, category_name, is_archived=False, max_pages=max_pages_per_section
        )
        master_records.extend(active_docs)
        print(f"-> Collected {len(active_docs)} active records.")

        # 2. Scrape Archive Section Documents (if 'View Archive' button/link was found)
        if archive_urls:
            print(f"-> Discovered {len(archive_urls)} Archive Endpoint(s) for {category_name}:")
            for arch_url in archive_urls:
                print(f"   Navigating Archive: {arch_url}")
                archive_docs, _ = crawl_endpoint_pages(
                    arch_url, category_name, is_archived=True, max_pages=max_pages_per_section
                )
                master_records.extend(archive_docs)
                print(f"   -> Collected {len(archive_docs)} archived records.")

    # Deduplicate results based on file download URLs
    unique_docs_map = {doc['url']: doc for doc in master_records}
    final_dataset = list(unique_docs_map.values())

    # Write output to JSON
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(final_dataset, f, indent=2, ensure_ascii=False)

    print(f"\n Scrape complete.")
    print(f" Total Unique Documents Extracted: {len(final_dataset)}")
    print(f" Saved to: {DATA_FILE}")


if __name__ == "__main__":
    run_full_crawler(max_pages_per_section=10)
