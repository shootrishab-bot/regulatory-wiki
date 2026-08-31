import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ingestBatch, type NormalizedDocument } from "../lib/ingest";
import { prisma } from "../lib/prisma";

const NORMALIZED_JSON = path.join(__dirname, "../scrapers/data/clc_normalized.json");

async function main() {
  const all: NormalizedDocument[] = JSON.parse(fs.readFileSync(NORMALIZED_JSON, "utf-8"));
  console.log(`Loaded ${all.length} total normalized CLC documents.\n`);

  const results = await ingestBatch(all, "CLC");

  const processed = results.length;
  const skipped = results.filter((r) => r.status === "skipped_duplicate").length;
  const errored = results.filter((r) => r.status === "error").length;
  const ingested = results.filter((r) => r.status === "ingested");
  const autoAccepted = ingested.filter((r) => !r.needsReview).length;
  const flagged = ingested.filter((r) => r.needsReview).length;

  console.log("\n" + "=".repeat(70));
  console.log("OVERALL COUNTS (full CLC run)");
  console.log("=".repeat(70));
  console.log(`Processed:            ${processed}`);
  console.log(`Skipped (duplicate):  ${skipped}`);
  console.log(`Errored:              ${errored}`);
  console.log(`Auto-accepted:        ${autoAccepted}`);
  console.log(`Flagged for review:   ${flagged}`);

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
