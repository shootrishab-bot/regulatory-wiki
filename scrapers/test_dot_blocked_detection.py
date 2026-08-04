"""
Regression test for dot_watcher.py's WAF-block detection (is_blocked_response,
goto_and_check_blocked, BlockedError).

Guards against the exact bug class investigated 2026-07-29: dot.gov.in's
Akamai edge WAF returns HTTP 403 with title "Access Denied" when it blocks a
request. Before this fix, scrape_section()/expand_detail_page() detected
"no content" purely via find_ctx()'s div.announcementbox search, which finds
nothing on an Access-Denied page too -- so a block was silently
indistinguishable from a genuinely empty section/topic page. Suspected (not
confirmed -- dot.gov.in was still actively blocking requests during this
investigation) to be why the GUIDELINES section recorded 0 of 581 documents.

Uses fake Response/Page objects scripted with the REAL block-page title and
body text captured live (2026-07-29) from an actual 403 response, rather
than a synthetic guess -- and a REAL genuinely-empty-page fixture (normal
200, ordinary title/body, matching what a real empty-but-not-blocked
section page looks like) to prove the two cases are told apart correctly,
not just that 403 is detected.

Run with: python test_dot_blocked_detection.py
"""

import dot_watcher

failures = 0


def check(label, actual, expected):
    global failures
    ok = actual == expected
    print(f"[{'PASS' if ok else 'FAIL'}] {label} -> {actual!r} (expected {expected!r})")
    if not ok:
        failures += 1


# Captured live (2026-07-29) from an actual dot.gov.in/documents/guidelines
# 403 response -- not a synthetic guess.
REAL_ACCESS_DENIED_TITLE = "Access Denied"
REAL_ACCESS_DENIED_BODY = (
    "Access Denied\n"
    "You don't have permission to access \"http://www.dot.gov.in/documents/guidelines?\" on this server.\n\n"
    "Reference #18.6ca2dfad.1785313424.f26fc5\n\n"
    "https://errors.edgesuite.net/18.6ca2dfad.1785313424.f26fc5"
)

# A genuinely-empty-but-not-blocked page: normal 200 status, ordinary title,
# no announcementbox content -- must NOT be classified as blocked. This is
# the case is_blocked_response() must correctly leave alone.
REAL_EMPTY_SECTION_TITLE = "Guidelines | Department of Telecommunications | Government Of India"
REAL_EMPTY_SECTION_BODY = "No documents found in this section."


class FakeResponse:
    def __init__(self, status):
        self.status = status


class FakePage:
    """Minimal stand-in for playwright's Page. Scripted with a sequence of
    (status, title, body) tuples, one per goto() call, so
    goto_and_check_blocked()'s retry/backoff logic can be exercised without
    a real browser or hitting the live (currently blocking) dot.gov.in
    site."""

    def __init__(self, script):
        self.script = list(script)
        self.call_count = 0
        self.waited_ms = []
        self._title = ""
        self._body = ""

    def goto(self, url, timeout=90000):
        i = min(self.call_count, len(self.script) - 1)
        status, title, body = self.script[i]
        self.call_count += 1
        self._title = title
        self._body = body
        return FakeResponse(status)

    def title(self):
        return self._title

    def inner_text(self, selector):
        return self._body

    def wait_for_timeout(self, ms):
        self.waited_ms.append(ms)


# ---------------------------------------------------------------------------
# is_blocked_response(): the core classification, tested directly.
#
# FakePage only populates its title()/inner_text() state inside goto() (to
# accurately model the real Page object, where those reflect whatever page
# is currently loaded) -- so each case below calls goto() first to load the
# scripted (status, title, body), mirroring how is_blocked_response() is
# actually invoked in goto_and_check_blocked() right after a real goto().
# ---------------------------------------------------------------------------


def load_and_classify(status, title, body):
    page = FakePage([(status, title, body)])
    resp = page.goto("https://www.dot.gov.in/documents/x")
    return dot_watcher.is_blocked_response(resp, page)


