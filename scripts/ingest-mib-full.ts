/**
 * Ingests the real normalized MIB corpus (1,024 documents from 18 real site
 * sections) through the shared ingestion pipeline.
 *
 * Mirrors ingest-mtcte-full.ts, with one addition: an optional --limit N
 * argument so the pipeline can be smoke-tested against a small real slice
 * before committing to the full run. The full run makes one DeepSeek call
 * per document plus a PDF download for the 520 documents that have a real
 * downloadable file, so it is genuinely long-running -- worth proving the
 * MIB-specific data shape works on a handful of real documents first rather
 * than discovering a data problem 40 minutes in.
 *
 * Usage:
 *   npx tsx scripts/ingest-mib-full.ts --limit 5
 *   npx tsx scripts/ingest-mib-full.ts
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ingestBatch, type NormalizedDocument } from "../lib/ingest";
import { prisma } from "../lib/prisma";

const NORMALIZED_JSON = path.join(__dirname, "../scrapers/data/mib_normalized.json");

function parseLimit(): number | null {
  const idx = process.argv.indexOf("--limit");
  if (idx === -1) return null;
  const raw = process.argv[idx + 1];
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`--limit needs a positive integer, got: ${raw}`);
  }
  return n;
}

async function main() {
  const limit = parseLimit();
  const all: NormalizedDocument[] = JSON.parse(fs.readFileSync(NORMALIZED_JSON, "utf-8"));
  const docs = limit ? all.slice(0, limit) : all;

  console.log(`Loaded ${all.length} total normalized MIB documents.`);
  if (limit) {
    console.log(`--limit ${limit} set: ingesting only the first ${docs.length}.`);
  }
  console.log("");

  const startedAt = Date.now();
  const results = await ingestBatch(docs, "MIB");
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  const processed = results.length;
  const skipped = results.filter((r) => r.status === "skipped_duplicate").length;
  const errored = results.filter((r) => r.status === "error").length;
  const ingested = results.filter((r) => r.status === "ingested");
  const autoAccepted = ingested.filter((r) => !r.needsReview).length;
  const flagged = ingested.filter((r) => r.needsReview).length;

  console.log("\n" + "=".repeat(70));
  console.log(`OVERALL COUNTS (MIB run over ${docs.length} documents)`);
  console.log("=".repeat(70));
  console.log(`Processed:            ${processed}`);
  console.log(`Skipped (duplicate):  ${skipped}`);
  console.log(`Errored:              ${errored}`);
  console.log(`Auto-accepted:        ${autoAccepted}`);
  console.log(`Flagged for review:   ${flagged}`);
  console.log(`Elapsed:              ${elapsedSec}s`);

  // Real reason breakdown -- which review reasons actually fired, so the
  // flagged count is explainable rather than just a number.
  const reasonCounts = new Map<string, number>();
  for (const r of ingested) {
    if (!r.needsReview) continue;
    for (const reason of r.reviewReasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  if (reasonCounts.size > 0) {
    console.log("\n--- review reasons (real counts) ---");
    for (const [reason, count] of [...reasonCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  if (errored > 0) {
    console.log("\n--- errored entries ---");
    for (const r of results) {
      if (r.status === "error") console.log(JSON.stringify(r, null, 2));
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
