import os
from dataclasses import dataclass, field
from pathlib import Path


def _llm_setting(name: str, fallback: str) -> str:
    """An LLM_* environment setting, or the DeepSeek-era fallback when unset."""
    return os.environ.get(name) or fallback


@dataclass
class Config:
    """Configuration for the CCI scraper. All secrets come from environment variables."""

    # Base URLs -- CONFIRMED means fetched and verified during taxonomy research;
    # unmarked ones are best-guess from CCI's own nav structure and need a live check.
    BASE_URL: str = "https://www.cci.gov.in"
    HOMEPAGE_URL: str = f"{BASE_URL}/"

    ANTITRUST_ORDERS_URL: str = f"{BASE_URL}/antitrust/orders"  # CONFIRMED, AJAX search form
    ANTITRUST_PRESS_RELEASE_URL: str = f"{BASE_URL}/antitrust/press-release"  # CONFIRMED, singular
    COMBINATION_NOTIFICATIONS_URL: str = f"{BASE_URL}/combination/legal-framwork/notifications"  # CONFIRMED, AJAX, note real typo "framwork"
    COMBINATION_PRESS_RELEASES_URL: str = f"{BASE_URL}/combination/press-releases"  # unverified
    TENDERS_URL: str = f"{BASE_URL}/tenders"  # CONFIRMED
    MARKET_STUDIES_URL: str = f"{BASE_URL}/economics-research/market-studies"  # CONFIRMED
    MARKET_STUDIES_ARCHIVE_URL: str = f"{BASE_URL}/economics-research/market-studies-archive"  # CONFIRMED
    RTI_URL: str = f"{BASE_URL}/rti-corner"  # unverified, standard gov.in pattern

    # File paths
    DATA_DIR: Path = Path("data/cci")
    DOWNLOAD_DIR: Path = field(init=False)
    DB_PATH: Path = field(init=False)
    DISCOVERY_LOG_PATH: Path = field(init=False)

    # Scraping parameters
    REQUEST_TIMEOUT: int = 30
    MAX_RETRIES: int = 3
    RATE_LIMIT_SECONDS: float = 2.0  # minimum gap between requests to cci.gov.in
    # Deliberately NOT the same 2.0s gate as full GET/download traffic:
    # RATE_LIMIT_SECONDS exists to be gentle about substantial PDF transfers,
    # and its single-global-lock design (scraper.py's RateLimiter) means
    # throughput is capped at 1/RATE_LIMIT_SECONDS regardless of concurrency
    # -- reusing it for filter_changed_items()'s HEAD-only fingerprint checks
    # would make a "nothing changed" re-scrape of the real ~1,324-document
    # corpus take ~44 minutes just for the HEAD requests alone (confirmed
    # live 2026-08-25: a HEAD against a real cci.gov.in PDF is a cheap,
    # no-disk-read static-file-server response, not a resource-intensive
    # request the way a full download+OCR+classify is), defeating the whole
    # point of the incremental skip. HEAD_CHECK_CONCURRENCY instead just caps
    # how many HEAD requests are in flight at once -- comparable to a normal
    # browser loading several resources off one page -- with no artificial
    # per-request delay layered on top.
    HEAD_CHECK_CONCURRENCY: int = 6
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
    CLASSIFICATION_MAX_TOKENS: int = 700  # headroom for JSON + a short rationale, see classifier.py

    # Email alerts (all optional -- alerts are skipped with a log warning, not a crash, if unset)
    SMTP_HOST: str = field(default_factory=lambda: os.environ.get("SMTP_HOST", ""))
    SMTP_PORT: int = field(default_factory=lambda: int(os.environ.get("SMTP_PORT", "587")))
    SMTP_USER: str = field(default_factory=lambda: os.environ.get("SMTP_USER", ""))
    SMTP_PASSWORD: str = field(default_factory=lambda: os.environ.get("SMTP_PASSWORD", ""))
    ALERT_EMAIL_FROM: str = field(default_factory=lambda: os.environ.get("ALERT_EMAIL_FROM", ""))
    ALERT_EMAIL_TO: str = field(default_factory=lambda: os.environ.get("ALERT_EMAIL_TO", ""))

    def __post_init__(self):
        self.DOWNLOAD_DIR = self.DATA_DIR / "downloads"
        self.DB_PATH = self.DATA_DIR / "cci_scraper.db"
        self.DISCOVERY_LOG_PATH = self.DATA_DIR / "api_discovery.json"
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def alerts_configured(self) -> bool:
        return bool(self.SMTP_HOST and self.ALERT_EMAIL_FROM and self.ALERT_EMAIL_TO)
