/**
 * Populates CanonicalConcept and links the confirmed regulator tags to it.
 *
 * Reads scripts/canonical-concepts.data.ts and nothing else. Idempotent:
 * re-running upserts the same concepts and re-links the same tags.
 *
 * Deliberately STRICT. Every (regulator, facet, tagName) in the data file must
 * resolve to a real seeded TaxonomyTag, and the script aborts the whole
 * transaction if any does not. A silently-skipped mapping would leave the
 * database disagreeing with the report and the workbook, which is exactly the
 * failure this layer exists to avoid.
 *
 * It only ever WRITES canonicalConceptId. It never touches a tag's name,
 * shortCode, definition, status, parent, or any UpdateEntry.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { CANONICAL_CONCEPTS } from "./canonical-concepts.data";
import type { Facet } from "@/app/generated/prisma/client";

async function main() {
  const apply = !process.argv.includes("--dry-run");

  const regulators = await prisma.regulator.findMany({ select: { id: true, code: true } });
  const regByCode = new Map(regulators.map((r) => [r.code, r.id]));

  const tags = await prisma.taxonomyTag.findMany({
    select: { id: true, regulatorId: true, facet: true, name: true, canonicalConceptId: true },
  });
  const tagKey = (regId: string, facet: string, name: string) => `${regId}|${facet}|${name}`;
  const tagByKey = new Map(tags.map((t) => [tagKey(t.regulatorId, t.facet, t.name), t]));

  // ---- Resolve everything BEFORE writing anything -------------------------
  const errors: string[] = [];
  const resolved: { concept: (typeof CANONICAL_CONCEPTS)[number]; tagIds: string[] }[] = [];

  for (const c of CANONICAL_CONCEPTS) {
    const tagIds: string[] = [];
    for (const [code, tagName] of Object.entries(c.tags)) {
      const regId = regByCode.get(code);
      if (!regId) {
        errors.push(`[${c.facet}] "${c.name}": no regulator with code "${code}"`);
        continue;
      }
      const tag = tagByKey.get(tagKey(regId, c.facet, tagName));
      if (!tag) {
        errors.push(`[${c.facet}] "${c.name}": ${code} has no ${c.facet} tag named "${tagName}"`);
        continue;
      }
      tagIds.push(tag.id);
    }
    if (Object.keys(c.tags).length < 2) {
      errors.push(`[${c.facet}] "${c.name}": only ${Object.keys(c.tags).length} regulator(s) — a canonical concept needs 2+`);
    }
    resolved.push({ concept: c, tagIds });
  }

  // A tag must never be claimed by two concepts.
  const claimed = new Map<string, string>();
  for (const { concept, tagIds } of resolved) {
    for (const id of tagIds) {
      const prev = claimed.get(id);
      if (prev) errors.push(`tag ${id} claimed by BOTH "${prev}" and "${concept.name}"`);
      claimed.set(id, concept.name);
    }
  }

  if (errors.length) {
    console.error(`REFUSING TO WRITE — ${errors.length} unresolved mapping(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  const totalTags = resolved.reduce((n, r) => n + r.tagIds.length, 0);
  console.log(`Resolved ${resolved.length} concepts covering ${totalTags} regulator tags. All OK.`);
  if (!apply) {
    console.log("--dry-run: nothing written.");
    await prisma.$disconnect();
    return;
  }

  // ---- Write --------------------------------------------------------------
  // Neon is remote and this is ~66 round-trips; the 5s interactive-transaction
  // default is not enough. Kept as ONE transaction deliberately -- a partial
  // mapping is worse than none, so it must be all-or-nothing.
  await prisma.$transaction(async (tx) => {
    // Clear any prior links so a removed mapping in the data file is genuinely
    // removed here too, rather than lingering.
    await tx.taxonomyTag.updateMany({
      where: { canonicalConceptId: { not: null } },
      data: { canonicalConceptId: null },
    });

    for (const { concept, tagIds } of resolved) {
      const row = await tx.canonicalConcept.upsert({
        where: { facet_name: { facet: concept.facet as Facet, name: concept.name } },
        create: {
          facet: concept.facet as Facet,
          name: concept.name,
          definition: concept.definition,
          notes: concept.notes ?? null,
        },
        update: { definition: concept.definition, notes: concept.notes ?? null },
      });
      await tx.taxonomyTag.updateMany({
        where: { id: { in: tagIds } },
        data: { canonicalConceptId: row.id },
      });
    }
  }, { timeout: 120_000, maxWait: 30_000 });

  // ---- Report -------------------------------------------------------------
  const after = await prisma.canonicalConcept.findMany({
    include: { tags: { include: { regulator: { select: { code: true } } } } },
    orderBy: [{ facet: "asc" }, { name: "asc" }],
  });
  const unmapped = await prisma.taxonomyTag.count({ where: { canonicalConceptId: null } });
  const mapped = await prisma.taxonomyTag.count({ where: { canonicalConceptId: { not: null } } });

  console.log(`\nWrote ${after.length} CanonicalConcept rows.`);
  for (const f of ["SUBJECT", "INSTRUMENT_TYPE", "STATUS"]) {
    const rows = after.filter((c) => c.facet === f);
    console.log(`\n${f} (${rows.length} concepts)`);
    for (const c of rows) {
      const codes = c.tags.map((t) => t.regulator.code).sort().join(", ");
      console.log(`  ${c.name}  [${c.tags.length}] ${codes}`);
    }
  }
  console.log(`\nTags mapped: ${mapped} / ${mapped + unmapped}  (unmapped: ${unmapped} — expected and correct)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
