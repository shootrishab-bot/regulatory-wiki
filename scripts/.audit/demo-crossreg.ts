import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  for (const name of ["In Force", "Enforcement / Adjudicatory Order", "Press Release", "Subordinate Legislation (Rules made under an Act)"]) {
    const rows = await prisma.$queryRawUnsafe<{ code: string; tag: string; entries: number }[]>(
      `SELECT rg.code, t.name AS tag,
              ((SELECT COUNT(*) FROM "UpdateEntry" e WHERE e."subjectId"=t.id)
             + (SELECT COUNT(*) FROM "UpdateEntry" e WHERE e."instrumentTypeId"=t.id)
             + (SELECT COUNT(*) FROM "UpdateEntry" e WHERE e."statusId"=t.id))::int AS entries
       FROM "CanonicalConcept" cc
       JOIN "TaxonomyTag" t ON t."canonicalConceptId" = cc.id
       JOIN "Regulator" rg ON rg.id = t."regulatorId"
       WHERE cc.name = $1
       ORDER BY 3 DESC`,
      name,
    );
    const tot = rows.reduce((n, r) => n + r.entries, 0);
    console.log(`\n${name}  ->  ${rows.length} regulators, ${tot} entries`);
    for (const r of rows) console.log(`   ${r.code.padEnd(13)} ${String(r.entries).padStart(5)}  ${r.tag}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
