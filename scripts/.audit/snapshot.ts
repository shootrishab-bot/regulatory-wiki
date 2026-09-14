import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import { writeFileSync } from "fs";
import {
  listPublicEntries, listFlaggedEntries, getRegulators, getTagOptions,
  getFlaggedCountsByRegulator, getPublicCountsByRegulator, getDomainOverview,
  getRegulatorDetail, getTagsByFacet, getTag,
} from "@/lib/queries";

const label = process.argv[2] ?? "before";
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function main() {
  const snap: Record<string, string> = {};
  const put = (k: string, v: unknown) => { snap[k] = createHash("sha256").update(j(v)).digest("hex"); };

  const regs = await getRegulators();
  put("getRegulators", regs);
  put("getDomainOverview", await getDomainOverview());
  put("getFlaggedCountsByRegulator", await getFlaggedCountsByRegulator());
  put("getPublicCountsByRegulator", await getPublicCountsByRegulator());
  put("getTagsByFacet:SUBJECT", await getTagsByFacet("SUBJECT"));
  put("getTagsByFacet:INSTRUMENT_TYPE", await getTagsByFacet("INSTRUMENT_TYPE"));

  const codes = (await prisma.regulator.findMany({ orderBy: { code: "asc" } })).map(r => r.code);
  for (const code of codes) {
    put(`getRegulatorDetail:${code}`, await getRegulatorDetail(code));
    put(`getTagOptions:${code}`, await getTagOptions({ regulator: code }));
    // Real Subject / Instrument / Status filtering, exactly as the UI does it
    put(`listPublicEntries:${code}`, await listPublicEntries({ regulator: code }));
    put(`listFlagged:${code}`, await listFlaggedEntries({ regulator: code }));
  }

  // Per-tag filtering for EVERY tag of every regulator, all three facets
  const tags = await prisma.taxonomyTag.findMany({
    include: { regulator: true }, orderBy: [{ regulatorId: "asc" }, { facet: "asc" }, { name: "asc" }],
  });
  for (const t of tags) {
    const key = `${t.regulator.code}|${t.facet}|${t.name}`;
    if (t.facet === "SUBJECT") put(`filter:${key}`, await listPublicEntries({ regulator: t.regulator.code, subject: t.id }));
    else if (t.facet === "INSTRUMENT_TYPE") put(`filter:${key}`, await listPublicEntries({ regulator: t.regulator.code, instrument: t.id }));
    else put(`filter:${key}`, await prisma.updateEntry.findMany({ where: { statusId: t.id }, select: { id: true }, orderBy: { id: "asc" } }));
    if (t.facet !== "STATUS") put(`getTag:${key}`, await getTag(t.id));
  }

  writeFileSync(`scripts/.audit/snapshot-${label}.json`, JSON.stringify(snap, null, 2));
  console.log(`${label}: ${Object.keys(snap).length} query results hashed`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
