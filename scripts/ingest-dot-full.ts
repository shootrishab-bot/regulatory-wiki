import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ingestBatch, getFullText, type NormalizedDocument } from "../lib/ingest";
import { prisma } from "../lib/prisma";

const NORMALIZED_JSON = path.join(__dirname, "../scrapers/dot/dot_normalized.json");

const SPOTLIGHT_TITLE =
  "Spectrum Fee and Radio Station Fee for assignment of spectrum for Public Mobile Radio Trunking Service (PMRTS) -reg";

async function main() {
  const all: NormalizedDocument[] = JSON.parse(fs.readFileSync(NORMALIZED_JSON, "utf-8"));
  console.log(`Loaded ${all.length} total normalized DoT documents.\n`);

  const results = await ingestBatch(all, "DOT");

  const processed = results.length;
  const skipped = results.filter((r) => r.status === "skipped_duplicate").length;
  const errored = results.filter((r) => r.status === "error").length;
  const ingested = results.filter((r) => r.status === "ingested");
  const autoAccepted = ingested.filter((r) => !r.needsReview).length;
  const flagged = ingested.filter((r) => r.needsReview).length;

  console.log("\n" + "=".repeat(70));
  console.log("OVERALL COUNTS (full 581-document run)");
  console.log("=".repeat(70));
  console.log(`Processed:            ${processed}`);
  console.log(`Skipped (duplicate):  ${skipped}`);
  console.log(`Errored:              ${errored}`);
  console.log(`Auto-accepted:        ${autoAccepted}`);
  console.log(`Flagged for review:   ${flagged}`);

  // ---- Spotlight: the PMRTS spectrum fee document ----
  console.log("\n" + "=".repeat(70));
  console.log(`SPOTLIGHT: "${SPOTLIGHT_TITLE}"`);
  console.log("=".repeat(70));

  const spotlightDoc = all.find((d) => d.title === SPOTLIGHT_TITLE);
  if (!spotlightDoc) {
    console.log("Could not find this document in the normalized dataset.");
  } else {
    const { text, source, extractionFailed } = await getFullText(spotlightDoc);
    console.log(`file_url: ${spotlightDoc.file_url}`);
    console.log(`extraction failed: ${extractionFailed}`);
    console.log(`raw_text_source: ${source}`);
    console.log(`extracted text length: ${text?.length ?? 0} chars`);
    console.log("\n--- extracted text (first 2000 chars) ---");
    console.log(text ? text.slice(0, 2000) : "(none)");

    const outcome = results.find((r) => r.title === SPOTLIGHT_TITLE);
    console.log("\n--- outcome from this run ---");
    console.log(JSON.stringify(outcome, null, 2));

    if (outcome?.status === "skipped_duplicate") {
      console.log(
        "\nThis document was skipped as a duplicate — it already exists in Postgres " +
          "from the earlier curated-batch run (it wasn't one of the 7 rows deleted, " +
          "since its fileUrl was already a real PDF, not a broken topic-page link). " +
          "Pulling its EXISTING stored classification instead of a fresh one:"
      );
      const regulator = await prisma.regulator.findUnique({ where: { code: "DOT" } });
      const existing = await prisma.sourceDocument.findUnique({
        where: { regulatorId_sourceId: { regulatorId: regulator!.id, sourceId: spotlightDoc.source_id } },
        include: { updateEntries: { include: { subject: true, instrumentType: true } } },
      });
      console.log(JSON.stringify(existing, null, 2));
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
