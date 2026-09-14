/**
 * Deletes every ingested document for one regulator, leaving its taxonomy
 * (and the Regulator/Domain rows) intact.
 *
 * Built for the taxonomy-test loop: classify a random sample against vN,
 * read the results, revise the taxonomy, then re-classify THE SAME sample
 * against vN+1 and compare. Without this the second pass is a no-op, because
 * lib/ingest.ts dedups on (regulatorId, sourceId) and skips everything.
 *
 * Deliberately scoped to one regulator and deliberately not wired into any
 * scheduled path -- it is destructive, and the only safe caller is a human
 * running a deliberate re-test.
 *
 * Usage:
 *   npx tsx scripts/reset-regulator-documents.ts MERC
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const code = process.argv[2];
  if (!code) {
    console.error("usage: tsx scripts/reset-regulator-documents.ts <REGULATOR_CODE>");
    process.exit(1);
  }

  const regulator = await prisma.regulator.findUnique({ where: { code } });
  if (!regulator) throw new Error(`No regulator with code "${code}".`);

  const documents = await prisma.sourceDocument.findMany({
    where: { regulatorId: regulator.id },
    select: { id: true },
  });
  const documentIds = documents.map((d) => d.id);

  const entries = await prisma.updateEntry.findMany({
    where: { sourceDocumentId: { in: documentIds } },
    select: { id: true },
  });
  const entryIds = entries.map((e) => e.id);

  // Ordered by foreign key: the three join/edge tables reference UpdateEntry,
  // which references SourceDocument. Prisma has no cascade configured on these
  // relations, so a bare deleteMany on SourceDocument fails on the constraint.
  await prisma.entryRelationship.deleteMany({ where: { fromEntryId: { in: entryIds } } });
  await prisma.entryApplicability.deleteMany({ where: { updateEntryId: { in: entryIds } } });
  await prisma.entryLicenseAuthorisationType.deleteMany({ where: { updateEntryId: { in: entryIds } } });
  await prisma.updateEntry.deleteMany({ where: { id: { in: entryIds } } });
  await prisma.sourceDocument.deleteMany({ where: { id: { in: documentIds } } });

  console.log(`Deleted ${entryIds.length} update entries and ${documentIds.length} source documents for ${code}.`);
  console.log(`${code}'s taxonomy tags were left untouched.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
