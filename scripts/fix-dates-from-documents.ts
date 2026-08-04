/**
 * Resolves DoT publication dates from the DOCUMENT TEXT rather than from the
 * listing metadata.
 *
 * WHY THIS EXISTS
 * ---------------
 * DoT's listing gives slash/dot-separated dates whose day/month order is
 * genuinely ambiguous: 218 of 581 real rows parse validly BOTH ways, and both
 * orders demonstrably occur within the same category, so no metadata-only
 * heuristic can resolve them. 34 rows landed in the future as a result.
 *
 * WHAT THE REAL DOCUMENTS CONTAIN (confirmed by dumping real PDF text,
 * 2026-08-03): DoT letters carry an explicit issue date in the letterhead
 * block, on its own line, in the form
 *
 *     Dated: 09-06-2026
 *
 * Two real samples proved the stored dates were day/month-swapped:
 *   stored 2026-09-06 vs letterhead "Dated: 09-06-2026" (real: 9 June 2026)
 *   stored 2026-08-05 vs letterhead "Dated: 08-05-2026" (real: 8 May 2026)
 *
 * EXTRACTION RULE
 * ---------------
 * Only the LETTERHEAD date is used: capital "Dated", optional colon, on its
 * own line, within the first part of the document. This deliberately does
 * NOT match the lowercase inline references ("...bearing no. X, dated
 * 12.08.2015...") that point at OTHER documents (the licence being revoked),
 * which are extremely common in these letters and would otherwise poison the
 * result. It also does not match file reference numbers such as
 * "F. No. 821/280/2015-DS" or "4-10/2025".
 *
 * WHY NOT JUST FORCE DD-MM-YYYY EVERYWHERE
 * ----------------------------------------
 * Because dot_master.csv is NOT raw source -- dot_watcher.py already
 * converted a subset to MM/DD during scraping. Real proof (2026-08-03): 134
 * rows have a second component > 12 (e.g. "07/28/2026"), which cannot be
 * DD/MM, and one of them sits on a row whose own title reads "Order dated
 * 27-07-2026". So the file genuinely contains BOTH orders and a blanket
 * DD/MM reparse would corrupt the 134 that are legitimately MM/DD.
 *
 * Crucially, those 134 are ALREADY CORRECT in Postgres: the adapter tries
 * %m/%d first, which succeeds and is right for them. The 228 rows whose
 * FIRST component > 12 are also already correct (%m/%d fails, %d/%m wins).
 * The only genuinely broken set is the 218 rows where both readings parse
 * and the adapter silently picked MM/DD. This script targets exactly those.
 *
 * DISAMBIGUATION SIGNALS, in priority order
 * -----------------------------------------
 *  1. TITLE-EMBEDDED DATE. Many DoT titles state the date outright ("Order
 *     dated 27-07-2026"). Used only when it matches one of the two readings
 *     of the stored date exactly -- a title date that matches neither is
 *     referring to a DIFFERENT document (e.g. "licence ... dated 12.08.2015",
 *     the licence being revoked) and is ignored rather than trusted.
 *  2. PDF LETTERHEAD "Dated:" line (see above).
 *  3. FUTURE-DATE SANITY. A publication date cannot be in the future, so if
 *     the stored reading is in the future and the swap is not, swap it.
 *
 * Anything none of the three can settle is LEFT ALONE and keeps its
 * "unverified date" badge in the UI. Guessing is not a resolution.
 *
 * SAFETY
 * ------
 * Dry-run by default: it reports what it WOULD change and writes nothing.
 * Pass --apply to persist. Only SourceDocument.publishedDate is ever written;
 * no classification, tag, or review state is touched.
 *
 * Usage:
 *   npx tsx scripts/fix-dates-from-documents.ts --scope future --limit 40
 *   npx tsx scripts/fix-dates-from-documents.ts --scope ambiguous --apply
 */

