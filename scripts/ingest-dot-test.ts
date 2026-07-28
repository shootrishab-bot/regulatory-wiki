import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ingestBatch, type NormalizedDocument, type IngestOutcome } from "../lib/ingest";
import { prisma } from "../lib/prisma";

const NORMALIZED_JSON = path.join(__dirname, "../scrapers/dot/dot_normalized.json");

// The 10 "real subject matter" titles hand-identified earlier in the
// pressure-test conversation — these are the EXACT documents seed-dot.ts's
// own tag notes cite as evidence (VSAT/Unified License/Spectrum/Network
// Security). Picking these specifically (not just any 10 matching a
// keyword filter) directly tests whether DeepSeek reproduces the manual
// reasoning the taxonomy was built from.
const HAND_PICKED_SUBJECT_MATTER_TITLES = [
  "Amendments in Commercial VSAT License Agreement",
  "Amendments in Captive VSAT License Agreement",
  "Amended Guidelines for grant of Unified License",
  "Guidelines for establishing Satellite-based Communication Networks",
  "Guidelines for obtaining Captive VSAT CUG License – 2022",
  "List of UL Licences as on 30.06.2023",
  "Spectrum Fee and Radio Station Fee for assignment of spectrum for Public Mobile Radio Trunking Service (PMRTS) -reg",
  "Corrigendum dated 02.07.2026 on Spectrum Fee and Radio Station Fee for assignment of spectrum for Public Mobile Radio Trunking Service (PMRTS) -reg",
  "Blocking Notifications/instructions to Internet Service Licensees under court orders (Jul - Sept 2026)",
  "3G & BWA Spectrum Auction",
];

// Our own hand-worked-out expectation for each title above, for direct
// comparison against what DeepSeek actually returns (STEP 3, requirement 4).
const HAND_WORKED_OUT_EXPECTATIONS: Record<string, string> = {
  "Amendments in Commercial VSAT License Agreement": "Licensing > VSAT / Satellite Communication",
  "Amendments in Captive VSAT License Agreement": "Licensing > VSAT / Satellite Communication",
  "Amended Guidelines for grant of Unified License": "Licensing > Unified License / Access Services",
  "Guidelines for establishing Satellite-based Communication Networks":
    "Licensing > VSAT / Satellite Communication",
  "Guidelines for obtaining Captive VSAT CUG License – 2022": "Licensing > VSAT / Satellite Communication",
  "List of UL Licences as on 30.06.2023": "Licensing > Unified License / Access Services",
  "Spectrum Fee and Radio Station Fee for assignment of spectrum for Public Mobile Radio Trunking Service (PMRTS) -reg":
    "Spectrum Management",
  "Corrigendum dated 02.07.2026 on Spectrum Fee and Radio Station Fee for assignment of spectrum for Public Mobile Radio Trunking Service (PMRTS) -reg":
    "Spectrum Management",
  "Blocking Notifications/instructions to Internet Service Licensees under court orders (Jul - Sept 2026)":
    "Network Security / Content Compliance",
  "3G & BWA Spectrum Auction": "Spectrum Management",
};

// Same keyword filter used earlier in the conversation to separate
// "real subject matter" titles from HR/admin/court-instruction noise in
// ORDERS_AND_NOTICES.
const SUBJECT_MATTER_KEYWORDS =
  /rules?\b|regulation|guideline|license|licence|spectrum|notification|gazette|vsat|policy|amendment/i;

