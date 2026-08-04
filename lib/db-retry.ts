/**
 * Retry wrapper for transient Neon connection failures.
 *
 * Same real failure mode already documented at length in lib/ingest.ts:
 * Neon's serverless compute auto-suspends after a period of inactivity, and
 * the pooled connection can be dropped or refused during its cold-start
 * wake-up. Confirmed hitting the WEB layer too (2026-08-02): a page load of
 * /admin/review failed outright with "Connection terminated unexpectedly"
 * raised from getTagOptions(), returning a 500 to the browser, after the app
 * had been idle while a long batch job ran. A plain reload immediately
 * afterwards succeeded -- a cold start, not a real outage.
 *
 * ingest.ts keeps its own private copy of this logic; it is deliberately not
 * refactored to import this one, because that file is the tested ingestion
 * hot path and this change is about the read/UI layer. If a third caller
 * ever needs it, collapse all three onto this module then.
 */

const DELAYS_MS = [250, 1000, 3000];

function isTransientConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ("code" in err && (err as { code?: string }).code === "P1001") return true;
  return (
    err.message.includes("Can't reach database server") ||
    err.message.includes("Connection terminated unexpectedly") ||
    err.message.includes("Connection closed")
  );
}

export async function withDbRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientConnectionError(err) || attempt === DELAYS_MS.length) {
        throw err;
      }
      // Shorter backoff than the ingestion path's 2s/5s/10s: this one runs
      // inside a page render, where a slow response is itself a failure.
      await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]));
      console.log(`[db-retry] ${label} hit a transient connection error, retry ${attempt + 1}`);
    }
  }
  throw new Error("unreachable");
}
