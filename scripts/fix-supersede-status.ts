/**
 * Follow-up to scripts/fix-amendment-status.ts -- the three clusters flagged
 * there as "a different status question, needs its own judgment call"
 * (2026-08-20 audit), now resolved after reading the full real timeline for
 * each.
 *
 * MTCTE: MTCTE Procedure is a versioned instrument (2.0 -> 2.1 -> 3.0), each
 * release fully replacing the last -- unlike the clause-level amendments to
 * v3.0 already fixed as Type A in fix-amendment-status.ts, a new PROCEDURE
 * VERSION is a full replacement, not a partial modification. v2.0 is already
 * correctly "Superseded / Repealed"; v2.1 was not, even though v3.0
 * (April 2024) now exists. Only the two entries that ARE the v2.1 procedure
 * text itself are touched -- "Relaxation/Exemption for enforcement of
 * revised labelling guidelines... vide MTCTE procedure (ver 2.1)" is a
 * separate operative exemption notice, and whether it lapses along with the
 * procedure version is genuinely unclear without reading it, so it's left
 * alone rather than guessed.
 *
 * MIB: the 2014 "Policy Guidelines for Television Rating Agencies in India"
 * was replaced, after a full 2025 reform consultation (entry-barrier
 * removal, multiple draft amendment rounds), by a differently-named,
 * comprehensive "Television Ratings Policy 2026" -- a full policy
 * replacement, not an amendment to the 2014 text. Separately, that 2026
 * Policy already has its own real, later amendment ("Amendment to
 * Television Ratings Policy 2026", 2026-05-08) that was never cross-
 * referenced back to it -- the same Type A gap fix-amendment-status.ts
 * already fixed elsewhere, just not caught in that pass since the 2026
 * Policy itself wasn't yet known to need a base-side fix.
 *
 * CLC: VDA (Variable Dearness Allowance) orders are periodic wage
 * notifications -- CLC's own real title for one of these literally says
 * "Corrigendum and VDA Supersession Orders". Each new order supersedes the
 * prior one for current minimum-wage determination purposes. Only the most
 * recent real order (April 2026) should be In Force; every earlier order
 * -- including corrigenda tied to a now-superseded period -- becomes
 * Superseded / Repealed.
 *
 * Idempotent -- safe to re-run; skips any entry no longer at the expected
 * current status.
 *
 * Run with:
 *   npx tsx scripts/fix-supersede-status.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

interface Fix {
  id: string;
  regulatorCode: string;
  titleContains: string;
  fromStatus: string;
  toStatus: string;
  cluster: "MTCTE-v2.1" | "MIB-TVRating" | "CLC-VDA";
}

const MTCTE_V21_SUPERSEDED: Fix[] = [
  {
    id: "cms5rsfla004hn0dfj0vz9ty2",
    regulatorCode: "MTCTE",
    titleContains: "ver 2.1/ Rel. May 2021) with amendment dated 19.12.2022",
    fromStatus: "In Force",
    toStatus: "Superseded / Repealed",
    cluster: "MTCTE-v2.1",
  },
  {
    id: "cms5ruivj006hn0dffur6vio2",
    regulatorCode: "MTCTE",
    titleContains: "ver 2.1/ Rel. May 2021) supersedes procedure no. TEC/MP/DD/TCP-711",
    fromStatus: "In Force",
    toStatus: "Superseded / Repealed",
    cluster: "MTCTE-v2.1",
  },
];

const MIB_TV_RATING: Fix[] = [
  {
    id: "cmsbxt70h008xy4dflz7krfoc",
    regulatorCode: "MIB",
    titleContains: "Policy Guidelines for Television Rating Agencies in India",
    fromStatus: "In Force",
    toStatus: "Superseded / Repealed",
    cluster: "MIB-TVRating",
  },
  {
    id: "cmsbwh8ll0053y4df6tg0s1sk",
    regulatorCode: "MIB",
    titleContains: "Television Ratings Policy 2026-Guidelines for the Regulation",
    fromStatus: "In Force",
    toStatus: "Amended",
    cluster: "MIB-TVRating",
  },
];

// Every real VDA entry except the most recent ("VDA Order April 2026",
// id cmsrchy3o000z04df3y9vgmd9, deliberately excluded -- stays In Force).
const CLC_VDA_SUPERSEDED: Fix[] = [
  { id: "cmsrcj2ba001x04dfnpi0xq06", titleContains: "VDA Orders from 2000-2005" },
  { id: "cmsrciz97001v04dfoaveaxqj", titleContains: "VDA Orders from 2006-2010" },
  { id: "cmsrciwd0001t04dfcqmqmuo8", titleContains: "VDA Orders from 2011-2015" },
  { id: "cmsrcisym001r04dfdl2hr5c1", titleContains: "VDA Orders from 2016-2020" },
  { id: "cmsrcipws001p04dfeqmr9ari", titleContains: "Revised VDA (Minimum Wages) effective from 1st April 2021" },
  { id: "cmsrcinei001n04dff1ilh805", titleContains: "Revised VDA (Minimum Wages) wef 01 October 2021" },
  { id: "cmsrcilfy001l04dff5v3psfe", titleContains: "Revised VDA (Minimum Wages) wef 01 April 2022" },
  { id: "cmsrcij9o001j04dfqw1ymbyr", titleContains: "Corrigendum and VDA Supersession Orders dated 29/7/22" },
  { id: "cmsrcigs4001h04dftmuvcrpr", titleContains: "Minimum Wages VDA wef 01 October 2022" },
  { id: "cmsrcieai001f04df1y5m7xrd", titleContains: "VDA Order April, 2023" },
  { id: "cmsrcick4001d04dfbujx3plk", titleContains: "VDA Order October, 2023" },
  { id: "cmsrcial3001b04dfwnxo9yd9", titleContains: "VDA Order April 2024" },
  { id: "cmsrci8nh001904dfmdao8mhs", titleContains: "VDA Order October, 2024" },
  { id: "cmsrci67y001704df8c6sq8ee", titleContains: "VDA Order April, 2025" },
  { id: "cmsrci40o001504df06zjjx3b", titleContains: "Corrigendum with VDA order of Mines effective from 1 April, 2025" },
  { id: "cmsrci2ac001304df27pkqlfs", titleContains: "VDA Order October 2025" },
  { id: "cmsrchzsh001104dfyycaegt3", titleContains: "Corrigendum-VDA (Oct-25)" },
].map((f) => ({
  ...f,
  regulatorCode: "CLC",
  fromStatus: "In Force",
  toStatus: "Superseded / Repealed",
  cluster: "CLC-VDA" as const,
}));

const FIXES: Fix[] = [...MTCTE_V21_SUPERSEDED, ...MIB_TV_RATING, ...CLC_VDA_SUPERSEDED];

async function main() {
  const statusTagCache = new Map<string, string>();

  async function getStatusTagId(regulatorCode: string, name: string): Promise<string> {
    const key = `${regulatorCode}:${name}`;
    const cached = statusTagCache.get(key);
    if (cached) return cached;
    const regulator = await prisma.regulator.findUnique({ where: { code: regulatorCode } });
    if (!regulator) throw new Error(`Regulator "${regulatorCode}" not found.`);
    const tag = await prisma.taxonomyTag.findFirst({
      where: { regulatorId: regulator.id, facet: "STATUS", name },
    });
    if (!tag) throw new Error(`Status tag "${name}" not found for ${regulatorCode}.`);
    statusTagCache.set(key, tag.id);
    return tag.id;
  }

  let applied = 0;
  let skipped = 0;
  const byCluster: Record<string, number> = {};

  for (const fix of FIXES) {
    const entry = await prisma.updateEntry.findUnique({
      where: { id: fix.id },
      select: { id: true, title: true, statusTag: { select: { name: true } } },
    });

    if (!entry) {
      console.log(`  [SKIP] id ${fix.id} not found (${fix.regulatorCode})`);
      skipped++;
      continue;
    }
    if (!entry.title.toLowerCase().includes(fix.titleContains.toLowerCase())) {
      console.log(`  [SKIP] id ${fix.id} title no longer matches expected text -- not applying blind`);
      skipped++;
      continue;
    }
    if (entry.statusTag?.name !== fix.fromStatus) {
      console.log(
        `  [SKIP] "${entry.title.slice(0, 60)}" is now "${entry.statusTag?.name ?? "none"}", not "${fix.fromStatus}" -- already changed`
      );
      skipped++;
      continue;
    }

    const toStatusId = await getStatusTagId(fix.regulatorCode, fix.toStatus);
    await prisma.updateEntry.update({ where: { id: entry.id }, data: { statusId: toStatusId } });
    console.log(`  [${fix.cluster}] [${fix.regulatorCode}] "${entry.title.slice(0, 70)}" -> ${fix.fromStatus} => ${fix.toStatus}`);
    applied++;
    byCluster[fix.cluster] = (byCluster[fix.cluster] ?? 0) + 1;
  }

  console.log("\n" + "=".repeat(70));
  console.log("SUPERSEDE-STATUS FIX RESULTS");
  console.log("=".repeat(70));
  console.log(`Applied: ${applied}`);
  console.log(`Skipped: ${skipped}`);
  for (const [cluster, count] of Object.entries(byCluster)) {
    console.log(`  ${cluster}: ${count}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
