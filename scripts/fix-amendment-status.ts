/**
 * Cross-regulator amendment-status fix -- the follow-up to
 * scripts/resolve-dos-isro-amendments.ts, applied to the rest of the wiki.
 *
 * WHY THIS IS AN EXPLICIT LIST, NOT A GENERIC RESOLVER: DOS-ISRO's resolver
 * works because IN-SPACe Authorizations share one real, structured numbering
 * convention (PMA/IN-SPACe/AUTH/YYYY/NNN[letter]). No such shared convention
 * exists across DOT/MIB/CCI/MTCTE/etc. -- each regulator's real documents
 * reference their own prior instruments in whatever free-text way that
 * regulator's own drafters wrote them. A generic title-pattern resolver risks
 * the same false-positive class already caught and avoided once this session
 * (the DOS-ISRO cross-listing dedup helper: an early generic heuristic would
 * have wrongly merged distinct real documents -- see dos_isro_watcher.py's
 * deduplicate_by_title() docstring). Every fix below was individually found
 * and verified by querying the real corpus (title, date, and for the "type B"
 * fixes, the model's own stored classificationReason) -- not pattern-matched.
 *
 * Two distinct real bug types found in a full audit of every
 * currently-"Amended"-tagged or amendment-titled entry across the wiki
 * (2026-08-20):
 *
 *   TYPE A -- temporal cross-referencing gap (same root cause as DOS-ISRO's
 *   original Finding 1): a base instrument was classified before a LATER
 *   real amendment existed, so it correctly read "In Force" at classification
 *   time and was never revisited. Confirmed via later amendment documents
 *   that exist in the SAME regulator's own corpus, referencing this base by
 *   name/number.
 *
 *   TYPE B -- single-document misclassification: the model tagged a document
 *   "Amended" even though its OWN stored classificationReason says the
 *   document itself amends/extends something else (the exact self-
 *   contradiction the user caught in DOS-ISRO's original Finding 1, now
 *   confirmed recurring in fresh classifications through lib/ingest.ts's own
 *   prompt, not just CCI's old standalone classifier.py). These get flipped
 *   to "In Force" -- they are the freestanding amending instrument, not the
 *   amended one.
 *
 * Deliberately NOT included here (found during the same audit, but a
 * different status question -- Superseded vs. Amended -- that needs its own
 * judgment call, not blindly folded into this fix):
 *   - MTCTE "MTCTE procedure (ver 2.1/ Rel. May 2021)...": arguably fully
 *     superseded by "MTCTE Procedure (v3.0/ Rel. April 2024)", not merely
 *     amended.
 *   - MIB "Policy Guidelines for Television Rating Agencies in India"
 *     (2014): arguably fully replaced by "Television Ratings Policy 2026",
 *     not amended.
 *   - CLC's periodic VDA Orders (2015-2026): each new VDA Order effectively
 *     supersedes the prior one on taking effect, but every one is currently
 *     "In Force" going back to 2015 -- a real, much bigger pattern, distinct
 *     from the amendment question this script addresses.
 *
 * Idempotent -- safe to re-run; skips any entry no longer at the expected
 * current status (in case something else already changed it).
 *
 * Run with:
 *   npx tsx scripts/fix-amendment-status.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

interface Fix {
  id: string;
  regulatorCode: string;
  titleContains: string; // safety check against ID drift
  fromStatus: "In Force" | "Amended";
  toStatus: "Amended" | "In Force";
  type: "A" | "B";
  reason: string;
}

const FIXES: Fix[] = [
  {
    id: "cms4n6jdr001tl4dfnoxm42ct",
    regulatorCode: "DOT",
    titleContains: "Indian Telegraph Right of Way Rules, 2016",
    fromStatus: "In Force",
    toStatus: "Amended",
    type: "A",
    reason:
      "Real later amendments in the same DOT corpus modify this base: \"Gazette notification of Indian Telegraph Right of Way (Amendment) Rules 2017\" and \"Indian Telegraph Right of Way [Amendment] Rules, 2021\" -- both correctly stay In Force as freestanding amending instruments; this is the base they amend.",
  },
  {
    id: "cmt1ho3j7000jckdfgu5o23ai",
    regulatorCode: "CCI",
    titleContains: "Notification regarding (a) de minimis exemption",
    fromStatus: "In Force",
    toStatus: "Amended",
    type: "A",
    reason:
      "The 2017 base de minimis exemption notification. Real later notifications extend/revise it (2022 extension, 2024 revision), both of which stay In Force as freestanding amending instruments.",
  },
  {
    id: "cms5rqegi002nn0df5sfngub5",
    regulatorCode: "MTCTE",
    titleContains: "MTCTE Procedure (v3.0",
    fromStatus: "In Force",
    toStatus: "Amended",
    type: "A",
    reason:
      "Real later amendments in the same MTCTE corpus modify this base: \"Amendment in MTCTE Procedure v3.0 (TEC 93009:2024)\" and \"Amendment 2.0 in MTCTE Procedure v3.0 (TEC 93009:2024)\", both of which correctly stay In Force.",
  },
  {
    id: "cms4e01qq000dckdfvfe8l17l",
    regulatorCode: "DOT",
    titleContains: "Amended Guidelines for grant of Unified License",
    fromStatus: "Amended",
    toStatus: "In Force",
    type: "B",
    reason:
      "Stored classificationReason: \"The title explicitly states 'Amended Guidelines...', indicating the document itself has been amended\" -- this is the same logic error as DOS-ISRO's original Finding 1: a document titled 'Amended X' is the CURRENT, consolidated, operative version (dated 2026-05-27, most recent Unified License guidance in the corpus, no pre-amendment base document exists to hold 'Amended' instead), so it should be In Force, not Amended.",
  },
  {
    id: "cmt1hnstv0007ckdfonpvt6ex",
    regulatorCode: "CCI",
    titleContains: "extension of (a) de minimis",
    fromStatus: "Amended",
    toStatus: "In Force",
    type: "B",
    reason:
      "Stored classificationReason: \"The notification extends exemptions and amends a prior notification... so it is an amendment to an existing notification\" -- direct self-contradiction (this document DOES the amending; the 2017 base it amends is the one flagged Amended by this same script).",
  },
];

async function main() {
  const statusTagCache = new Map<string, string>(); // `${regulatorCode}:${name}` -> tagId

  async function getStatusTagId(regulatorCode: string, name: string): Promise<string> {
    const key = `${regulatorCode}:${name}`;
    const cached = statusTagCache.get(key);
    if (cached) return cached;
    const regulator = await prisma.regulator.findUnique({ where: { code: regulatorCode } });
    if (!regulator) throw new Error(`Regulator "${regulatorCode}" not found.`);
    const tag = await prisma.taxonomyTag.findFirst({
      where: { regulatorId: regulator.id, facet: "STATUS", name },
    });
    if (!tag) throw new Error(`Status tag "${name}" not found for ${regulatorCode}.`);
    statusTagCache.set(key, tag.id);
    return tag.id;
  }

  let applied = 0;
  let skipped = 0;

  for (const fix of FIXES) {
    const entry = await prisma.updateEntry.findUnique({
      where: { id: fix.id },
      select: { id: true, title: true, statusTag: { select: { name: true } } },
    });

    if (!entry) {
      console.log(`  [SKIP] id ${fix.id} not found (${fix.regulatorCode}) -- may have been re-ingested with a new id`);
      skipped++;
      continue;
    }
    if (!entry.title.toLowerCase().includes(fix.titleContains.toLowerCase())) {
      console.log(`  [SKIP] id ${fix.id} title no longer matches expected text -- not applying blind`);
      skipped++;
      continue;
    }
    if (entry.statusTag?.name !== fix.fromStatus) {
      console.log(
        `  [SKIP] "${entry.title.slice(0, 60)}" is now "${entry.statusTag?.name ?? "none"}", not "${fix.fromStatus}" -- already changed, not overriding`
      );
      skipped++;
      continue;
    }

    const toStatusId = await getStatusTagId(fix.regulatorCode, fix.toStatus);
    await prisma.updateEntry.update({ where: { id: entry.id }, data: { statusId: toStatusId } });
    console.log(
      `  [TYPE ${fix.type}] [${fix.regulatorCode}] "${entry.title.slice(0, 70)}" -> ${fix.fromStatus} => ${fix.toStatus}`
    );
    applied++;
  }

  console.log("\n" + "=".repeat(70));
  console.log("AMENDMENT-STATUS FIX RESULTS");
  console.log("=".repeat(70));
  console.log(`Applied: ${applied}`);
  console.log(`Skipped: ${skipped}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
