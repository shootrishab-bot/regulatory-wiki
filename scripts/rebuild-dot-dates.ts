/**
 * Rebuilds every DoT publishedDate deterministically from the IMMUTABLE raw
 * string in dot_master.csv.
 *
 * WHY THIS REPLACES THE EARLIER SWAP-BASED SCRIPT
 * -----------------------------------------------
 * apply-ddmm-convention.ts computed the new date by SWAPPING the value
 * currently in Postgres. That has no fixed point: for any row it could not
 * resolve with document evidence, every run flipped the date again, so a
 * retry after a mid-run connection failure silently reverted rows the
 * previous run had just corrected (observed live, 2026-08-03). Deriving from
 * the CSV instead makes the operation idempotent and self-healing -- it
 * recomputes the correct value from scratch no matter what state the DB is
 * currently in, so it can safely be re-run after a partial failure.
 *
 * THE RULE, applied to a raw "A/B/YYYY"
 * -------------------------------------
 *   B > 12  -> DD/MM is impossible, so it is MM/DD:  month=A, day=B
 *   A > 12  -> MM/DD is impossible, so it is DD/MM:  day=A,   month=B
 *   both<=12 -> genuinely ambiguous. Document evidence first (title-embedded
 *               date or PDF letterhead "Dated:" line); if nothing settles it,
 *               fall back to DD/MM, the Indian regulator convention.
 *
 * WHY THE DD/MM FALLBACK IS EVIDENCE-BACKED
 * -----------------------------------------
 * 50 order-sensitive DoT rows were resolved against real document evidence
 * and ALL 50 were DD-MM. Zero counterexamples. The 17 that came back
 * "already correct" were exactly the 17 palindromic dates (day == month),
 * where the reading cannot matter. Residual risk is stated plainly: that is
 * a sample, not a census, so a scraper-converted MM/DD row with both
 * components <= 12 and no document evidence would be flipped wrong. The
 * per-row `basis` in the output says which rows rest on convention rather
 * than evidence.
 *
 * Dry-run by default; pass --apply. Only publishedDate is ever written.
 *
 * Usage: npx tsx scripts/rebuild-dot-dates.ts [--apply] [--no-pdf]
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { prisma } from "../lib/prisma";
import { buildDate, resolveDate } from "../lib/date-resolution";

const APPLY = process.argv.includes("--apply");
const NO_PDF = process.argv.includes("--no-pdf");
const CONCURRENCY = 6;
const CSV = path.join(__dirname, "../scrapers/dot/dot_master.csv");

type Basis = "unambiguous_mmdd" | "unambiguous_ddmm" | "evidence" | "convention_ddmm" | "unparseable";

/** Minimal CSV reader -- dot_master.csv has quoted titles containing commas. */
function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf-8");
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  const header = rows.shift()!;
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function main() {
  const csvRows = readCsv(CSV);
  const rawById = new Map(csvRows.map((r) => [r.id, r.publish_date?.trim() ?? ""]));
  console.log(`loaded ${csvRows.length} CSV rows`);

  const docs = await prisma.$queryRaw<
    { id: string; sourceId: string; title: string; fileUrl: string | null; published: Date | null }[]
  >`
    SELECT sd.id, sd."sourceId", sd.title, sd."fileUrl", sd."publishedDate" AS published
    FROM "SourceDocument" sd
    JOIN "Regulator" r ON r.id = sd."regulatorId"
    WHERE r.code = 'DOT'
  `;
  console.log(`DoT documents in DB: ${docs.length}   mode=${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const stats: Record<Basis, number> = {
    unambiguous_mmdd: 0,
    unambiguous_ddmm: 0,
    evidence: 0,
    convention_ddmm: 0,
    unparseable: 0,
  };
  let changed = 0;
  let noCsvRow = 0;
  const samples: string[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < docs.length) {
      const d = docs[cursor++];
      const raw = rawById.get(d.sourceId);
      if (raw === undefined) {
        noCsvRow++;
        continue;
      }
      const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      if (!m) {
        stats.unparseable++;
        continue;
      }
      const a = Number(m[1]);
      const b = Number(m[2]);
      const y = Number(m[3]);

      let target: Date | null = null;
      let basis: Basis;

      if (b > 12) {
        target = buildDate(b, a, y); // day=B, month=A
        basis = "unambiguous_mmdd";
      } else if (a > 12) {
        target = buildDate(a, b, y); // day=A, month=B
        basis = "unambiguous_ddmm";
      } else {
        // Ambiguous. Ask the document. resolveDate needs a concrete starting
        // reading; give it the DD-MM one, since it compares BOTH orders.
        const ddmm = buildDate(a, b, y);
        let resolved = ddmm ? resolveDate(ddmm, d.title, null) : null;
        if (!resolved && !NO_PDF && ddmm && d.fileUrl) {
          try {
            const res = await fetch(d.fileUrl);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              const text = (await new PDFParse({ data: buf }).getText()).text || null;
              resolved = resolveDate(ddmm, d.title, text);
            }
          } catch {
            /* fall through to convention */
          }
        }
        if (resolved) {
          target = resolved.date;
          basis = "evidence";
        } else {
          target = ddmm;
          basis = "convention_ddmm";
        }
      }

      if (!target) {
        stats.unparseable++;
        continue;
      }
      stats[basis]++;

      const before = d.published ? d.published.toISOString().slice(0, 10) : "(none)";
      const after = target.toISOString().slice(0, 10);
      if (before === after) continue;

      changed++;
      if (samples.length < 12) {
        samples.push(`  ${raw}  ${before} -> ${after}  (${basis})  ${d.title.slice(0, 44)}`);
      }
      if (APPLY) {
        await prisma.sourceDocument.update({
          where: { id: d.id },
          data: { publishedDate: target },
        });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(samples.join("\n"));
  console.log("\n" + "=".repeat(64));
  console.log(`rows changed:                    ${changed}${APPLY ? " (WRITTEN)" : " (dry run)"}`);
  console.log(`basis -> unambiguous MM/DD:      ${stats.unambiguous_mmdd}`);
  console.log(`         unambiguous DD/MM:      ${stats.unambiguous_ddmm}`);
  console.log(`         resolved by evidence:   ${stats.evidence}`);
  console.log(`         DD/MM by convention:    ${stats.convention_ddmm}`);
  console.log(`         unparseable:            ${stats.unparseable}`);
  console.log(`no matching CSV row:             ${noCsvRow}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
