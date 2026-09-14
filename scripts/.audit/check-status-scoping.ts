import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const scoped = await prisma.taxonomyTag.findMany({
    where: { facet: "STATUS", NOT: { statusAppliesToSubjectIds: { isEmpty: true } } },
    include: { regulator: { select: { code: true } } },
  });
  console.log(`Status tags with a non-empty statusAppliesToSubjectIds: ${scoped.length}`);
  for (const t of scoped) {
    const subs = await prisma.taxonomyTag.findMany({
      where: { id: { in: t.statusAppliesToSubjectIds } },
      select: { name: true },
    });
    console.log(`  ${t.regulator.code} / "${t.name}" -> ${subs.map((s) => s.name).join("; ")}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