import "dotenv/config";
import { PDFParse } from "pdf-parse";
import { prisma } from "../lib/prisma";
import { resolveDate, type Signal } from "../lib/date-resolution";

const APPLY = process.argv.includes("--apply");

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SCOPE = argValue("--scope", "future"); // future | ambiguous | all
const LIMIT = Number(argValue("--limit", "0")); // 0 = no limit
const CONCURRENCY = 6;

function iso(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "(none)";
}

async function main() {
  let where = "";
  if (SCOPE === "future") {
    where = `AND sd."publishedDate" > NOW()`;
  } else if (SCOPE === "ambiguous") {
    // Both day and month <= 12 -> the stored value could legitimately be
    // either reading, so the document is the only way to know.
    where = `AND EXTRACT(DAY FROM sd."publishedDate") <= 12
             AND EXTRACT(MONTH FROM sd."publishedDate") <= 12`;
  }

  const docs = await prisma.$queryRawUnsafe<
    { id: string; title: string; fileUrl: string; published: Date | null }[]
  >(`
    SELECT sd.id, sd.title, sd."fileUrl", sd."publishedDate" AS published
    FROM "SourceDocument" sd
    JOIN "Regulator" r ON r.id = sd."regulatorId"
    WHERE r.code = 'DOT' AND sd."fileUrl" IS NOT NULL ${where}
    ORDER BY sd."publishedDate" DESC
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}
  `);

  console.log(`scope=${SCOPE}  candidates=${docs.length}  mode=${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const stats = {
    checked: 0,
    confirmedCorrect: 0,
    corrected: 0,
    unresolved: 0,
    fetchFailed: 0,
    bySignal: { title: 0, letterhead: 0, future_sanity: 0 } as Record<Signal, number>,
  };
  const changes: { title: string; from: string; to: string; signal: Signal; evidence: string }[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < docs.length) {
      const d = docs[cursor++];
      stats.checked++;
      if (!d.published) continue;

      // The title signal is free; only pay for the PDF if the title cannot
      // settle it.
      let resolved = resolveDate(d.published, d.title, null);
      if (!resolved) {
        let text: string | null = null;
        try {
          const res = await fetch(d.fileUrl);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            text = (await new PDFParse({ data: buf }).getText()).text || null;
          } else {
            stats.fetchFailed++;
          }
        } catch {
          stats.fetchFailed++;
        }
        resolved = resolveDate(d.published, d.title, text);
      }

      if (!resolved) {
        stats.unresolved++;
        continue;
      }
      stats.bySignal[resolved.signal]++;

      const before = iso(d.published);
      const after = iso(resolved.date);
      if (before === after) {
        stats.confirmedCorrect++;
        continue;
      }
      stats.corrected++;
      changes.push({
        title: d.title,
        from: before,
        to: after,
        signal: resolved.signal,
        evidence: resolved.evidence,
      });

      if (APPLY) {
        await prisma.sourceDocument.update({
          where: { id: d.id },
          data: { publishedDate: resolved.date },
        });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("--- corrections ---");
  for (const c of changes.slice(0, 50)) {
    console.log(`  ${c.from} -> ${c.to}  (${c.signal})  "${c.evidence.slice(0, 34)}"  ${c.title.slice(0, 44)}`);
  }
  if (changes.length > 50) console.log(`  ... and ${changes.length - 50} more`);

  console.log("\n" + "=".repeat(66));
  console.log(`checked:                       ${stats.checked}`);
  console.log(`corrected${APPLY ? " (WRITTEN)" : " (dry run)"}:${APPLY ? "            " : "           "}${stats.corrected}`);
  console.log(`confirmed already correct:     ${stats.confirmedCorrect}`);
  console.log(`unresolved (left alone):       ${stats.unresolved}`);
  console.log(`fetch/parse failures:          ${stats.fetchFailed}`);
  console.log(`  by signal -> title: ${stats.bySignal.title}  letterhead: ${stats.bySignal.letterhead}  future-sanity: ${stats.bySignal.future_sanity}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
