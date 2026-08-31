import hashlib

from . import REGULATOR_CODE


def make_source_id(source_url: str, title: str) -> str:
    """sha1(regulator_code|source_url|title) -- same convention as every other
    regulator in this project, including cci_scraper's identical helper. Keyed
    to source_url (the listing page a document was found on), not the
    document's own file URL, for the same reason CCI's does: the same real
    document appearing under two different real routes (e.g. a circular
    cross-listed on both Downloads.html and What's New) is provenance worth
    keeping as two records, not something to silently dedupe away."""
    text = f"{REGULATOR_CODE}|{source_url}|{title}"
    return hashlib.sha1(text.encode("utf-8")).hexdigest()
