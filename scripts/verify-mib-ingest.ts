/**
 * Real SQL verification of the MIB ingestion.
 *
 * Follows verify-mtcte-ingest.ts, with two additions the MIB pass called for:
 *   - the duplicate sourceId check runs GLOBALLY (across all regulators),
 *     not just within MIB, so a collision between regulators would surface
 *     rather than hide behind a per-regulator GROUP BY;
 *   - a per-regulator totals table and a review-reason breakdown, so the
 *     flagged count is explainable rather than just a number.
 *
 * Everything here is a real query against Postgres -- no exit codes or
 * pipeline logs are trusted as evidence of what actually landed.
 *
 * Usage: npx tsx scripts/verify-mib-ingest.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

function n(v: bigint): number {
  return Number(v);
}

async function main() {
  const regulator = await prisma.regulator.findUnique({ where: { code: "MIB" } });
  if (!regulator) throw new Error("MIB regulator not found -- run prisma/seed-mib.ts first.");
  console.log("MIB regulator id:", regulator.id);

  // -- 1. MIB totals -------------------------------------------------------
  const totals = await prisma.$queryRaw<{ sourceDocs: bigint; entries: bigint }[]>`
    SELECT
      (SELECT COUNT(*)::bigint FROM "SourceDocument" WHERE "regulatorId" = ${regulator.id}) AS "sourceDocs",
      (SELECT COUNT(*)::bigint FROM "UpdateEntry" ue
         JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
        WHERE sd."regulatorId" = ${regulator.id}) AS entries
  `;
  console.log("\n-- MIB totals --");
  console.log(`SourceDocument rows: ${n(totals[0].sourceDocs)}`);
  console.log(`UpdateEntry rows:    ${n(totals[0].entries)}`);

  // -- 2. needsReview breakdown -------------------------------------------
  const byReview = await prisma.$queryRaw<{ needsReview: boolean; count: bigint }[]>`
    SELECT ue."needsReview", COUNT(*)::bigint AS count
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    WHERE sd."regulatorId" = ${regulator.id}
    GROUP BY ue."needsReview"
    ORDER BY ue."needsReview"
  `;
  console.log("\n-- MIB needsReview breakdown --");
  console.table(byReview.map((r) => ({ needsReview: r.needsReview, count: n(r.count) })));

  // -- 3. review reasons ---------------------------------------------------
  const reasons = await prisma.$queryRaw<{ reason: string; count: bigint }[]>`
    SELECT reason, COUNT(*)::bigint AS count
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    CROSS JOIN LATERAL unnest(ue."reviewReasons") AS reason
    WHERE sd."regulatorId" = ${regulator.id}
    GROUP BY reason
    ORDER BY COUNT(*) DESC
  `;
  console.log("\n-- MIB review reasons (real counts) --");
  if (reasons.length === 0) console.log("(none -- nothing flagged)");
  else console.table(reasons.map((r) => ({ reason: r.reason, count: n(r.count) })));

  // -- 4. duplicate sourceId check, GLOBAL --------------------------------
  // Grouped by (regulatorId, sourceId) because that pair is the real unique
  // constraint; also checked across regulators below.
  const dupWithinRegulator = await prisma.$queryRaw<
    { code: string; sourceId: string; count: bigint }[]
  >`
    SELECT r.code, sd."sourceId", COUNT(*)::bigint AS count
    FROM "SourceDocument" sd
    JOIN "Regulator" r ON r.id = sd."regulatorId"
    GROUP BY r.code, sd."sourceId"
    HAVING COUNT(*) > 1
  `;
  console.log("\n-- Duplicate (regulator, sourceId) across ALL regulators (should be empty) --");
  console.log(
    dupWithinRegulator.length === 0
      ? "0 duplicates"
      : JSON.stringify(
          dupWithinRegulator.map((d) => ({ ...d, count: n(d.count) })),
          null,
          2
        )
  );

  const dupAcrossRegulators = await prisma.$queryRaw<
    { sourceId: string; regulators: string; count: bigint }[]
  >`
    SELECT sd."sourceId", string_agg(DISTINCT r.code, ',') AS regulators, COUNT(*)::bigint AS count
    FROM "SourceDocument" sd
    JOIN "Regulator" r ON r.id = sd."regulatorId"
    GROUP BY sd."sourceId"
    HAVING COUNT(DISTINCT sd."regulatorId") > 1
  `;
  console.log("\n-- Same sourceId reused by DIFFERENT regulators (informational) --");
  console.log(
    dupAcrossRegulators.length === 0
      ? "0 cross-regulator sourceId collisions"
      : JSON.stringify(
          dupAcrossRegulators.map((d) => ({ ...d, count: n(d.count) })),
          null,
          2
        )
  );

  // -- 5. all-regulator totals --------------------------------------------
  const all = await prisma.$queryRaw<
    { code: string; docs: bigint; entries: bigint; flagged: bigint; published: bigint }[]
  >`
    SELECT r.code,
           COUNT(DISTINCT sd.id)::bigint AS docs,
           COUNT(ue.id)::bigint AS entries,
           COUNT(ue.id) FILTER (WHERE ue."needsReview")::bigint AS flagged,
           COUNT(ue.id) FILTER (WHERE NOT ue."needsReview")::bigint AS published
    FROM "Regulator" r
    LEFT JOIN "SourceDocument" sd ON sd."regulatorId" = r.id
    LEFT JOIN "UpdateEntry" ue ON ue."sourceDocumentId" = sd.id
    GROUP BY r.code
    ORDER BY r.code
  `;
  console.log("\n-- All regulators --");
  console.table(
    all.map((r) => ({
      code: r.code,
      docs: n(r.docs),
      entries: n(r.entries),
      published: n(r.published),
      flagged: n(r.flagged),
    }))
  );

  // -- 6. MIB subject distribution ----------------------------------------
  const bySubject = await prisma.$queryRaw<{ subject: string | null; count: bigint }[]>`
    SELECT subj.name AS subject, COUNT(*)::bigint AS count
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    LEFT JOIN "TaxonomyTag" subj ON subj.id = ue."subjectId"
    WHERE sd."regulatorId" = ${regulator.id}
    GROUP BY subj.name
    ORDER BY COUNT(*) DESC
  `;
  console.log("\n-- MIB documents per Subject tag (real ingested distribution) --");
  console.table(bySubject.map((r) => ({ subject: r.subject ?? "(untagged)", count: n(r.count) })));

  // -- 7. sample of real tagged rows --------------------------------------
  const sample = await prisma.$queryRaw<
    {
      documentCode: string;
      title: string;
      publishedDate: Date | null;
      fileUrl: string | null;
      status: string;
      needsReview: boolean;
      subject: string | null;
      instrumentType: string | null;
      confidence: number | null;
    }[]
  >`
    SELECT ue."documentCode", ue.title, sd."publishedDate", sd."fileUrl",
           ue.status::text, ue."needsReview",
           subj.name AS subject, instr.name AS "instrumentType",
           ue."subjectConfidence" AS confidence
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    LEFT JOIN "TaxonomyTag" subj ON subj.id = ue."subjectId"
    LEFT JOIN "TaxonomyTag" instr ON instr.id = ue."instrumentTypeId"
    WHERE sd."regulatorId" = ${regulator.id}
    ORDER BY sd."publishedDate" DESC NULLS LAST
    LIMIT 8
  `;
  console.log("\n-- Sample of 8 real MIB rows (most recent first) --");
  for (const s of sample) {
    console.log(`\n  ${s.documentCode}  [${s.needsReview ? "FLAGGED" : "published"}]`);
    console.log(`    title:      ${s.title.slice(0, 95)}`);
    console.log(`    published:  ${s.publishedDate ? s.publishedDate.toISOString().slice(0, 10) : "(none)"}`);
    console.log(`    subject:    ${s.subject ?? "(untagged)"}`);
    console.log(`    instrument: ${s.instrumentType ?? "(untagged)"}`);
    console.log(`    status:     ${s.status}  confidence: ${s.confidence ?? "n/a"}`);
    console.log(`    file:       ${s.fileUrl ? s.fileUrl.slice(0, 95) : "(none)"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