check(
    "real 403 Access-Denied response is classified as blocked",
    load_and_classify(403, REAL_ACCESS_DENIED_TITLE, REAL_ACCESS_DENIED_BODY),
    True,
)

check(
    "a genuinely empty (200, ordinary title/body) section page is NOT classified as blocked",
    load_and_classify(200, REAL_EMPTY_SECTION_TITLE, REAL_EMPTY_SECTION_BODY),
    False,
)

check(
    "a normal successful page (200, real listing title) is NOT classified as blocked",
    load_and_classify(200, "Orders and Notices | Department of Telecommunications", ""),
    False,
)

check(
    "title/body fallback catches Access Denied even if status somehow reads non-403",
    load_and_classify(200, REAL_ACCESS_DENIED_TITLE, REAL_ACCESS_DENIED_BODY),
    True,
)

# ---------------------------------------------------------------------------
# goto_and_check_blocked(): retry/backoff behavior
# ---------------------------------------------------------------------------

# Case 1: blocked immediately, clears on the very next try -- should NOT
# raise, and should have backed off using BLOCKED_RETRY_PAUSES_MS[0].
page1 = FakePage([
    (403, REAL_ACCESS_DENIED_TITLE, REAL_ACCESS_DENIED_BODY),
    (200, "Orders and Notices | Department of Telecommunications", ""),
])
raised = False
try:
    dot_watcher.goto_and_check_blocked(page1, "https://www.dot.gov.in/documents/guidelines?page=1", "test")
except dot_watcher.BlockedError:
    raised = True
check("block that clears on first retry does NOT raise BlockedError", raised, False)
check("exactly 2 goto() calls made (initial + 1 retry)", page1.call_count, 2)
check(
    "backed off using BLOCKED_RETRY_PAUSES_MS[0], not RETRY_PAUSES_MS's shorter intervals",
    dot_watcher.BLOCKED_RETRY_PAUSES_MS[0] in page1.waited_ms,
    True,
)

# Case 2: blocked on every attempt (initial + all of BLOCKED_RETRY_PAUSES_MS)
# -- must raise BlockedError, not silently return as if content were found.
page2 = FakePage([(403, REAL_ACCESS_DENIED_TITLE, REAL_ACCESS_DENIED_BODY)])
raised = False
try:
    dot_watcher.goto_and_check_blocked(page2, "https://www.dot.gov.in/documents/guidelines?page=1", "test")
except dot_watcher.BlockedError:
    raised = True
check("still-blocked after exhausting BLOCKED_RETRY_PAUSES_MS raises BlockedError", raised, True)
check(
    "exactly 1 + len(BLOCKED_RETRY_PAUSES_MS) goto() calls made",
    page2.call_count,
    1 + len(dot_watcher.BLOCKED_RETRY_PAUSES_MS),
)

# Case 3: never blocked at all -- should return immediately with zero
# backoff waits (must not falsely treat a normal page as blocked).
page3 = FakePage([(200, "Orders and Notices | Department of Telecommunications", "")])
raised = False
try:
    dot_watcher.goto_and_check_blocked(page3, "https://www.dot.gov.in/documents/orders-and-notices?page=1", "test")
except dot_watcher.BlockedError:
    raised = True
check("a normal, never-blocked page does NOT raise BlockedError", raised, False)
# goto_and_check_blocked() always does a short 1500ms settle wait after
# ANY goto() (not a backoff -- just letting the response resolve before
# checking it) -- so a normal page waits exactly that once, and none of
# BLOCKED_RETRY_PAUSES_MS's much longer values, since no retry happens.
check(
    "no BLOCKED_RETRY_PAUSES_MS backoff triggered for a normal page (only the 1500ms settle wait)",
    page3.waited_ms,
    [1500],
)
check("exactly 1 goto() call made (no retries needed)", page3.call_count, 1)

print()
print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
raise SystemExit(0 if failures == 0 else 1)
