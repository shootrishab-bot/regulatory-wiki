import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const regulator = await prisma.regulator.findUnique({ where: { code: "MTCTE" } });
  if (!regulator) throw new Error("MTCTE regulator not found");
  console.log("Regulator id:", regulator.id);

  const sourceDocCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint as count FROM "SourceDocument" WHERE "regulatorId" = ${regulator.id}
  `;
  console.log("\n-- Total SourceDocument rows for MTCTE --");
  console.log(sourceDocCount[0].count.toString());

  const updateEntryCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint as count
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    WHERE sd."regulatorId" = ${regulator.id}
  `;
  console.log("\n-- Total UpdateEntry rows for MTCTE --");
  console.log(updateEntryCount[0].count.toString());

  const byNeedsReview = await prisma.$queryRaw<{ needsReview: boolean; count: bigint }[]>`
    SELECT ue."needsReview", COUNT(*)::bigint as count
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    WHERE sd."regulatorId" = ${regulator.id}
    GROUP BY ue."needsReview"
  `;
  console.log("\n-- UpdateEntry count by needsReview --");
  console.log(byNeedsReview.map((r) => ({ needsReview: r.needsReview, count: r.count.toString() })));

  const dupSourceIds = await prisma.$queryRaw<{ sourceId: string; count: bigint }[]>`
    SELECT "sourceId", COUNT(*)::bigint as count
    FROM "SourceDocument"
    WHERE "regulatorId" = ${regulator.id}
    GROUP BY "sourceId"
    HAVING COUNT(*) > 1
  `;
  console.log("\n-- Duplicate sourceId check (should be empty) --");
  console.log(dupSourceIds.map((r) => ({ sourceId: r.sourceId, count: r.count.toString() })));

  const sample = await prisma.$queryRaw<
    {
      sourceId: string;
      title: string;
      fileUrl: string | null;
      status: string;
      needsReview: boolean;
      reviewReasons: string[];
      subject: string | null;
      instrumentType: string | null;
      confidence: number | null;
    }[]
  >`
    SELECT
      sd."sourceId",
      ue.title,
      sd."fileUrl",
      ue.status,
      ue."needsReview",
      ue."reviewReasons",
      subj.name as subject,
      instr.name as "instrumentType",
      ue."subjectConfidence" as confidence
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    LEFT JOIN "TaxonomyTag" subj ON subj.id = ue."subjectId"
    LEFT JOIN "TaxonomyTag" instr ON instr.id = ue."instrumentTypeId"
    WHERE sd."regulatorId" = ${regulator.id}
    ORDER BY ue."createdAt" ASC
    LIMIT 5
  `;
  console.log("\n-- Sample of up to 5 real ingested rows with tags --");
  console.log(JSON.stringify(sample, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
