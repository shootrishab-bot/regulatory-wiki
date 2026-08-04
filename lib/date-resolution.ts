/**
 * Resolving the true publication date of a document whose stored date has an
 * ambiguous day/month order.
 *
 * Shared by scripts/fix-dates-from-documents.ts (evidence pass) and
 * scripts/apply-ddmm-convention.ts (convention fallback) so the two cannot
 * drift apart -- an earlier version had them as separate copies, and the
 * convention pass silently swapped BACK rows the evidence pass had already
 * verified, because a corrected DD-MM date is still "ambiguous" by shape.
 * Both now run evidence first, which makes the whole thing idempotent:
 * re-resolving an already-correct row returns the same absolute date rather
 * than another relative swap.
 */

/** Letterhead issue date: capital "Dated", on its own line. */
const LETTERHEAD_DATE =
  /^[^\S\r\n]*Dated[:\-]?[^\S\r\n]*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})[^\S\r\n]*$/m;

/** Any "dated DD-MM-YYYY" mention inside a title. */
const TITLE_DATE = /dated\s*:?\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/gi;

export function buildDate(day: number, month: number, year: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers like 31 Feb, which Date silently normalises.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/** The same digits read the other way round. */
export function swapDayMonth(d: Date): Date | null {
  return buildDate(d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCFullYear());
}

export type Signal = "title" | "letterhead" | "future_sanity";

export interface Resolution {
  date: Date;
  signal: Signal;
  evidence: string;
}

/**
 * Resolves the true publication date from real evidence, or returns null if
 * nothing settles it. Never guesses -- the convention fallback is a separate,
 * explicitly-named step.
 */
export function resolveDate(
  stored: Date,
  title: string,
  pdfText: string | null,
  now = new Date()
): Resolution | null {
  const swapped = swapDayMonth(stored);
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();

  // -- 1. title-embedded date --------------------------------------------
  // Trusted only when it equals one of the two candidate readings; a title
  // date matching neither refers to a DIFFERENT document (e.g. "licence ...
  // dated 12.08.2015", the licence being revoked).
  for (const m of title.matchAll(TITLE_DATE)) {
    const cand = buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!cand) continue;
    if (same(cand, stored)) return { date: stored, signal: "title", evidence: m[0] };
    if (swapped && same(cand, swapped)) return { date: swapped, signal: "title", evidence: m[0] };
  }

  // -- 2. PDF letterhead date --------------------------------------------
  if (pdfText) {
    const lm = pdfText.match(LETTERHEAD_DATE);
    if (lm) {
      const a = Number(lm[1]);
      const b = Number(lm[2]);
      const y = Number(lm[3]);
      const ddmm = buildDate(a, b, y);
      const mmdd = buildDate(b, a, y);
      const pick =
        ddmm && ddmm.getTime() <= now.getTime()
          ? ddmm
          : mmdd && mmdd.getTime() <= now.getTime()
            ? mmdd
            : null;
      if (pick) return { date: pick, signal: "letterhead", evidence: lm[0].trim() };
    }
  }

  // -- 3. future-date sanity ---------------------------------------------
  if (stored.getTime() > now.getTime() && swapped && swapped.getTime() <= now.getTime()) {
    return {
      date: swapped,
      signal: "future_sanity",
      evidence: `stored ${stored.toISOString().slice(0, 10)} is in the future`,
    };
  }

  return null;
}
