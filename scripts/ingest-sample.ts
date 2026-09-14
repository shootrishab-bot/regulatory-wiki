/**
 * Runs the real ingestion pipeline over a SEEDED RANDOM SAMPLE of a
 * regulator's normalized scraper output.
 *
 * Why a shared script rather than another copy of ingest-<regulator>.ts:
 * every existing per-regulator ingest script in scripts/ is the same 46 lines
 * with a different filename and a different label, and each of them ingests
 * either the whole corpus or its first N rows. `.slice(0, N)` is exactly the
 * wrong sampling method for a taxonomy test -- the first N rows of a scraper's
 * output are one feed's most recent documents, so a "sample" taken that way
 * measures how well the taxonomy handles this week's press releases, not how
 * well it handles the corpus. This takes a real uniform random sample across
 * the whole normalized file, with a recorded seed so a finding can be
 * re-derived exactly.
 *
 * The sample is written to scripts/.audit/<code>-sample-<seed>.json alongside
 * the run so the exact document set behind a finding is inspectable later.
 *
 * Usage:
 *   npx tsx scripts/ingest-sample.ts MERC scrapers/data/merc_normalized.json 100
 *   npx tsx scripts/ingest-sample.ts CPPP scrapers/data/cppp_normalized.json 100 --seed 7
 *   npx tsx scripts/ingest-sample.ts MERC scrapers/data/merc_normalized.json --all
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ingestBatch, type NormalizedDocument } from "../lib/ingest";
import { prisma } from "../lib/prisma";

const AUDIT_DIR = path.join(__dirname, ".audit");

/**
 * mulberry32 -- a small, deterministic PRNG.
 *
 * Math.random() cannot be seeded in Node, and an unseeded sample makes a
 * taxonomy finding unreproducible: the next person cannot check which 100
 * documents produced it. 32 bits of state is ample for shuffling a corpus of
 * tens of thousands.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, then take the first `size`. */
function sample<T>(items: T[], size: number, seed: number): T[] {
  const pool = [...items];
  const rand = mulberry32(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(size, pool.length));
}

function parseArgs() {
  const [code, file, sizeArg, ...rest] = process.argv.slice(2);
  if (!code || !file) {
    console.error(
      "usage: tsx scripts/ingest-sample.ts <REGULATOR_CODE> <normalized.json> [<sampleSize>|--all] [--seed N]"
    );
    process.exit(1);
  }
  const seedFlag = rest.indexOf("--seed");
  const seed = seedFlag >= 0 ? parseInt(rest[seedFlag + 1], 10) : 20260910;
  const all = sizeArg === "--all" || rest.includes("--all");
  const size = all ? Infinity : parseInt(sizeArg ?? "100", 10);
  return { code, file, size, seed, all };
}

async function main() {
  const { code, file, size, seed, all } = parseArgs();

  const all_docs: NormalizedDocument[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  const docs = all ? all_docs : sample(all_docs, size, seed);

  console.log(
    `Loaded ${all_docs.length} normalized ${code} documents. ` +
      (all ? "Processing all of them." : `Processing a seeded random sample of ${docs.length} (seed=${seed}).`)
  );

  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const samplePath = path.join(AUDIT_DIR, `${code.toLowerCase()}-sample-${all ? "all" : seed}.json`);
  fs.writeFileSync(samplePath, JSON.stringify(docs, null, 2));
  console.log(`Sample written to ${samplePath}\n`);

  const startedAt = Date.now();
  const results = await ingestBatch(docs, code);

  const skipped = results.filter((r) => r.status === "skipped_duplicate").length;
  const errored = results.filter((r) => r.status === "error");
  const ingested = results.filter((r) => r.status === "ingested") as Extract<
    (typeof results)[number],
    { status: "ingested" }
  >[];
  const flagged = ingested.filter((r) => r.needsReview);

  console.log("\n" + "=".repeat(72));
  console.log(`OVERALL COUNTS (${code}, ${docs.length} of ${all_docs.length})`);
  console.log("=".repeat(72));
  console.log(`Processed:            ${results.length}`);
  console.log(`Skipped (duplicate):  ${skipped}`);
  console.log(`Errored:              ${errored.length}`);
  console.log(`Auto-accepted:        ${ingested.length - flagged.length}`);
  console.log(`Flagged for review:   ${flagged.length}`);
  console.log(`Elapsed:              ${Math.round((Date.now() - startedAt) / 1000)}s`);

  if (ingested.length > 0) {
    const tally = (key: "subject" | "instrumentType" | "statusValue") => {
      const counts = new Map<string, number>();
      for (const r of ingested) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    };
    for (const [label, key] of [
      ["Subject", "subject"],
      ["Instrument Type", "instrumentType"],
      ["Status", "statusValue"],
    ] as const) {
      console.log(`\n--- ${label} distribution ---`);
      for (const [name, count] of tally(key)) {
        console.log(`  ${String(count).padStart(4)}  ${name}`);
      }
    }

    const reasons = new Map<string, number>();
    for (const r of flagged) {
      for (const reason of r.reviewReasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    if (reasons.size > 0) {
      console.log("\n--- review reasons ---");
      for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(4)}  ${reason}`);
      }
    }
  }

  if (errored.length > 0) {
    console.log("\n--- errored entries ---");
    for (const r of errored.slice(0, 20)) console.log(`  ${r.title.slice(0, 70)} -> ${r.error}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
