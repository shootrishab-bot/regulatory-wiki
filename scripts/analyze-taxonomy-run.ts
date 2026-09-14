/**
 * Reads back a real classified sample from Postgres and reports what it says
 * about the regulator's taxonomy.
 *
 * This is the evidence step between "the pipeline ran" and "here is what to
 * change in the workbook". It answers four questions that a run log alone
 * cannot:
 *
 *   1. Which tags never fired? A tag that no real document in a uniform random
 *      sample reaches is either structurally absent from the source (fine, and
 *      worth saying so) or unreachable by construction (a real defect).
 *   2. Where is the classifier least sure? Mean confidence per tag surfaces a
 *      tag the model reaches for when it has nothing better -- a catch-all
 *      that the taxonomy has not admitted to being one.
 *   3. Does the assigned tag agree with the source's own filing? Cross-tabbing
 *      the chosen tag against the scraper's category_hint shows where the
 *      regulator's own vocabulary and the taxonomy's disagree.
 *   4. What got flagged, and why?
 *
 * Reads the sample file written by scripts/ingest-sample.ts to recover each
 * document's source-side category, since that is not stored on UpdateEntry.
 *
 * Usage:
 *   npx tsx scripts/analyze-taxonomy-run.ts MERC scripts/.audit/merc-sample-20260910.json
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import type { NormalizedDocument } from "../lib/ingest";

const FACETS = [
  { facet: "SUBJECT" as const, label: "Subject", field: "subjectId" as const },
  { facet: "INSTRUMENT_TYPE" as const, label: "Instrument Type", field: "instrumentTypeId" as const },
  { facet: "STATUS" as const, label: "Status", field: "statusId" as const },
];

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${((n / total) * 100).toFixed(0)}%`;
}

async function main() {
  const code = process.argv[2];
  const samplePath = process.argv[3];
  if (!code || !samplePath) {
    console.error("usage: tsx scripts/analyze-taxonomy-run.ts <CODE> <sample.json>");
    process.exit(1);
  }

  const sample: NormalizedDocument[] = JSON.parse(fs.readFileSync(samplePath, "utf-8"));
  const hintBySourceId = new Map(sample.map((d) => [d.source_id, d.category_hint ?? "(none)"]));
  const sampleIds = new Set(sample.map((d) => d.source_id));

  const regulator = await prisma.regulator.findUniqueOrThrow({ where: { code } });
  const tags = await prisma.taxonomyTag.findMany({
    where: { regulatorId: regulator.id },
    orderBy: [{ facet: "asc" }, { name: "asc" }],
  });

  const docs = await prisma.sourceDocument.findMany({
    where: { regulatorId: regulator.id, sourceId: { in: [...sampleIds] } },
    include: {
      updateEntries: {
        include: { subject: true, instrumentType: true, statusTag: true },
      },
    },
  });

  const entries = docs.flatMap((d) =>
    d.updateEntries.map((e) => ({ ...e, sourceId: d.sourceId, publishedDate: d.publishedDate }))
  );

  console.log("=".repeat(78));
  console.log(`${code} — taxonomy run analysis`);
  console.log("=".repeat(78));
  console.log(`Sample size:              ${sample.length}`);
  console.log(`Classified in Postgres:   ${entries.length}`);
  console.log(`Flagged for review:       ${entries.filter((e) => e.needsReview).length}`);
  console.log(`Missing published date:   ${entries.filter((e) => !e.publishedDate).length}`);

  // ---- 1 + 2: coverage and confidence, per facet -------------------------
  for (const { facet, label, field } of FACETS) {
    const facetTags = tags.filter((t) => t.facet === facet);
    const counts = new Map<string, { n: number; conf: number[] }>();
    let unresolved = 0;
    for (const entry of entries) {
      const tagId = entry[field];
      if (!tagId) {
        unresolved += 1;
        continue;
      }
      const bucket = counts.get(tagId) ?? { n: 0, conf: [] };
      bucket.n += 1;
      const conf =
        facet === "SUBJECT"
          ? entry.subjectConfidence
          : facet === "INSTRUMENT_TYPE"
            ? entry.instrumentConfidence
            : entry.statusConfidence;
      if (conf != null) bucket.conf.push(conf);
      counts.set(tagId, bucket);
    }

    const fired = facetTags.filter((t) => counts.has(t.id));
    console.log(`\n${"-".repeat(78)}`);
    console.log(`${label}: ${fired.length}/${facetTags.length} tags fired` + (unresolved ? `, ${unresolved} unresolved` : ""));
    console.log("-".repeat(78));
    const rows = facetTags
      .map((t) => {
        const bucket = counts.get(t.id);
        const n = bucket?.n ?? 0;
        const mean = bucket && bucket.conf.length ? bucket.conf.reduce((a, b) => a + b, 0) / bucket.conf.length : null;
        return { name: t.name, n, mean };
      })
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    for (const r of rows) {
      const meanStr = r.mean == null ? "   —  " : r.mean.toFixed(2);
      const marker = r.n === 0 ? "  << never fired" : "";
      console.log(`  ${String(r.n).padStart(4)}  ${pct(r.n, entries.length).padStart(4)}  conf ${meanStr}  ${r.name}${marker}`);
    }
  }

  // ---- 3: chosen tag vs the source's own filing --------------------------
  console.log(`\n${"-".repeat(78)}`);
  console.log("Source category hint  ->  assigned Instrument Type / Subject");
  console.log("-".repeat(78));
  const cross = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const hint = hintBySourceId.get(entry.sourceId) ?? "(none)";
    const key = hint.length > 46 ? hint.slice(0, 46) + "…" : hint;
    const assigned = `${entry.instrumentType?.name ?? "(unresolved)"}  /  ${entry.subject?.name ?? "(unresolved)"}`;
    const inner = cross.get(key) ?? new Map<string, number>();
    inner.set(assigned, (inner.get(assigned) ?? 0) + 1);
    cross.set(key, inner);
  }
  for (const [hint, inner] of [...cross.entries()].sort((a, b) => {
    const sum = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
    return sum(b[1]) - sum(a[1]);
  })) {
    const total = [...inner.values()].reduce((a, b) => a + b, 0);
    console.log(`\n  [${total}] ${hint}`);
    for (const [assigned, n] of [...inner.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`        ${String(n).padStart(3)}  ${assigned}`);
    }
  }

  // ---- 4: review reasons -------------------------------------------------
  const reasons = new Map<string, number>();
  for (const entry of entries) {
    for (const reason of entry.reviewReasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  console.log(`\n${"-".repeat(78)}`);
  console.log("Review reasons");
  console.log("-".repeat(78));
  if (reasons.size === 0) console.log("  (none)");
  for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }

  // ---- lowest-confidence documents, for reading by hand ------------------
  console.log(`\n${"-".repeat(78)}`);
  console.log("20 lowest-confidence classifications (read these by hand)");
  console.log("-".repeat(78));
  const lowest = [...entries]
    .sort((a, b) => (a.subjectConfidence ?? 1) - (b.subjectConfidence ?? 1))
    .slice(0, 20);
  for (const e of lowest) {
    console.log(
      `  ${(e.subjectConfidence ?? 0).toFixed(2)}  ${e.title.slice(0, 62).padEnd(62)}  ` +
        `${e.subject?.name ?? "?"} / ${e.instrumentType?.name ?? "?"} / ${e.statusTag?.name ?? "?"}`
    );
    if (e.classificationReason) console.log(`         reason: ${e.classificationReason.slice(0, 110)}`);
  }

  const outDir = path.join(__dirname, ".audit");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${code.toLowerCase()}-run-analysis.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      entries.map((e) => ({
        sourceId: e.sourceId,
        title: e.title,
        categoryHint: hintBySourceId.get(e.sourceId) ?? null,
        subject: e.subject?.name ?? null,
        instrumentType: e.instrumentType?.name ?? null,
        status: e.statusTag?.name ?? null,
        confidence: e.subjectConfidence,
        reason: e.classificationReason,
        needsReview: e.needsReview,
        reviewReasons: e.reviewReasons,
        publishedDate: e.publishedDate,
      })),
      null,
      2
    )
  );
  console.log(`\nPer-document detail written to ${outPath}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
