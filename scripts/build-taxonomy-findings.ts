/**
 * Exports the complete taxonomy audit findings to scripts/.audit/findings.json.
 *
 * This is the hand-off point between the live database and the two
 * human-facing artefacts. BOTH of these read findings.json and nothing else:
 *   - scripts/build-taxonomy-report.ts     -> taxonomy-canonical-concepts.md
 *   - scripts/build-taxonomy-workbook.py   -> taxonomy-canonical-concepts.xlsx
 *
 * They therefore cannot disagree: neither re-queries the database and neither
 * re-derives a mapping decision. Regenerate in order:
 *   npx tsx scripts/build-taxonomy-findings.ts
 *   npx tsx scripts/build-taxonomy-report.ts
 *   python scripts/build-taxonomy-workbook.py
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { writeFileSync, mkdirSync } from "fs";
import { CANONICAL_CONCEPTS, FALSE_COGNATES } from "./canonical-concepts.data";

const FACETS = ["SUBJECT", "INSTRUMENT_TYPE", "STATUS"] as const;

async function main() {
  const regulators = await prisma.regulator.findMany({
    include: { domain: true },
    orderBy: { code: "asc" },
  });

  // Live taxonomyVersion actually carried by real UpdateEntry rows, per
  // regulator. NOT read from any workbook -- this is the whole point of Step 1.
  const liveVersions = await prisma.$queryRawUnsafe<
    { regulator: string; version: string; entries: number }[]
  >(`
    SELECT rg.code AS regulator,
           COALESCE(ue."taxonomyVersion", '(none)') AS version,
           COUNT(*)::int AS entries
    FROM "UpdateEntry" ue
    JOIN "SourceDocument" sd ON sd.id = ue."sourceDocumentId"
    JOIN "Regulator" rg ON rg.id = sd."regulatorId"
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC
  `);

  // Real usage: how many UpdateEntry rows actually carry each tag.
  const tags = await prisma.$queryRawUnsafe<
    {
      regulator: string;
      facet: string;
      tag: string;
      short_code: string;
      tag_status: string;
      version_added: string | null;
      definition: string | null;
      notes: string | null;
      usage_count: number;
      concept: string | null;
    }[]
  >(`
    SELECT rg.code AS regulator,
           t.facet::text AS facet,
           t.name AS tag,
           t."shortCode" AS short_code,
           t.status::text AS tag_status,
           t."versionAdded" AS version_added,
           t.definition,
           t.notes,
           (SELECT COUNT(*) FROM "UpdateEntry" e WHERE e."subjectId" = t.id)::int
             + (SELECT COUNT(*) FROM "UpdateEntry" e WHERE e."instrumentTypeId" = t.id)::int
             + (SELECT COUNT(*) FROM "UpdateEntry" e WHERE e."statusId" = t.id)::int
             AS usage_count,
           cc.name AS concept
    FROM "TaxonomyTag" t
    JOIN "Regulator" rg ON rg.id = t."regulatorId"
    LEFT JOIN "CanonicalConcept" cc ON cc.id = t."canonicalConceptId"
    ORDER BY rg.code, t.facet, t.name
  `);

  // The concepts as they ACTUALLY exist in the database after Step 4, read
  // back rather than assumed from the data file.
  const concepts = await prisma.canonicalConcept.findMany({
    include: { tags: { include: { regulator: { select: { code: true } } } } },
    orderBy: [{ facet: "asc" }, { name: "asc" }],
  });

  // Cross-check: what the data file intended vs. what the database holds.
  const drift: string[] = [];
  for (const c of CANONICAL_CONCEPTS) {
    const row = concepts.find((r) => r.facet === c.facet && r.name === c.name);
    if (!row) {
      drift.push(`data file has "${c.name}" (${c.facet}) but the database does not`);
      continue;
    }
    const dbPairs = new Set(row.tags.map((t) => `${t.regulator.code}|${t.name}`));
    for (const [code, name] of Object.entries(c.tags)) {
      if (!dbPairs.has(`${code}|${name}`)) drift.push(`"${c.name}": ${code} / "${name}" not linked in the database`);
    }
    if (dbPairs.size !== Object.keys(c.tags).length) {
      drift.push(`"${c.name}": database has ${dbPairs.size} linked tags, data file declares ${Object.keys(c.tags).length}`);
    }
  }
  if (concepts.length !== CANONICAL_CONCEPTS.length) {
    drift.push(`database has ${concepts.length} concepts, data file declares ${CANONICAL_CONCEPTS.length}`);
  }
  if (drift.length) {
    console.error("REFUSING TO EXPORT — database and mapping data file disagree:");
    for (const d of drift) console.error("  - " + d);
    console.error("\nRun `npx tsx scripts/populate-canonical-concepts.ts` first.");
    process.exit(1);
  }

  // Exact cross-regulator name matches, computed from the REAL tag names.
  const exactMatches: Record<string, { name: string; regulators: string[]; mappedTo: string | null }[]> = {};
  for (const f of FACETS) {
    const byName = new Map<string, typeof tags>();
    for (const t of tags.filter((x) => x.facet === f)) {
      if (!byName.has(t.tag)) byName.set(t.tag, []);
      byName.get(t.tag)!.push(t);
    }
    exactMatches[f] = [...byName.entries()]
      .filter(([, rows]) => rows.length >= 2)
      .map(([name, rows]) => ({
        name,
        regulators: rows.map((r) => r.regulator).sort(),
        mappedTo: rows.find((r) => r.concept)?.concept ?? null,
      }))
      .sort((a, b) => b.regulators.length - a.regulators.length || a.name.localeCompare(b.name));
  }

  // Near-duplicates: a concept whose member tags do NOT all share one name.
  const nearDuplicates = CANONICAL_CONCEPTS.filter(
    (c) => new Set(Object.values(c.tags)).size > 1,
  ).map((c) => ({
    facet: c.facet,
    concept: c.name,
    definition: c.definition,
    notes: c.notes ?? null,
    variants: Object.entries(c.tags)
      .map(([code, name]) => ({
        regulator: code,
        tag: name,
        usage: tags.find((t) => t.regulator === code && t.facet === c.facet && t.tag === name)?.usage_count ?? 0,
        definition: tags.find((t) => t.regulator === code && t.facet === c.facet && t.tag === name)?.definition ?? null,
      }))
      .sort((a, b) => a.regulator.localeCompare(b.regulator)),
  }));

  const out = {
    generatedAt: new Date().toISOString(),
    database: "Neon Postgres (DATABASE_URL), live",
    regulators: regulators.map((r) => ({ code: r.code, name: r.name, domain: r.domain.name })),
    liveVersions,
    tags,
    concepts: concepts.map((c) => ({
      facet: c.facet,
      name: c.name,
      definition: c.definition,
      notes: c.notes,
      tags: c.tags
        .map((t) => ({ regulator: t.regulator.code, tag: t.name }))
        .sort((a, b) => a.regulator.localeCompare(b.regulator)),
    })),
    exactMatches,
    nearDuplicates,
    falseCognates: FALSE_COGNATES,
  };

  mkdirSync("scripts/.audit", { recursive: true });
  writeFileSync("scripts/.audit/findings.json", JSON.stringify(out, null, 2));
  console.log(
    `findings.json: ${out.regulators.length} regulators, ${out.tags.length} tags, ` +
      `${out.concepts.length} concepts, ${out.falseCognates.length} false cognates. ` +
      `Database and mapping data file agree.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
