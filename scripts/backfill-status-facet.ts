/**
 * One-off backfill: maps every existing UpdateEntry's old DocumentStatus
 * enum value onto the new per-regulator STATUS TaxonomyTag row with the
 * matching name (seeded by seedStandardStatusTags() -- see
 * prisma/seed-shared.ts), setting statusId.
 *
 * Single raw SQL UPDATE rather than a per-row loop: this is a straight
 * enum-name-to-tag-name join across every regulator at once, correct and
 * fast either way, no need for row-by-row TypeScript.
 *
 * Safe to re-run: only touches rows where statusId IS NULL.
 *
 * Run with:
 *   npx tsx scripts/backfill-status-facet.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const before = await prisma.updateEntry.count({ where: { statusId: null } });
  console.log(`Rows with statusId IS NULL before backfill: ${before}`);

  const updated = await prisma.$executeRaw`
    UPDATE "UpdateEntry" ue
    SET "statusId" = tt.id
    FROM "SourceDocument" sd, "TaxonomyTag" tt
    WHERE ue."sourceDocumentId" = sd.id
      AND tt."regulatorId" = sd."regulatorId"
      AND tt.facet = 'STATUS'
      AND tt.name = CASE ue.status
        WHEN 'IN_FORCE' THEN 'In Force'
        WHEN 'DRAFT_CONSULTATION' THEN 'Draft / Under Consultation'
        WHEN 'AMENDED' THEN 'Amended'
        WHEN 'SUPERSEDED_REPEALED' THEN 'Superseded / Repealed'
      END
      AND ue."statusId" IS NULL
  `;
  console.log(`Rows updated: ${updated}`);

  const after = await prisma.updateEntry.count({ where: { statusId: null } });
  console.log(`Rows with statusId IS NULL after backfill: ${after}`);

  if (after > 0) {
    // Real diagnostic rather than a silent partial success -- surface which
    // regulator(s) still have unmapped rows so the mismatch (missing Status
    // tag? a regulator with no STATUS facet seeded yet?) is easy to find.
    const remaining = await prisma.$queryRaw<{ code: string; status: string; count: bigint }[]>`
      SELECT r.code, ue.status::text, COUNT(*)::bigint AS count
      FROM "UpdateEntry" ue
      JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
      JOIN "Regulator" r ON r.id = sd."regulatorId"
      WHERE ue."statusId" IS NULL
      GROUP BY r.code, ue.status
      ORDER BY r.code
    `;
    console.log("Unmapped rows by regulator/status:", remaining);
    throw new Error(`${after} rows could not be backfilled -- see breakdown above.`);
  }

  console.log("Backfill complete: every UpdateEntry now has a real statusId.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
