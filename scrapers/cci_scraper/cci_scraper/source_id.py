import hashlib

from . import REGULATOR_CODE


def make_source_id(source_url: str, title: str) -> str:
    """
    sha1(regulator_code|source_url|title) -- matches the convention used across
    every regulator in this project (see the Employment Law and DoT taxonomy
    workbooks' Schema Note sheets, "Source_id generation").

    Deliberately keyed to source_url (the page/feed a document was found on),
    not the document's own file URL. The CCI Tagging Guide is explicit that
    "duplicate routes remain provenance rather than duplicate objects" -- the
    same real document cross-listed under, say, both the homepage feed and a
    Press Releases archive should produce two records, not be silently
    deduped, since each route is itself evidence worth keeping.
    """
    text = f"{REGULATOR_CODE}|{source_url}|{title}"
    return hashlib.sha1(text.encode("utf-8")).hexdigest()
