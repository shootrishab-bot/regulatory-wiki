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

/**
 * Default profile, tuned for a PAGE RENDER: a slow response is itself a
 * failure there, so it gives up quickly.
 */
const DELAYS_MS = [250, 1000, 3000];

/**
 * Profile for BATCH/BACKGROUND work, where waiting beats failing.
 *
 * Needed because of a real failure (2026-08-04): the daily sync ran the DoT
 * scraper for 30 minutes with no Postgres traffic at all, Neon's serverless
 * compute suspended in the meantime, and the first write afterwards exhausted
 * the page-render profile in under 5 seconds -- nowhere near long enough for
 * a cold start. Anything that follows a long gap in DB activity should pass
 * this instead.
 */
export const BATCH_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

function isTransientConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ("code" in err && (err as { code?: string }).code === "P1001") return true;
  return (
    err.message.includes("Can't reach database server") ||
    err.message.includes("Connection terminated unexpectedly") ||
    err.message.includes("Connection closed")
  );
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  label: string,
  delays: number[] = DELAYS_MS
): Promise<T> {
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientConnectionError(err) || attempt === delays.length) {
        throw err;
      }
      console.log(
        `[db-retry] ${label} hit a transient connection error, retry ${attempt + 1}/${delays.length} in ${delays[attempt]}ms`
      );
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw new Error("unreachable");
}
