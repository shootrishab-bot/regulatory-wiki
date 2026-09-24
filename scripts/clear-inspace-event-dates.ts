/**
 * Clears the publishedDate on already-ingested IN-SPACe EVENTS rows.
 *
 * WHY THIS EXISTS
 * ---------------
 * dos_isro_scraper.py's parse_inspace_events() used to store an event's END
 * date as its published_date. An event's date range is when the event
 * HAPPENS, which is not a publication date -- and for any event that has not
 * finished yet it lands in the FUTURE, which is impossible for a published
 * document. One real row in the corpus was affected:
 *
 *   "FICCI Business Mission to World Space Business Week (WSBW) & Space
 *    Defence & Security Summit (SDSS) 2026"  ->  stored 2026-09-17
 *
 * It rendered on the public home page with the UI's "unverified date" badge
 * (components/entry-list.tsx), which is the badge working correctly -- the
 * defect was upstream, in treating an event date as a publication date.
 *
 * The scraper is fixed, but a scraper fix alone does not touch rows already
 * in Postgres, and re-running the full sync requires live HTTP against
 * inspace.gov.in. This script corrects the stored rows directly.
 *
 * WHICH ROWS
 * ----------
 * Identified by evidence, not by guessing from the URL shape: the ids come
 * from the scraper's own normalized output (scrapers/data/
 * dos_isro_normalized.json), taking exactly the records whose category_hint
 * is INSPACE_EVENTS, then matched to Postgres on SourceDocument.sourceId.
 * No date is invented and nothing but publishedDate is ever written -- the
 * event's real date range remains in the scraper's master CSV
 * (published_date_raw).
 *
 * SAFETY
 * ------
 * Dry-run by default: reports what it WOULD change and writes nothing. Pass
 * --apply to persist. Same convention as
 * scripts/fix-dates-from-documents.ts.
 *
 * Usage:
 *   npx tsx scripts/clear-inspace-event-dates.ts
 *   npx tsx scripts/clear-inspace-event-dates.ts --apply
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";

const APPLY = process.argv.includes("--apply");

const REGULATOR_CODE = "DOS-ISRO";
const EVENTS_CATEGORY = "INSPACE_EVENTS";
const NORMALIZED_PATH = path.join(
  process.cwd(),
  "scrapers",
  "data",
  "dos_isro_normalized.json"
);

type NormalizedRow = {
  source_id: string;
  title: string;
  category_hint: string | null;
};

async function main() {
  const rows: NormalizedRow[] = JSON.parse(readFileSync(NORMALIZED_PATH, "utf8"));
  const eventSourceIds = rows
    .filter((r) => r.category_hint === EVENTS_CATEGORY)
    .map((r) => r.source_id);

  console.log(
    `${eventSourceIds.length} ${EVENTS_CATEGORY} records in the scraper output  ` +
      `mode=${APPLY ? "APPLY" : "DRY RUN"}\n`
  );

  if (eventSourceIds.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Only rows that actually still carry a date need touching, so the report
  // states real changes rather than a count of rows examined.
  const affected = await prisma.sourceDocument.findMany({
    where: {
      regulator: { code: REGULATOR_CODE },
      sourceId: { in: eventSourceIds },
      publishedDate: { not: null },
    },
    select: { id: true, title: true, publishedDate: true },
    orderBy: { publishedDate: "desc" },
  });

  if (affected.length === 0) {
    console.log("No ingested event row still carries a publishedDate. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  for (const d of affected) {
    const iso = d.publishedDate?.toISOString().slice(0, 10) ?? "(none)";
    console.log(`  ${iso} -> (none)   ${d.title.slice(0, 90)}`);
  }

  if (!APPLY) {
    console.log(`\n${affected.length} row(s) would be cleared. Re-run with --apply to persist.`);
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.sourceDocument.updateMany({
    where: { id: { in: affected.map((d) => d.id) } },
    data: { publishedDate: null },
  });

  console.log(`\nCleared publishedDate on ${result.count} row(s).`);
  await prisma.$disconnect();
}

main();
