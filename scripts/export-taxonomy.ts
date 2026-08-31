import { prisma } from "@/lib/prisma";
import { writeFileSync } from "fs";

async function main() {
  const regulators = await prisma.regulator.findMany({
    include: {
      domain: true,
      taxonomyTags: {
        orderBy: [{ facet: "asc" }, { name: "asc" }],
      },
    },
    orderBy: { code: "asc" },
  });

  const out = regulators.map((r) => ({
    code: r.code,
    name: r.name,
    domain: r.domain.name,
    tags: r.taxonomyTags.map((t) => ({
      facet: t.facet,
      name: t.name,
      shortCode: t.shortCode,
      status: t.status,
      parentId: t.parentId,
      definition: t.definition,
      statusAppliesToSubjectIds: t.statusAppliesToSubjectIds,
    })),
  }));

  writeFileSync("scripts/.taxonomy-export.json", JSON.stringify(out, null, 2));
  console.log(`Exported ${regulators.length} regulators, ${out.reduce((n, r) => n + r.tags.length, 0)} tags`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
