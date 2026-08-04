/**
 * Prints the real current DB state of a single UpdateEntry by id.
 * Used to prove an admin correction actually persisted to Postgres, rather
 * than inferring it from a page re-render.
 *
 * Usage: npx tsx scripts/show-entry.ts <entryId>
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Pass an UpdateEntry id as the first argument.");

  const rows = await prisma.$queryRaw<
    {
      id: string;
      title: string;
      needsReview: boolean;
      reviewReasons: string[];
      classifiedBy: string | null;
      classificationReason: string | null;
      subject: string | null;
      instrumentType: string | null;
      updatedAt: Date;
    }[]
  >`
    SELECT ue.id, ue.title, ue."needsReview", ue."reviewReasons",
           ue."classifiedBy", ue."classificationReason",
           subj.name AS subject, instr.name AS "instrumentType",
           ue."updatedAt"
    FROM "UpdateEntry" ue
    LEFT JOIN "TaxonomyTag" subj ON subj.id = ue."subjectId"
    LEFT JOIN "TaxonomyTag" instr ON instr.id = ue."instrumentTypeId"
    WHERE ue.id = ${id}
  `;

  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
