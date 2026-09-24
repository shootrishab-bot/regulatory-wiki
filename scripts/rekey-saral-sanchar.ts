/**
 * Moves stored Saral Sanchar circulars onto the page-independent source_id.
 *
 * WHY THIS EXISTS
 * ---------------
 * scrapers/saral-sanchar/scrape.ts used to hash the listing PAGE URL
 * (".../circular-notifications-others?page=3") into each circular's
 * source_id. The feed is newest-first, so every new circular pushes the rest
 * down a slot; rows crossed page boundaries, came back with a new id, and the
 * sync ingested them again. On 2026-09-24 Postgres held 643 Saral Sanchar
 * rows for about 400 real documents: 244 extra copies.
 *
 * The scraper now keys circulars on the feed URL (no ?page=N) plus title and
 * file URL. Until the stored rows carry that same id, the next sync would see
 * every circular as new and ingest all ~360 of them once more. This script
 * gives them that id.
 *
 * WHAT IT DOES
 * ------------
 * For every stored row listed on either circulars feed, computes the new id
 * with the scraper's own makeSourceId()/circularsFeedUrl(), so the two cannot
 * drift apart. Rows that land on the same id are copies of one document: the
 * earliest-discovered keeps it (and its sourceUrl becomes the feed URL); the
 * others are reported and, by default, left exactly as they are, since they
 * still carry their old ids and no longer match anything the scraper emits.
 *
 * --delete-duplicates additionally deletes those copies and their entries.
 * That is irreversible and removes whatever review work was done on them, so
 * it is opt-in and meant to be run deliberately after reading the dry run.
 * Acts & Policies rows are not touched: that feed is one page, so its ids
 * never drifted.
 *
 * Usage:
 *   npx tsx scripts/rekey-saral-sanchar.ts                              # dry run
 *   npx tsx scripts/rekey-saral-sanchar.ts --apply                      # re-key only
 *   npx tsx scripts/rekey-saral-sanchar.ts --apply --delete-duplicates  # and delete copies
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { makeSourceId, circularsFeedUrl, REGULATOR_CODE } from "../scrapers/saral-sanchar/scrape";

const CIRCULAR_FEEDS = [
  "https://eservices.dot.gov.in/circular-notifications-others",
  "https://eservices.dot.gov.in/circular-notifications-others-archive",
];

async function main() {
  const apply = process.argv.includes("--apply");
  const deleteDuplicates = process.argv.includes("--delete-duplicates");

  const regulator = await prisma.regulator.findUnique({ where: { code: REGULATOR_CODE } });
  if (!regulator) throw new Error(`Regulator ${REGULATOR_CODE} not found`);

  const rows = await prisma.sourceDocument.findMany({
    where: { regulatorId: regulator.id },
    select: { id: true, sourceId: true, title: true, sourceUrl: true, fileUrl: true, discoveredAt: true },
    orderBy: { discoveredAt: "asc" },
  });

  const circulars = rows.filter((r) => CIRCULAR_FEEDS.includes(circularsFeedUrl(r.sourceUrl)));
  const groups = new Map<string, typeof circulars>();
  for (const r of circulars) {
    const feed = circularsFeedUrl(r.sourceUrl);
    const id = makeSourceId(REGULATOR_CODE, feed, `${r.title}|${r.fileUrl ?? ""}`);
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }

  const toRekey = [...groups.entries()].filter(([id, g]) => g[0].sourceId !== id);
  const copies = [...groups.values()].flatMap((g) => g.slice(1));
  console.log(
    `${rows.length} Saral Sanchar rows, ${circulars.length} circulars -> ${groups.size} documents. ` +
      `${toRekey.length} to re-key, ${copies.length} duplicate copies.  ` +
      `mode=${apply ? "APPLY" : "DRY RUN"}${deleteDuplicates ? " +DELETE DUPLICATES" : ""}\n`
  );

  if (apply) {
    for (const [id, g] of toRekey) {
      await prisma.sourceDocument.update({
        where: { id: g[0].id },
        data: { sourceId: id, sourceUrl: circularsFeedUrl(g[0].sourceUrl) },
      });
    }
    console.log(`re-keyed ${toRekey.length} rows`);
  }

  for (const c of copies.slice(0, 15)) console.log(`  copy  ${c.discoveredAt.toISOString().slice(0, 10)}  ${c.title.slice(0, 70)}`);
  if (copies.length > 15) console.log(`  ... and ${copies.length - 15} more`);

  if (apply && deleteDuplicates && copies.length) {
    const ids = copies.map((c) => c.id);
    const entryIds = (
      await prisma.updateEntry.findMany({ where: { sourceDocumentId: { in: ids } }, select: { id: true } })
    ).map((e) => e.id);
    // Same dependency order as scripts/reset-regulator-documents.ts: the
    // entry's child rows have no cascade, so they go first.
    await prisma.$transaction([
      prisma.entryRelationship.deleteMany({
        where: { OR: [{ fromEntryId: { in: entryIds } }, { toEntryId: { in: entryIds } }] },
      }),
      prisma.entryApplicability.deleteMany({ where: { updateEntryId: { in: entryIds } } }),
      prisma.entryLicenseAuthorisationType.deleteMany({ where: { updateEntryId: { in: entryIds } } }),
      prisma.updateEntry.deleteMany({ where: { id: { in: entryIds } } }),
      prisma.sourceDocument.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(`deleted ${ids.length} duplicate copies and their entries`);
  } else if (copies.length) {
    console.log(`\nCopies left in place.${apply ? "" : " Dry run: nothing written."} Re-run with --apply --delete-duplicates to remove them.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
