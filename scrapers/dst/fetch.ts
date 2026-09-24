/**
 * The one HTML fetch every DST source uses.
 *
 * Each source used to carry its own copy: one attempt, 30-second timeout.
 * dst.gov.in is slow and uneven -- on 2026-09-24 two runs an hour apart
 * returned 685 and 321 documents, the second losing most of dst-core and all
 * of dst-calls to "The operation was aborted due to timeout" -- which is the
 * same swing the daily CI runs showed (692 / 318 / 18). So a failed page
 * gets one retry.
 *
 * But only while the site is otherwise answering. When dst.gov.in is down in
 * earnest, retrying every page just multiplies the wait: a run with three
 * attempts per page hit a 40-minute cap the same afternoon without finishing.
 * After CIRCUIT_BREAK consecutive failures, further pages get a single short
 * attempt until one succeeds again, so a bad day costs minutes, not the job.
 *
 * The thrown message keeps the "HTTP <status> fetching <url>" shape that
 * lib/sync.ts matches as DST's blocked marker.
 */

// 90s: dst.gov.in's archive-call-for-proposals took 75s to answer on 2026-09-24.
const TIMEOUT_MS = 90_000;
const DEGRADED_TIMEOUT_MS = 15_000;
const RETRY_PAUSE_MS = 5_000;
const CIRCUIT_BREAK = 3;

let consecutiveFailures = 0;

async function attempt(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} fetching ${url}`), { status: res.status });
  return res.text();
}

export async function fetchHtml(url: string, headers: Record<string, string>): Promise<string> {
  const degraded = consecutiveFailures >= CIRCUIT_BREAK;
  const tries = degraded ? 1 : 2;
  let lastError: Error | null = null;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    try {
      const html = await attempt(url, headers, degraded ? DEGRADED_TIMEOUT_MS : TIMEOUT_MS);
      consecutiveFailures = 0;
      return html;
    } catch (err) {
      lastError = err as Error;
      if ((err as { status?: number }).status === 404) break; // retrying a missing page will not help
    }
  }
  consecutiveFailures++;
  throw lastError ?? new Error(`failed fetching ${url}`);
}
