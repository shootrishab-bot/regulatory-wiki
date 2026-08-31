/**
 * CLI entrypoint for the daily sync.
 *
 * Usage:
 *   npx tsx scripts/sync-all.ts                    # all three regulators
 *   npx tsx scripts/sync-all.ts --only MIB         # one regulator
 *   npx tsx scripts/sync-all.ts --trigger schedule # label the run
 *
 * Exit code is 0 even when a regulator is BLOCKED: blocking is an expected,
 * recorded outcome, not a failure of the job. It exits 1 only if every
 * attempted regulator errored, which is what a scheduler should actually
 * alert on.
 */

import "dotenv/config";
import { runSync } from "../lib/sync";
import { prisma } from "../lib/prisma";

function argList(flag: string): string[] {
  const i = process.argv.indexOf(flag);
  if (i === -1) return [];
  return (process.argv[i + 1] ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const started = Date.now();
  const { runId, results } = await runSync({
    trigger: argValue("--trigger", "manual"),
    only: argList("--only"),
  });

  console.log("=".repeat(74));
  console.log(`SYNC RUN ${runId}`);
  console.log("=".repeat(74));
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(
    `${pad("REGULATOR", 11)}${pad("STATUS", 9)}${pad("SCRAPED", 9)}${pad("NEW", 6)}${pad("INGESTED", 10)}${pad("FLAGGED", 9)}${pad("ERRORS", 8)}TIME`
  );
  for (const r of results) {
    console.log(
      `${pad(r.code, 11)}${pad(r.status, 9)}${pad(r.scrapedRows, 9)}${pad(r.newDocuments, 6)}` +
        `${pad(r.ingested, 10)}${pad(r.flagged, 9)}${pad(r.errors, 8)}${Math.round(r.durationMs / 1000)}s`
    );
    if (r.detail) console.log(`             ^ ${r.detail}`);
  }

  const blocked = results.filter((r) => r.status === "BLOCKED").map((r) => r.code);
  const errored = results.filter((r) => r.status === "ERROR").map((r) => r.code);
  const totalNew = results.reduce((s, r) => s + r.ingested, 0);

  console.log("-".repeat(74));
  console.log(`total newly ingested: ${totalNew}`);
  if (blocked.length) console.log(`BLOCKED (skipped, not counted as empty): ${blocked.join(", ")}`);
  if (errored.length) console.log(`ERRORED: ${errored.join(", ")}`);
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`\nlogged to SyncRun/SyncRunRegulator -- inspect with scripts/show-sync-runs.ts`);

  await prisma.$disconnect();

  if (results.length > 0 && errored.length === results.length) {
    process.exitCode = 1;
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
