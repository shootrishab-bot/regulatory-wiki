/**
 * Shared seeding helper: the "standard" 4-value STATUS facet every regulator
 * except DST uses (In Force / Draft / Under Consultation / Amended /
 * Superseded / Repealed), unscoped (statusAppliesToSubjectIds: [] means
 * "applies to every Subject" -- see schema.prisma's own comment on that
 * field). These 4 values are exactly what the old fixed DocumentStatus enum
 * meant; this just seeds them as real per-regulator TaxonomyTag rows instead
 * -- see the "add_status_facet" migration and its own schema.prisma comment
 * for why (DST needed a genuinely different vocabulary; the schema's former
 * Open Question #4 anticipated exactly this).
 *
 * Import and call this from every existing regulator's seed script, right
 * after that regulator is upserted. DST does NOT use this -- it seeds its
 * own 7-value, Subject-scoped Status vocabulary directly in seed-dst.ts.
 */

import { prisma } from "../lib/prisma";

export const STANDARD_STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "In Force", shortCode: "INF", definition: "The instrument is the current, legally/administratively operative version." },
  { name: "Draft / Under Consultation", shortCode: "DFT", definition: "Published for stakeholder comment, not yet finalised or operative." },
  { name: "Amended", shortCode: "AMD", definition: "The base instrument remains in force but has been modified by a subsequent document." },
  { name: "Superseded / Repealed", shortCode: "SUP", definition: "A later instrument has formally replaced this one; it is no longer operative." },
];

export async function seedStandardStatusTags(regulatorId: string, regulatorCode: string) {
  for (const tag of STANDARD_STATUS_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: { regulatorId, facet: "STATUS", name: tag.name },
      },
      update: { shortCode: tag.shortCode, definition: tag.definition },
      create: {
        regulatorId,
        facet: "STATUS",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: "v1.0",
        statusAppliesToSubjectIds: [], // applies to every Subject
      },
    });
    console.log(`  [${regulatorCode}] Status: ${tag.name}`);
  }
}
