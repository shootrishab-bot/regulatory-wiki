/**
 * Inspects the sync run log -- the record a future daily digest will read.
 *
 * Usage: npx tsx scripts/show-sync-runs.ts [howMany]
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const take = Number(process.argv[2] ?? "5");

  const runs = await prisma.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take,
    include: { regulators: { orderBy: { regulatorCode: "asc" } } },
  });

  if (runs.length === 0) {
    console.log("No sync runs recorded yet.");
    await prisma.$disconnect();
    return;
  }

  for (const run of runs) {
    const secs = run.finishedAt
      ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
      : null;
    console.log("=".repeat(74));
    console.log(
      `${run.startedAt.toISOString().replace("T", " ").slice(0, 19)}  ` +
        `trigger=${run.trigger}  ${secs !== null ? `${secs}s` : "(unfinished)"}  ${run.id}`
    );
    for (const r of run.regulators) {
      console.log(
        `   ${r.regulatorCode.padEnd(7)} ${r.status.padEnd(8)} ` +
          `scraped=${String(r.scrapedRows).padEnd(5)} new=${String(r.newDocuments).padEnd(4)} ` +
          `ingested=${String(r.ingested).padEnd(4)} flagged=${String(r.flagged).padEnd(4)} ` +
          `errors=${r.errors}`
      );
      if (r.detail) console.log(`           ${r.detail}`);
    }
  }

  // What a digest would actually ask for.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.$queryRaw<{ code: string; n: bigint }[]>`
    SELECT r.code, COUNT(*)::bigint AS n
    FROM "SourceDocument" sd
    JOIN "Regulator" r ON r.id = sd."regulatorId"
    WHERE sd."firstIngestedAt" >= ${since}
    GROUP BY r.code ORDER BY r.code`;
  console.log("\n" + "=".repeat(74));
  console.log("documents with firstIngestedAt in the last 24h (the future digest query):");
  if (recent.length === 0) console.log("   none");
  for (const r of recent) console.log(`   ${r.code}: ${Number(r.n)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
