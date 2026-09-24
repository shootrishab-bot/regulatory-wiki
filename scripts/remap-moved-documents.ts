/**
 * Re-points stored documents at their new URLs after a regulator moves its
 * website, so the next sync does not ingest them a second time.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several scrapers derive source_id from the document's URL (labour_adapter
 * uses sha1(regulator|source_url|title)). When a regulator rebuilds its site,
 * every URL changes, so every document it still publishes arrives with a new
 * source_id and the sync's (regulatorId, sourceId) dedup sees it as new. That
 * is exactly what clc.gov.in's move to WordPress in September 2026 would have
 * done: "VDA Order April 2026", the Child Labour Act and the Railway Servants
 * Rules were all already in Postgres under /clc/... URLs that now 404.
 *
 * WHAT IT DOES
 * ------------
 * Reads the regulator's freshly scraped normalized JSON and, for each record
 * whose source_id is NOT in Postgres, looks for a stored document of the same
 * regulator with the identical title (whitespace-normalized). Only a
 * one-to-one match is acted on -- a title shared by several stored rows, or by
 * several scraped rows, is reported and left alone, because a guess there
 * could merge two different documents. A match gets the new sourceId,
 * sourceUrl and fileUrl; its entry, tags and history are untouched (they hang
 * off SourceDocument.id, which does not change).
 *
 * SAFETY
 * ------
 * Dry-run by default; --apply to write. Old values are printed.
 *
 * Usage:
 *   npx tsx scripts/remap-moved-documents.ts CLC scrapers/data/clc_normalized.json
 *   npx tsx scripts/remap-moved-documents.ts CLC scrapers/data/clc_normalized.json --apply
 */

import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../lib/prisma";
import type { NormalizedDocument } from "../lib/ingest";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function main() {
  const [code, jsonPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const apply = process.argv.includes("--apply");
  if (!code || !jsonPath) {
    console.error("usage: remap-moved-documents.ts <REGULATOR_CODE> <normalized.json> [--apply]");
    process.exitCode = 1;
    return;
  }

  const regulator = await prisma.regulator.findUnique({ where: { code } });
  if (!regulator) throw new Error(`Regulator ${code} not found`);

  const scraped: NormalizedDocument[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const stored = await prisma.sourceDocument.findMany({
    where: { regulatorId: regulator.id },
    select: { id: true, sourceId: true, title: true, sourceUrl: true, fileUrl: true },
  });
  const storedIds = new Set(stored.map((s) => s.sourceId));

  const storedByTitle = new Map<string, typeof stored>();
  for (const s of stored) storedByTitle.set(norm(s.title), [...(storedByTitle.get(norm(s.title)) ?? []), s]);
  const scrapedTitleCount = new Map<string, number>();
  for (const d of scraped) scrapedTitleCount.set(norm(d.title), (scrapedTitleCount.get(norm(d.title)) ?? 0) + 1);

  const unknown = scraped.filter((d) => !storedIds.has(d.source_id));
  console.log(`${code}: ${scraped.length} scraped, ${unknown.length} not in Postgres  mode=${apply ? "APPLY" : "DRY RUN"}\n`);

  let remapped = 0;
  for (const d of unknown) {
    const matches = storedByTitle.get(norm(d.title)) ?? [];
    if (matches.length === 0) {
      console.log(`  new        ${d.title.slice(0, 70)}`);
      continue;
    }
    if (matches.length > 1 || (scrapedTitleCount.get(norm(d.title)) ?? 0) > 1) {
      console.log(`  AMBIGUOUS  ${d.title.slice(0, 70)} (${matches.length} stored, left alone)`);
      continue;
    }
    const s = matches[0];
    console.log(`  remap      ${d.title.slice(0, 70)}`);
    console.log(`               ${s.sourceUrl}\n            -> ${d.source_url}`);
    if (apply) {
      await prisma.sourceDocument.update({
        where: { id: s.id },
        data: { sourceId: d.source_id, sourceUrl: d.source_url, fileUrl: d.file_url },
      });
    }
    remapped++;
  }

  console.log(`\n${remapped} to remap.${!apply && remapped ? " Dry run: nothing written. Re-run with --apply." : ""}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
