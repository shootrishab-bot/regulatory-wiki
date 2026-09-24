import os
from dataclasses import dataclass, field
from pathlib import Path


def _llm_setting(name: str, fallback: str) -> str:
    """An LLM_* environment setting, or the DeepSeek-era fallback when unset."""
    return os.environ.get(name) or fallback


@dataclass
class Config:
    """Configuration for the FIU-IND scraper. All secrets come from environment variables.

    Every URL below is CONFIRMED live 2026-08-25 (see ../taxonomy-findings.md) --
    fetched with a plain, unauthenticated `requests` GET, no session warm-up or
    cookies needed. Two URLs the build brief pointed at
    (fiuindia.gov.in/pdfs/judgements/, .../pdfs/downloads/) turned out to be raw
    file-storage directories, not real listing pages -- they return HTTP 200
    with an empty body (directory listing disabled), not a block. The real
    listing pages are Compliance_Orders/orders.html and Downloads/Downloads.html
    respectively, both confirmed with real content below.
    """

    BASE_URL: str = "https://fiuindia.gov.in"
    HOMEPAGE_URL: str = f"{BASE_URL}/"

    # Adjudication / Penalty Orders -- CONFIRMED: 13 year-tables (2013-2025),
    # 126 real rows, includes Binance/Bybit/Paytm Payments Bank. This is what
    # the legacy fiu_watcher.py already scraped, truncated to its top 10.
    COMPLIANCE_ORDERS_URL: str = f"{BASE_URL}/files/Compliance_Orders/orders.html"

    # Guidelines / Circulars -- CONFIRMED: 1 table, 12 real rows (VDA
    # Guidelines, TCSP Guidelines, MSCS Guidelines, VDA SP registration
    # circular revisions, Personal Hearing Policy).
    DOWNLOADS_URL: str = f"{BASE_URL}/files/Downloads/Downloads.html"

    # "What's New" -- CONFIRMED real press-release/institutional-update feed,
    # NOT in the build brief's original 6 pages (that page's existence was
    # unconfirmed going in). 2 tables (recent + full archive), ~199 real
    # month-grouped rows: inter-agency MoUs, NBFC non-compliance lists,
    # recruitment notices, auction notices.
    WHATS_NEW_URL: str = f"{BASE_URL}/files/misc/archive.html"

    # Careers/recruitment -- CONFIRMED real, 54 rows, month-grouped like
    # What's New. No Instrument Type in the v1.0 taxonomy fits this content;
    # flagged as a proposed addition in taxonomy-findings.md rather than
    # invented here.
    CAREERS_URL: str = f"{BASE_URL}/files/misc/job_opp.html"

    # Tenders -- CONFIRMED: 1 table, 122 real dated rows (tenders, auction/
    # disposal notices) back to 2021 and earlier.
    TENDERS_URL: str = f"{BASE_URL}/files/Footer_Links/tenders.html"

    # AML_Legislation -- CONFIRMED real, static single-document pages (no
    # listing table -- each IS one document).
    PMLA_ACT_URL: str = f"{BASE_URL}/files/AML_Legislation/pmla_2002.html"
    SCHEDULED_OFFENCES_URL: str = f"{BASE_URL}/files/AML_Legislation/scheduled_offences.html"
    PML_RECORDS_RULES_URL: str = f"{BASE_URL}/files/AML_Legislation/notification.html"
    # Real page, but outside PMLA scope (Unlawful Activities/WMD Act) -- kept
    # in scope since it's linked from the same real AML_Legislation nav
    # section; the classifier decides fit, see classifier.py's system prompt.
    WMD_SECTION12A_URL: str = f"{BASE_URL}/files/AML_Legislation/DOR_Section12A_WMD.html"

    # CONFIRMED real, static single-document pages.
    FAQ_URL: str = f"{BASE_URL}/files/FAQs/faqs.html"
    RTI_URL: str = f"{BASE_URL}/files/misc/RTI.html"
    INTERNATIONAL_URL: str = f"{BASE_URL}/files/International/International.html"
    PUBLICATIONS_URL: str = f"{BASE_URL}/files/Publication/Publication.html"

    # Annual Reports -- CONFIRMED real (both return HTTP 200,
    # application/pdf, real content) but ORPHANED: not linked from
    # Downloads.html, Publication.html, the About page, or the site's own
    # sitemap.html. No crawlable listing page exists for these, so they're
    # seeded here directly as known-good direct URLs rather than skipped --
    # see taxonomy-findings.md for the discovery trail. Revisit if a future
    # site redesign adds a real Annual Report listing page.
    ANNUAL_REPORT_SEED_URLS: tuple = (
        (f"{BASE_URL}/pdfs/downloads/AnnualReport2019_20.pdf", "FIU-IND Annual Report 2019-20"),
        (f"{BASE_URL}/pdfs/downloads/AnnualReport2022_23.pdf", "FIU-IND Annual Report 2022-23"),
    )

    # File paths
    DATA_DIR: Path = Path("data/fiu")
    DOWNLOAD_DIR: Path = field(init=False)
    DB_PATH: Path = field(init=False)

    # Scraping parameters
    REQUEST_TIMEOUT: int = 30
    MAX_RETRIES: int = 3
    RATE_LIMIT_SECONDS: float = 1.5  # minimum gap between requests to fiuindia.gov.in
    USER_AGENT: str = (
        "Mozilla/5.0 (compatible; TrilegalRegulatoryWikiBot/1.0; +internal-research-tool)"
    )

    # PDF extraction
    MAX_CHARS_FOR_CLASSIFICATION: int = 8000
    MIN_CHARS_FOR_SUCCESSFUL_EXTRACTION: int = 40  # below this, treat as empty and try OCR

    # Watcher
    CHECK_INTERVAL_HOURS: float = 6.0

    # Classification model. Provider-neutral: any OpenAI-compatible
    # /chat/completions endpoint, configured by the same three settings the
    # wiki's own classifier uses (lib/ingest.ts). With LLM_* unset it falls
    # back to DeepSeek and DEEPSEEK_API_KEY, as before.
    LLM_API_KEY: str = field(default_factory=lambda: _llm_setting("LLM_API_KEY", os.environ.get("DEEPSEEK_API_KEY", "")))
    LLM_API_URL: str = field(default_factory=lambda: _llm_setting("LLM_BASE_URL", "https://api.deepseek.com").rstrip("/") + "/chat/completions")
    LLM_MODEL: str = field(default_factory=lambda: _llm_setting("LLM_MODEL", "deepseek-chat"))
    CLASSIFICATION_TEMPERATURE: float = 0.0
    CLASSIFICATION_MAX_TOKENS: int = 700

    # Email alerts (all optional -- alerts are skipped with a log warning, not a crash, if unset)
    SMTP_HOST: str = field(default_factory=lambda: os.environ.get("SMTP_HOST", ""))
    SMTP_PORT: int = field(default_factory=lambda: int(os.environ.get("SMTP_PORT", "587")))
    SMTP_USER: str = field(default_factory=lambda: os.environ.get("SMTP_USER", ""))
    SMTP_PASSWORD: str = field(default_factory=lambda: os.environ.get("SMTP_PASSWORD", ""))
    ALERT_EMAIL_FROM: str = field(default_factory=lambda: os.environ.get("ALERT_EMAIL_FROM", ""))
    ALERT_EMAIL_TO: str = field(default_factory=lambda: os.environ.get("ALERT_EMAIL_TO", ""))

    def __post_init__(self):
        self.DOWNLOAD_DIR = self.DATA_DIR / "downloads"
        self.DB_PATH = self.DATA_DIR / "fiu_scraper.db"
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def alerts_configured(self) -> bool:
        return bool(self.SMTP_HOST and self.ALERT_EMAIL_FROM and self.ALERT_EMAIL_TO)
