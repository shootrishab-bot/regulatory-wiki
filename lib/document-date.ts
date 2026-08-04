/**
 * Extracts the real ISSUE date out of a regulatory document's own text.
 *
 * WHY: 167 documents reached Postgres with no publishedDate at all, because
 * their source listing never exposed one -- notably ALL 151 MTCTE documents,
 * whose listing has no date column. The date is nonetheless printed on the
 * document itself.
 *
 * THE HARD PART is not finding "a date", it is finding the RIGHT one. Real
 * OCR output from one MTCTE notification contained three date-like strings:
 *
 *     No. 5-5/2021-TC/TEC   Dated: 03.07.2023 ... extended upto 31.12.2023
 *          ^ file reference       ^ issue date          ^ validity deadline
 *
 * and a text-layer sample contained references to OTHER documents:
 *
 *     "In continuation to this office letter No. 5-5/2024-TC/TEC dated
 *      26.06.2025 and addendum dated 16.10.2025"
 *
 * So a bare date regex would confidently return the wrong answer. Extraction
 * therefore requires an explicit "Date:"/"Dated:" anchor, prefers the
 * capitalised header form, and only looks at the document's opening region
 * where the letterhead lives -- the same discipline the DoT letterhead work
 * arrived at.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE =
  "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** Only the opening region carries the letterhead; later text cites others. */
const HEADER_CHARS = 1600;

/** Regulatory documents older than this are not plausible for these feeds. */
const MIN_YEAR = 1947;

export type DateForm = "month-name" | "numeric";

export interface ExtractedDate {
  date: Date;
  /** The exact substring the date was read from -- shown in reports. */
  evidence: string;
  form: DateForm;
  /** True when read from a capitalised "Date:"/"Dated:" header anchor. */
  strongAnchor: boolean;
}

function build(day: number, month: number, year: number, now: Date): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < MIN_YEAR) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers such as 31 Feb, which Date silently normalises.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  // A publication date cannot be in the future.
  if (d.getTime() > now.getTime()) return null;
  return d;
}

/** Two-digit years appear in OCR output; map them into a sane century. */
function normaliseYear(y: number): number {
  if (y >= 1000) return y;
  return y <= 79 ? 2000 + y : 1900 + y;
}

/**
 * `anchored` builds a regex requiring an explicit Date/Dated label before the
 * value, which is what separates the issue date from reference numbers and
 * validity deadlines.
 */
function anchored(body: string): RegExp {
  return new RegExp(`\\bDated?\\b\\s*[:\\-–]?\\s*${body}`, "gi");
}

const NUMERIC = "(\\d{1,2})\\s*[.\\-/]\\s*(\\d{1,2})\\s*[.\\-/]\\s*(\\d{2,4})";
const D_MONTH_Y = `(\\d{1,2})(?:st|nd|rd|th)?\\s*[.,\\-]?\\s*${MONTH_RE}\\s*[.,\\-]?\\s*(\\d{4})`;
const MONTH_D_Y = `${MONTH_RE}\\s*[.,\\-]?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*[.,]?\\s*(\\d{4})`;

/**
 * Reads the issue date out of document text (text layer or OCR output).
 *
 * Numeric dates are read DD-MM-YYYY: Indian regulators publish day-first, a
 * convention independently confirmed against real documents during the DoT
 * date rebuild (50 of 50 order-sensitive cases). Where DD-MM is impossible
 * (day > 12 in the month slot) the other order is accepted instead, since a
 * valid reading beats no reading.
 */
export function extractIssueDate(text: string, now = new Date()): ExtractedDate | null {
  if (!text) return null;
  const clean = text.replace(/[ \t ]+/g, " ");
  const header = clean.slice(0, HEADER_CHARS);

  // Month-name forms first: they are unambiguous by construction.
  for (const [pattern, order] of [
    [D_MONTH_Y, "dmy"],
    [MONTH_D_Y, "mdy"],
  ] as const) {
    for (const m of header.matchAll(anchored(pattern))) {
      const month = MONTHS[(order === "dmy" ? m[2] : m[1]).toLowerCase()];
      const day = Number(order === "dmy" ? m[1] : m[2]);
      const year = Number(m[3]);
      const d = build(day, month, year, now);
      if (d) {
        return { date: d, evidence: m[0].trim(), form: "month-name", strongAnchor: true };
      }
    }
  }

  // Numeric forms, still anchored.
  for (const m of header.matchAll(anchored(NUMERIC))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = normaliseYear(Number(m[3]));
    const ddmm = build(a, b, year, now);
    if (ddmm) return { date: ddmm, evidence: m[0].trim(), form: "numeric", strongAnchor: true };
    const mmdd = build(b, a, year, now);
    if (mmdd) return { date: mmdd, evidence: m[0].trim(), form: "numeric", strongAnchor: true };
  }

  // Deliberately no unanchored fallback. A bare date match in these documents
  // is far more likely to be a validity deadline or a citation of another
  // instrument than the issue date, and a wrong date is worse than none.
  return null;
}