function selectCuratedBatch(all: NormalizedDocument[]): NormalizedDocument[] {
  const actsAndPolicies = all.filter((d) => d.category_hint === "ACTS_AND_POLICIES");

  const handPicked = HAND_PICKED_SUBJECT_MATTER_TITLES.map((title) =>
    all.find((d) => d.title === title)
  ).filter((d): d is NormalizedDocument => Boolean(d));

  const missingHandPicked = HAND_PICKED_SUBJECT_MATTER_TITLES.filter(
    (title) => !all.some((d) => d.title === title)
  );
  if (missingHandPicked.length > 0) {
    console.warn("WARNING: could not find these hand-picked titles in the normalized data:");
    missingHandPicked.forEach((t) => console.warn(`  - ${t}`));
  }

  const ordersAndNotices = all.filter((d) => d.category_hint === "ORDERS_AND_NOTICES");
  const adminNoise = ordersAndNotices.filter((d) => !SUBJECT_MATTER_KEYWORDS.test(d.title));
  // Systematic sample (every Nth row) rather than the first N, so it's not
  // cherry-picked from one narrow time window.
  const step = Math.max(1, Math.floor(adminNoise.length / 10));
  const personnelAdminSample = adminNoise.filter((_, i) => i % step === 0).slice(0, 10);

  const reports = all.filter((d) => d.category_hint === "REPORTS").slice(0, 2);
  const publications = all.filter((d) => d.category_hint === "PUBLICATIONS").slice(0, 1);
  const pressRelease = all.filter((d) => d.category_hint === "PRESS_RELEASE").slice(0, 2);
  const gazettes = all.filter((d) => d.category_hint === "GAZETTES_NOTIFICATIONS").slice(0, 2);

  const batch = [
    ...actsAndPolicies,
    ...handPicked,
    ...personnelAdminSample,
    ...reports,
    ...publications,
    ...pressRelease,
    ...gazettes,
  ];

  // De-dup in case any selection overlapped (e.g. a hand-picked title that
  // also happened to be in Acts and Policies).
  const seen = new Set<string>();
  return batch.filter((d) => {
    if (seen.has(d.source_id)) return false;
    seen.add(d.source_id);
    return true;
  });
}

async function main() {
  const all: NormalizedDocument[] = JSON.parse(fs.readFileSync(NORMALIZED_JSON, "utf-8"));
  console.log(`Loaded ${all.length} total normalized DoT documents.`);

  const batch = selectCuratedBatch(all);
  console.log(`Curated test batch: ${batch.length} documents.\n`);

  const bySourceId = new Map(all.map((d) => [d.source_id, d]));

  const results = await ingestBatch(batch, "DOT");

  // ---- Report ----
  const processed = results.length;
  const skipped = results.filter((r) => r.status === "skipped_duplicate").length;
  const errored = results.filter((r) => r.status === "error").length;
  const ingested = results.filter((r) => r.status === "ingested");
  const autoAccepted = ingested.filter((r) => !r.needsReview).length;
  const flagged = ingested.filter((r) => r.needsReview).length;

  console.log("\n" + "=".repeat(70));
  console.log("OVERALL COUNTS");
  console.log("=".repeat(70));
  console.log(`Processed:            ${processed}`);
  console.log(`Skipped (duplicate):  ${skipped}`);
  console.log(`Errored:              ${errored}`);
  console.log(`Auto-accepted:        ${autoAccepted}`);
  console.log(`Flagged for review:   ${flagged}`);

  console.log("\n" + "=".repeat(70));
  console.log("LOW-CONFIDENCE / FLAGGED RESULTS");
  console.log("=".repeat(70));
  for (const r of ingested) {
    if (r.needsReview) {
      console.log(
        `- [${r.confidence.toFixed(2)}] "${r.title.slice(0, 80)}"\n` +
          `  -> subject=${r.subject} | instrument=${r.instrumentType} | reasons=${r.reviewReasons.join(", ")}`
      );
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("PLACEHOLDER-TAG EVIDENCE CHECK (Reports/Publications/Press Release/Gazette sample)");
  console.log("=".repeat(70));
  const nonOrdersCategories = new Set(["REPORTS", "PUBLICATIONS", "PRESS_RELEASE", "GAZETTES_NOTIFICATIONS"]);
  const placeholderNames = [
    "Universal Service Obligation Fund",
    "Foreign Direct Investment",
    "International Cooperation",
    "Standardization and R&D",
    "PSU Matters",
    "Government Connectivity Projects",
  ];
  for (const r of ingested) {
    const doc = bySourceId.get(r.sourceId);
    if (doc && nonOrdersCategories.has(doc.category_hint ?? "")) {
      const flag = placeholderNames.includes(r.subject) ? " *** PLACEHOLDER TAG MATCHED ***" : "";
      console.log(
        `- [${doc.category_hint}] "${r.title.slice(0, 70)}" -> subject=${r.subject} (conf=${r.confidence.toFixed(2)})${flag}`
      );
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("HAND-WORKED-OUT COMPARISON (Licensing/Spectrum/Network Security titles)");
  console.log("=".repeat(70));
  for (const r of ingested) {
    const expected = HAND_WORKED_OUT_EXPECTATIONS[r.title];
    if (expected) {
      const match = expected === r.subject ? "MATCH" : "DIFFERS";
      console.log(
        `- [${match}] "${r.title.slice(0, 70)}"\n` +
          `  expected: ${expected}\n` +
          `  got:      ${r.subject} (conf=${r.confidence.toFixed(2)})`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
