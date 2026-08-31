/**
 * DOS-ISRO amendment-chain resolver.
 *
 * WHY THIS EXISTS: per-document classification has no way to know, at the
 * time a base Authorization is classified, that a LATER amendment will be
 * issued against it -- the base document's own text predates the amendment
 * entirely. So the classifier correctly leaves the base at "In Force" (it
 * IS in force, as of when it was written), and the fix can't live in the
 * classification prompt. This script runs AFTER a batch is classified and
 * does the cross-referencing a single-document classifier structurally
 * cannot: find every real Authorization document whose title identifies it
 * as an amendment (title contains "Amendment No. N"), work out which base
 * Authorization Number it amends, and if that base is still tagged
 * "In Force", flip it to "Amended".
 *
 * IMPORTANT, get this right (a real correction made mid-build, 2026-08-19):
 * the AMENDMENT document itself stays "In Force" -- it's a freestanding,
 * currently-operative instrument. "Amended" describes the BASE document
 * that got modified, not the amendment. This script only ever updates the
 * base's status, never the amendment's.
 *
 * REAL, CONFIRMED number formats handled (from the live DOS-ISRO corpus):
 *   - "PMA/IN-SPACe/AUTH/2025/90" (a base, no suffix)
 *   - "PMA/IN-SPACe/AUTH/2025/90B" (an amendment to base 2025/90, letter
 *     suffix directly appended, no separator)
 *   - "PMA/IN-SPACAE/AUTH/2025/89C" (real typo in the source data --
 *     "SPACAE" not "SPACe" -- matched via a permissive \w* segment, not a
 *     literal string, so this and any other real spelling variant match)
 *   - "PMA/IN-SPACe/AUTH/2025/104-P" (a real dash-suffixed number --
 *     NOT assumed to be an amendment letter; the regex only treats a
 *     BARE trailing letter as an amendment suffix, so "-P" numbers are
 *     left alone rather than mishandled). REAL BUG CAUGHT BEFORE THIS
 *     SHIPPED: an earlier draft had a `(?!-)` lookahead after the optional
 *     letter group, intending to reject "-P"-style suffixes -- it actually
 *     forced the engine to backtrack OUT of the digit group instead,
 *     silently truncating "104" to "10". Removed the lookahead entirely;
 *     an optional `[A-Z]?` that simply fails to match a following "-"
 *     already does the right thing on its own, confirmed against all 6
 *     real title shapes in the corpus before this was trusted.
 *
 * Two real shapes of "this is an amendment" title both handled by the same
 * logic (confirmed live, not assumed):
 *   1. The amendment has its OWN separate row: "Amendment No. 2:
 *      PMA/IN-SPACe/AUTH/2025/90B -- ..." -- this script extracts base
 *      "2025/90" from ITS OWN number (stripping the letter suffix) and
 *      updates that DIFFERENT row.
 *   2. The base's own row already says "read with Amendment No. N (ref.
 *      ...)" in ITS OWN title, e.g. "PMA/IN-SPACe/AUTH/2025/76 read with
 *      Amendment No. 1 (ref. PMA/IN-SPACe/AUTH/2025/76A)" -- here the
 *      extracted number IS the base's own number (no suffix), so this
 *      resolves to updating THIS SAME row. Confirmed live: bases 2025/76,
 *      2025/104-P, and 2024/60 exist ONLY as this single composite row in
 *      the real corpus (no separate plain-base row was ever scraped for
 *      them), so self-resolution is the correct and only real path for
 *      these three.
 *
 * Idempotent -- safe to re-run after every future ingestion batch. Bases
 * already correctly "Amended" are skipped, not re-written.
 *
 * Run with:
 *   npx tsx scripts/resolve-dos-isro-amendments.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

// \w* (not a literal "SPACe") deliberately matches the real "SPACAE" typo
// variant confirmed live, plus any other real spelling drift, without
// needing to special-case each one by hand.
const AUTH_NO_RE = /PMA\/IN-SPAC\w*\/AUTH\/(\d{4})\/(\d+)([A-Z])?/i;
const AMENDMENT_PHRASE_RE = /amendment\s*no\.?\s*\d+/i;

async function main() {
  const regulator = await prisma.regulator.findUnique({ where: { code: "DOS-ISRO" } });
  if (!regulator) throw new Error('Regulator "DOS-ISRO" not found -- seed the taxonomy first.');

  const amendedTag = await prisma.taxonomyTag.findFirst({
    where: { regulatorId: regulator.id, facet: "STATUS", name: "Amended" },
  });
  if (!amendedTag) throw new Error('Status tag "Amended" not found for DOS-ISRO.');
  const inForceTag = await prisma.taxonomyTag.findFirst({
    where: { regulatorId: regulator.id, facet: "STATUS", name: "In Force" },
  });

  const entries = await prisma.updateEntry.findMany({
    where: { sourceDocument: { regulatorId: regulator.id } },
    select: { id: true, title: true, statusId: true },
  });
  console.log(`Loaded ${entries.length} real DOS-ISRO entries.`);

  // Base authorization number ("YYYY/NNN", no letter suffix) -> entry.
  // Only entries whose OWN number has no letter suffix are candidate bases
  // -- an entry whose own number ends in a letter (e.g. "90B") is itself
  // an amendment, never a base to be updated.
  const baseByNumber = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const m = e.title.match(AUTH_NO_RE);
    if (!m || m[3]) continue; // no match, or has a letter suffix -> not a base
    baseByNumber.set(`${m[1]}/${m[2]}`, e);
  }
  console.log(`Found ${baseByNumber.size} candidate base Authorization documents.`);

  let updated = 0;
  let alreadyAmended = 0;
  let baseNotFound = 0;
  const notFoundExamples: string[] = [];

  for (const e of entries) {
    if (!AMENDMENT_PHRASE_RE.test(e.title)) continue;
    const m = e.title.match(AUTH_NO_RE);
    if (!m) continue;

    // Case 1 (separate amendment row, has its own letter suffix): resolve
    // to the base number by stripping the suffix.
    // Case 2 (base's own row says "read with Amendment No. N"): m[3] is
    // already empty, so key is this row's own number -- self-resolves.
    const key = `${m[1]}/${m[2]}`;
    const base = baseByNumber.get(key);

    if (!base) {
      baseNotFound++;
      if (notFoundExamples.length < 10) notFoundExamples.push(`"${e.title.slice(0, 90)}" (looked for ${key})`);
      continue;
    }

    if (base.statusId === amendedTag.id) {
      alreadyAmended++;
      continue;
    }

    // Only override a base that's currently "In Force" (or unset) --
    // never downgrade a base that's already Superseded/Repealed, which
    // are stronger, more terminal real states than Amended.
    if (base.statusId && inForceTag && base.statusId !== inForceTag.id) {
      console.log(
        `  [SKIPPED] "${base.title.slice(0, 70)}" has a real status other than In Force -- not overriding with Amended`
      );
      continue;
    }

    await prisma.updateEntry.update({ where: { id: base.id }, data: { statusId: amendedTag.id } });
    updated++;
    console.log(`  [UPDATED -> Amended] "${base.title.slice(0, 70)}" (because of "${e.title.slice(0, 60)}")`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("AMENDMENT-CHAIN RESOLVER RESULTS");
  console.log("=".repeat(70));
  console.log(`Base documents updated to Amended: ${updated}`);
  console.log(`Already correctly Amended:         ${alreadyAmended}`);
  console.log(`Amendment referenced a base not found in corpus: ${baseNotFound}`);
  if (notFoundExamples.length) {
    console.log("  Examples (not an error -- the base may not be in the scraped corpus yet):");
    for (const ex of notFoundExamples) console.log(`    - ${ex}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
