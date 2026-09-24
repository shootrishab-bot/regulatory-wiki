/**
 * Moves publishedDate values that were stored at IST midnight back onto the
 * UTC midnight of the day they meant.
 *
 * WHY THIS EXISTS
 * ---------------
 * mib_adapter.py used to pass month-only dates through raw ("May-2025" for
 * e-books and handbooks). ingest.ts then ran `new Date("May-2025")`, which
 * JavaScript reads as LOCAL midnight. The ingest ran on an IST machine, so
 * the row was stored as 2025-04-30T18:30:00Z and the site showed it as
 * 30 April 2025 -- the wrong month. Every other date in the corpus is an ISO
 * YYYY-MM-DD string, which JavaScript reads as UTC midnight, so a stored
 * time of exactly 18:30 UTC is the signature of this bug and nothing else.
 * Found 2026-09-24: 43 MIB rows, no other regulator.
 *
 * The adapter now writes these as YYYY-MM-01, so new rows are stored
 * correctly; this corrects the rows already in Postgres.
 *
 * WHICH ROWS
 * ----------
 * Exactly those whose publishedDate is 18:30:00.000 UTC. Each moves forward
 * 5h30m to 00:00 UTC of the next calendar day, which is the date the source
 * meant. Nothing but publishedDate is written, and the old value is printed.
 *
 * SAFETY
 * ------
 * Dry-run by default. Pass --apply to write. Same convention as
 * scripts/clear-inspace-event-dates.ts.
 *
 * Usage:
 *   npx tsx scripts/fix-local-midnight-dates.ts
 *   npx tsx scripts/fix-local-midnight-dates.ts --apply
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.sourceDocument.findMany({
    where: { publishedDate: { not: null } },
    select: { id: true, title: true, publishedDate: true, regulator: { select: { code: true } } },
  });

  const shifted = rows.filter((r) => {
    const d = r.publishedDate!;
    return d.getUTCHours() === 18 && d.getUTCMinutes() === 30 && d.getUTCSeconds() === 0;
  });

  console.log(`${shifted.length} rows stored at IST midnight  mode=${apply ? "APPLY" : "DRY RUN"}\n`);
  for (const r of shifted) {
    const fixed = new Date(r.publishedDate!.getTime() + IST_OFFSET_MS);
    console.log(
      `  ${r.regulator.code.padEnd(8)} ${r.publishedDate!.toISOString()} -> ${fixed.toISOString().slice(0, 10)}  ${r.title.slice(0, 60)}`
    );
    if (apply) {
      await prisma.sourceDocument.update({ where: { id: r.id }, data: { publishedDate: fixed } });
    }
  }

  if (!apply && shifted.length) console.log("\nDry run: nothing written. Re-run with --apply.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
